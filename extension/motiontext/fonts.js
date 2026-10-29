// Lista as fontes instaladas lendo a tabela "name" dos arquivos (TTF/OTF/TTC).
// O After Effects precisa do nome PostScript; o painel mostra família + estilo.
// Pastas: Windows\Fonts, fontes do usuário e as do Adobe Fonts (CoreSync/livetype).
(function (root) {
    var fs = require("fs"), path = require("path");

    function u16(b, o) { return b.readUInt16BE(o); }
    function u32(b, o) { return b.readUInt32BE(o); }

    function decode(b, off, len, platform) {
        if (platform === 0 || platform === 3) {                 // UTF-16BE
            var s = "";
            for (var i = 0; i + 1 < len; i += 2) s += String.fromCharCode(u16(b, off + i));
            return s;
        }
        return b.toString("latin1", off, off + len);
    }

    // lê uma fonte a partir do offset da tabela de diretório (sfnt)
    function readSfnt(b, base) {
        var numTables = u16(b, base + 4), nameOff = -1;
        for (var t = 0; t < numTables; t++) {
            var rec = base + 12 + t * 16;
            if (b.toString("latin1", rec, rec + 4) === "name") { nameOff = u32(b, rec + 8); break; }
        }
        if (nameOff < 0) return null;
        var count = u16(b, nameOff + 2), strOff = nameOff + u16(b, nameOff + 4);
        var best = {};                                            // id -> {score, value}
        for (var i = 0; i < count; i++) {
            var r = nameOff + 6 + i * 12;
            var plat = u16(b, r), lang = u16(b, r + 4), id = u16(b, r + 6);
            if (id !== 1 && id !== 2 && id !== 4 && id !== 6 && id !== 16 && id !== 17) continue;
            var score = plat === 3 ? (lang === 0x409 ? 3 : 2) : (plat === 1 ? 1 : 0);
            if (best[id] && best[id].score >= score) continue;
            best[id] = { score: score, value: decode(b, strOff + u16(b, r + 10), u16(b, r + 8), plat) };
        }
        function g(id) { return best[id] ? best[id].value.replace(/\0/g, "").trim() : ""; }
        var ps = g(6);
        if (!ps) return null;
        // legacy/legacyStyle (IDs 1/2): é por esse nome que o navegador do painel acha estilos como "Montserrat Medium"
        return { postscript: ps, family: g(16) || g(1), style: g(17) || g(2), full: g(4), legacy: g(1), legacyStyle: g(2) };
    }

    function readFile(file) {
        var b;
        try { b = fs.readFileSync(file); } catch (e) { return []; }
        if (b.length < 12) return [];
        var tag = b.toString("latin1", 0, 4), out = [];
        try {
            if (tag === "ttcf") {
                var n = u32(b, 8);
                for (var i = 0; i < n; i++) { var f = readSfnt(b, u32(b, 12 + i * 4)); if (f) out.push(f); }
            } else if (tag === "OTTO" || u32(b, 0) === 0x00010000 || tag === "true") {
                var one = readSfnt(b, 0); if (one) out.push(one);
            }
        } catch (e) { /* arquivo corrompido: ignora */ }
        out.forEach(function (f) { f.file = file; });
        return out;
    }

    function walk(dir, list, depth) {
        var items;
        try { items = fs.readdirSync(dir); } catch (e) { return; }
        items.forEach(function (n) {
            var p = path.join(dir, n), st;
            try { st = fs.statSync(p); } catch (e) { return; }
            if (st.isDirectory()) { if (depth < 6) walk(p, list, depth + 1); }
            else if (/\.(ttf|otf|ttc)$/i.test(n) || (dir.indexOf("livetype") >= 0 && !/\./.test(n))) list.push(p);
        });
    }

    function fontDirs() {
        var env = process.env;
        return [
            path.join(env.WINDIR || "C:\\Windows", "Fonts"),
            path.join(env.LOCALAPPDATA || "", "Microsoft", "Windows", "Fonts"),
            path.join(env.APPDATA || "", "Adobe", "CoreSync", "plugins", "livetype")
        ];
    }

    // Lista sem repetição de PostScript, ordenada por família e estilo.
    function listFonts() {
        var files = [], seen = {}, fonts = [];
        fontDirs().forEach(function (d) { walk(d, files, 0); });
        files.forEach(function (f) {
            readFile(f).forEach(function (font) {
                if (seen[font.postscript] || font.family.charAt(0) === ".") return;
                seen[font.postscript] = 1;
                fonts.push(font);
            });
        });
        fonts.sort(function (a, b) {
            return a.family === b.family ? a.style.localeCompare(b.style) : a.family.localeCompare(b.family);
        });
        return fonts;
    }

    var api = { listFonts: listFonts, readFile: readFile };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    root.MTFonts = api;
})(typeof window !== "undefined" ? window : this);
