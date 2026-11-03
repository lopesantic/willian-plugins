// Gera os 4 templates do MotionText que vão dentro do plugin (motiontext/templates/MT_<largura>x<altura>.mogrt)
// numa abertura só do After Effects, que fecha no fim. Uso: node tools/build-mt-templates.js
// Regra: um AE separado por vez; se já houver AE aberto, o script para (não mexe no AE do Dynamic Link).
var fs = require("fs"), path = require("path"), os = require("os"), cp = require("child_process");
var E = require(path.join(__dirname, "..", "extension", "motiontext", "engine.js"));
var EXT = path.join(__dirname, "..", "extension"), OUT = path.join(EXT, "motiontext", "templates");
var SIZES = [[1080, 1920], [1920, 1080], [1080, 1080], [1080, 1350]];

var running = cp.execSync('tasklist /FI "IMAGENAME eq AfterFX.exe" /NH', { encoding: "utf8" });
if (/AfterFX\.exe/i.test(running)) { console.log("Já há um After Effects aberto: feche o que for seu e rode de novo."); process.exit(1); }
var exe = E.findAE();
if (!exe) { console.log("After Effects não encontrado."); process.exit(1); }

// pasta sem espaço no caminho (o -r do AE não aceita aspas)
var dir = path.join(os.tmpdir(), "WPMTBuild");
fs.mkdirSync(dir, { recursive: true });
try { dir = cp.execSync('for %I in ("' + dir + '") do @echo %~sI', { encoding: "utf8", shell: "cmd.exe" }).trim(); } catch (e) {}
var fwd = function (p) { return p.replace(/\\/g, "/"); };
var outTmp = path.join(dir, "out"), result = path.join(dir, "result.json"), job = path.join(dir, "job.jsx");
fs.mkdirSync(outTmp, { recursive: true });
try { fs.unlinkSync(result); } catch (e) {}
var cfg = {
  anims: fwd(path.join(EXT, "motiontext", "anims.js")), width: 1080, height: 1920, outDir: fwd(outTmp), result: fwd(result), quit: true,
  jobs: SIZES.map(function (s) { return { fontA: "Montserrat-SemiBold", fontB: "BebasNeue-Regular", name: "MT_" + s[0] + "x" + s[1], width: s[0], height: s[1] }; })
};
fs.writeFileSync(job, "var MT_JOB = " + JSON.stringify(cfg) + ";\n$.evalFile(File(" + JSON.stringify(fwd(path.join(EXT, "motiontext", "ae", "build_template.jsx"))) + "));\n", "utf8");
console.log("Abrindo o After Effects…");
cp.spawn(exe, ["-m", "-r", job], { detached: true, stdio: "ignore" }).unref();

var t0 = Date.now(), last = "";
var timer = setInterval(function () {
  var el = Math.round((Date.now() - t0) / 1000);
  try { var l = fs.readFileSync(result + ".log", "utf8").trim().split("\n").pop(); if (l !== last) { last = l; console.log(el + " s · " + l); } } catch (e) {}
  if (fs.existsSync(result)) {
    clearInterval(timer);
    var r = JSON.parse(fs.readFileSync(result, "utf8").replace(/^﻿/, ""));
    var made = SIZES.map(function (s) { return path.join(outTmp, "MT_" + s[0] + "x" + s[1] + ".mogrt"); }).filter(function (f) { return fs.existsSync(f); });
    made.forEach(function (f) { fs.copyFileSync(f, path.join(OUT, path.basename(f))); });
    console.log((made.length === SIZES.length ? "Pronto: " : "Faltou template: ") + made.length + "/" + SIZES.length + " copiados para " + OUT);
    if (!r.ok) console.log("Log: " + r.log);
    process.exit(made.length === SIZES.length ? 0 : 1);
  }
  if (el > 900) { clearInterval(timer); console.log("O AE não terminou em 15 min. Último passo: " + last); process.exit(1); }
}, 2000);
