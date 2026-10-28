// LUTs .cube: leitura e aplicação numa imagem (CPU, interpolação trilinear). Usado pelas miniaturas do painel.
(function (root) {
  // Lê um .cube (3D ou 1D). Devolve {size, is3D, data: Float32Array RGB, min: [r,g,b], max: [r,g,b], title}.
  function parseCube(text) {
    var size = 0, is3D = true, min = [0, 0, 0], max = [1, 1, 1], title = "", values = [];
    var lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line[0] === "#") continue;
      var parts = line.split(/\s+/);
      var key = parts[0].toUpperCase();
      if (key === "TITLE") title = line.slice(5).trim().replace(/^"|"$/g, "");
      else if (key === "LUT_3D_SIZE") { size = +parts[1]; is3D = true; }
      else if (key === "LUT_1D_SIZE") { size = +parts[1]; is3D = false; }
      else if (key === "DOMAIN_MIN") min = parts.slice(1, 4).map(Number);
      else if (key === "DOMAIN_MAX") max = parts.slice(1, 4).map(Number);
      else if (/^[-+.\d]/.test(key)) values.push(+parts[0], +parts[1], +parts[2]);
    }
    var expected = is3D ? size * size * size * 3 : size * 3;
    if (!size || values.length < expected) throw new Error("Arquivo .cube inválido.");
    return { size: size, is3D: is3D, data: new Float32Array(values.slice(0, expected)), min: min, max: max, title: title };
  }

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  // Aplica o LUT em ImageData (sRGB 0-255). intensity 0-1 mistura com o original.
  function applyToImageData(src, lut, intensity) {
    var out = new ImageData(src.width, src.height), s = src.data, d = out.data;
    var n = lut.size, n1 = n - 1, L = lut.data, k = intensity === undefined ? 1 : intensity;
    for (var p = 0; p < s.length; p += 4) {
      var r = clamp01((s[p] / 255 - lut.min[0]) / (lut.max[0] - lut.min[0]));
      var g = clamp01((s[p + 1] / 255 - lut.min[1]) / (lut.max[1] - lut.min[1]));
      var b = clamp01((s[p + 2] / 255 - lut.min[2]) / (lut.max[2] - lut.min[2]));
      var or, og, ob;
      if (lut.is3D) {
        var x = r * n1, y = g * n1, z = b * n1;
        var x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
        var x1 = Math.min(x0 + 1, n1), y1 = Math.min(y0 + 1, n1), z1 = Math.min(z0 + 1, n1);
        var fx = x - x0, fy = y - y0, fz = z - z0;
        var c = [0, 0, 0];
        for (var ch = 0; ch < 3; ch++) {
          var v000 = L[((z0 * n + y0) * n + x0) * 3 + ch], v100 = L[((z0 * n + y0) * n + x1) * 3 + ch];
          var v010 = L[((z0 * n + y1) * n + x0) * 3 + ch], v110 = L[((z0 * n + y1) * n + x1) * 3 + ch];
          var v001 = L[((z1 * n + y0) * n + x0) * 3 + ch], v101 = L[((z1 * n + y0) * n + x1) * 3 + ch];
          var v011 = L[((z1 * n + y1) * n + x0) * 3 + ch], v111 = L[((z1 * n + y1) * n + x1) * 3 + ch];
          var a = v000 + (v100 - v000) * fx, bb = v010 + (v110 - v010) * fx;
          var cc = v001 + (v101 - v001) * fx, dd = v011 + (v111 - v011) * fx;
          var e = a + (bb - a) * fy, f = cc + (dd - cc) * fy;
          c[ch] = e + (f - e) * fz;
        }
        or = c[0]; og = c[1]; ob = c[2];
      } else {
        or = sample1D(L, n, r, 0); og = sample1D(L, n, g, 1); ob = sample1D(L, n, b, 2);
      }
      d[p] = 255 * clamp01(s[p] / 255 + (or - s[p] / 255) * k);
      d[p + 1] = 255 * clamp01(s[p + 1] / 255 + (og - s[p + 1] / 255) * k);
      d[p + 2] = 255 * clamp01(s[p + 2] / 255 + (ob - s[p + 2] / 255) * k);
      d[p + 3] = s[p + 3];
    }
    return out;
  }

  function sample1D(L, n, v, ch) {
    var x = v * (n - 1), x0 = Math.floor(x), x1 = Math.min(x0 + 1, n - 1), f = x - x0;
    return L[x0 * 3 + ch] + (L[x1 * 3 + ch] - L[x0 * 3 + ch]) * f;
  }

  var api = { parseCube: parseCube, applyToImageData: applyToImageData };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WPLut = api;
})(this);
