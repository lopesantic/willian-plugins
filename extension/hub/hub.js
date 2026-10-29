// Interface única: barra lateral por categoria + cada ferramenta no seu iframe (o painel original, sem mudança).
// O iframe é criado na 1ª vez que a ferramenta abre e continua vivo ao trocar de aba (não perde o que foi feito).
// A ponte com o Premiere e o Node vem da janela principal (ver shared/host-bridge.js).
(function () {
    var ICON = {
        cut: '<path d="M6 6l12 12M6 18L18 6" />',
        jcut: '<path d="M4 7h10M4 12h16M10 17h10" />',
        beat: '<path d="M3 12h3l2-6 4 12 2-6h7" />',
        sfx: '<path d="M4 10v4h4l5 4V6L8 10H4z" /><path d="M16 9a4 4 0 0 1 0 6" />',
        text: '<path d="M5 6h14M12 6v12M8 18h8" />',
        mic: '<rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />',
        lut: '<circle cx="9" cy="10" r="5" /><circle cx="15" cy="10" r="5" /><circle cx="12" cy="15" r="5" />',
        curve: '<path d="M4 19C9 19 9 5 20 5" /><circle cx="4" cy="19" r="1.5" /><circle cx="20" cy="5" r="1.5" />',
        frame: '<rect x="6" y="3" width="12" height="18" rx="2" /><path d="M9 7h6M9 17h6" />'
    };
    var GROUPS = [
        ["Corte e montagem", [["autocut", "AutoCut", "cut"], ["autojcut", "AutoJCut", "jcut"], ["beatmarker", "BeatMarker", "beat"]]],
        ["Texto e legendas", [["motiontext", "MotionText", "text"], ["transcrever", "Transcrever", "mic"]]],
        ["Áudio", [["autosoundfx", "AutoSoundFX", "sfx"]]],
        ["Cor e movimento", [["lutlibrary", "LUT Library", "lut"], ["animar", "Animar", "curve"]]],
        ["Formato", [["margens", "Margens", "frame"]]]
    ];
    var $ = function (id) { return document.getElementById(id); };
    var frames = {};
    function load() { try { return JSON.parse(localStorage.getItem("wp-hub") || "{}"); } catch (e) { return {}; } }
    function save(s) { try { localStorage.setItem("wp-hub", JSON.stringify(s)); } catch (e) {} }
    var st = load();

    function svg(name) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICON[name] + "</svg>"; }

    function render() {
        var box = $("groups"); box.innerHTML = "";
        GROUPS.forEach(function (g) {
            var sec = document.createElement("div"); sec.className = "hub-group";
            sec.innerHTML = '<div class="hub-group-title">' + g[0] + "</div>";
            g[1].forEach(function (t) {
                var b = document.createElement("button"); b.className = "hub-item"; b.dataset.tool = t[0]; b.title = t[1];
                b.innerHTML = svg(t[2]) + '<span class="hub-label">' + t[1] + "</span>";
                b.addEventListener("click", function () { open(t[0]); });
                sec.appendChild(b);
            });
            box.appendChild(sec);
        });
    }

    function open(tool) {
        if (!frames[tool]) {
            var f = document.createElement("iframe");
            f.className = "hub-frame"; f.src = "../" + tool + "/index.html"; f.title = tool;
            $("main").appendChild(f);
            frames[tool] = f;
        }
        Object.keys(frames).forEach(function (k) { frames[k].classList.toggle("on", k === tool); });
        document.querySelectorAll(".hub-item").forEach(function (b) { b.classList.toggle("active", b.dataset.tool === tool); });
        $("empty").style.display = "none";
        st.tool = tool; save(st);
    }

    function setCollapsed(c) {
        document.body.classList.toggle("collapsed", c);
        $("collapse").textContent = c ? "›" : "‹";
        $("collapse").title = c ? "Mostrar os nomes" : "Recolher a barra";
        st.collapsed = c; save(st);
    }
    $("collapse").addEventListener("click", function () { setCollapsed(!document.body.classList.contains("collapsed")); });

    try {
        var xml = require("fs").readFileSync(WP.extensionRoot() + "/CSXS/manifest.xml", "utf8");
        var m = /ExtensionBundleVersion="([^"]+)"/.exec(xml); if (m) $("ver").textContent = "versão " + m[1];
    } catch (e) {}
    render();
    setCollapsed(!!st.collapsed);
    open(st.tool || "autocut");
    window.WPHub = { open: open };
})();
