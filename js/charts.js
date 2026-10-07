/* Gráficos em SVG (sem dependências): colunas/linhas com dois eixos e pizza.
   Usa as variáveis de cor do tema, então funciona no modo claro e escuro. */
(function () {
  "use strict";
  var PAL = ["var(--red)", "var(--gold)", "#6b4a33", "var(--success)", "#2f6f8f", "#b07aa1", "#c96a3a", "#8c8c8c"];

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function num(v, d) { return Number(v).toLocaleString("pt-BR", { maximumFractionDigits: d == null ? 1 : d }); }

  // escolhe um passo "redondo" para o eixo, com no máximo 5 divisões
  function scale(max, integer) {
    if (!(max > 0)) max = 1;
    var base = Math.pow(10, Math.floor(Math.log10(max / 5)));
    var mults = integer ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
    for (var k = 0; k < 3; k++) {
      for (var i = 0; i < mults.length; i++) {
        var step = mults[i] * base * Math.pow(10, k);
        if (integer && step < 1) continue;
        if (Math.ceil(max / step) <= 5) return { step: step, top: Math.ceil(max / step) * step };
      }
    }
    return { step: max / 4, top: max };
  }

  function empty(msg) { return '<div class="empty" style="padding:28px 8px">' + esc(msg || "Sem dados no período.") + "</div>"; }

  /* o = { labels:[], series:[{name, values:[], kind:'bar'|'line', axis:'l'|'r', color, fmt}],
           h, yTitle, y2Title, yFmt, y2Fmt, intL, intR, valueLabels, tip(i) } */
  function bars(o) {
    var W = 640, H = o.h || 280, n = o.labels.length;
    var S = o.series, hasR = S.some(function (s) { return s.axis === "r"; });
    var m = { l: 46, r: hasR ? 46 : 14, t: o.yTitle || o.y2Title ? 26 : 14, b: 32 };
    var pw = W - m.l - m.r, ph = H - m.t - m.b;
    var maxL = 0, maxR = 0, any = false;
    S.forEach(function (s) {
      s.values.forEach(function (v) { if (v > 0) any = true; if (s.axis === "r") maxR = Math.max(maxR, v || 0); else maxL = Math.max(maxL, v || 0); });
    });
    if (!n || !any) return empty(o.empty);
    var sl = scale(maxL, o.intL), sr = hasR ? scale(maxR, o.intR) : null;
    function yL(v) { return m.t + ph - (v / sl.top) * ph; }
    function yR(v) { return m.t + ph - (v / sr.top) * ph; }
    var group = pw / n;
    var barS = S.filter(function (s) { return s.kind !== "line"; }), lineS = S.filter(function (s) { return s.kind === "line"; });
    var inner = Math.min(group * 0.8, 46 * Math.max(barS.length, 1)), bw = barS.length ? inner / barS.length : 0;
    var yf = o.yFmt || function (v) { return num(v); }, y2f = o.y2Fmt || function (v) { return num(v); };
    var out = [];

    out.push('<svg class="bi" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(o.aria || "Gráfico") + '" preserveAspectRatio="xMidYMid meet">');
    // grade + eixo esquerdo
    for (var v = 0; v <= sl.top + 1e-9; v += sl.step) {
      var y = yL(v);
      out.push('<line class="c-grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/>');
      out.push('<text x="' + (m.l - 6) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end">' + esc(yf(v)) + "</text>");
    }
    if (hasR) for (var w = 0; w <= sr.top + 1e-9; w += sr.step) {
      out.push('<text x="' + (W - m.r + 6) + '" y="' + (yR(w) + 3.5).toFixed(1) + '" text-anchor="start">' + esc(y2f(w)) + "</text>");
    }
    if (o.yTitle) out.push('<text class="c-title" x="' + m.l + '" y="12" text-anchor="start">' + esc(o.yTitle) + "</text>");
    if (o.y2Title && hasR) out.push('<text class="c-title" x="' + (W - m.r) + '" y="12" text-anchor="end">' + esc(o.y2Title) + "</text>");

    // colunas
    barS.forEach(function (s, j) {
      var color = s.color || PAL[S.indexOf(s) % PAL.length];
      s.values.forEach(function (val, i) {
        if (!(val > 0)) return;
        var x = m.l + group * i + (group - inner) / 2 + bw * j, yy = (s.axis === "r" ? yR : yL)(val);
        out.push('<rect x="' + (x + 1).toFixed(1) + '" y="' + yy.toFixed(1) + '" width="' + Math.max(bw - 2, 1).toFixed(1) + '" height="' + Math.max(m.t + ph - yy, 0).toFixed(1) + '" rx="3" style="fill:' + color + '"/>');
        if (o.valueLabels && n <= 14 && barS.length <= 2) {
          out.push('<text class="vl" x="' + (x + bw / 2).toFixed(1) + '" y="' + (yy - 4).toFixed(1) + '" text-anchor="middle">' + esc((s.fmt || yf)(val)) + "</text>");
        }
      });
    });
    // linhas
    lineS.forEach(function (s) {
      var color = s.color || PAL[S.indexOf(s) % PAL.length], f = s.axis === "r" ? yR : yL, d = "", started = false;
      s.values.forEach(function (val, i) {
        if (val == null || isNaN(val)) { started = false; return; }
        var x = m.l + group * i + group / 2, yy = f(val);
        d += (started ? "L" : "M") + x.toFixed(1) + " " + yy.toFixed(1) + " "; started = true;
      });
      out.push('<path d="' + d + '" fill="none" stroke-width="2.5" stroke-linejoin="round" style="stroke:' + color + '"/>');
      s.values.forEach(function (val, i) {
        if (val == null || isNaN(val)) return;
        out.push('<circle cx="' + (m.l + group * i + group / 2).toFixed(1) + '" cy="' + f(val).toFixed(1) + '" r="3.6" style="fill:var(--surface);stroke:' + color + ';stroke-width:2"/>');
      });
    });
    // rótulos do eixo X
    var maxLen = o.labels.reduce(function (a, l) { return Math.max(a, String(l).length); }, 1);
    var maxLabels = Math.max(Math.floor(pw / (maxLen * 6.4 + 10)), 1), skip = Math.ceil(n / maxLabels);
    o.labels.forEach(function (l, i) {
      if (i % skip) return;
      out.push('<text x="' + (m.l + group * i + group / 2).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle">' + esc(l) + "</text>");
    });
    // áreas de passagem do mouse (tooltip)
    for (var i = 0; i < n; i++) {
      var tip = o.tip ? o.tip(i) : o.labels[i] + ": " + S.map(function (s) { return s.name + " " + ((s.fmt || yf)(s.values[i] || 0)); }).join(" · ");
      out.push('<rect class="c-hit" x="' + (m.l + group * i).toFixed(1) + '" y="' + m.t + '" width="' + group.toFixed(1) + '" height="' + ph + '"><title>' + esc(tip) + "</title></rect>");
    }
    out.push("</svg>");
    return out.join("");
  }

  function legend(series) {
    return '<div class="bi-legend">' + series.map(function (s, i) {
      var c = s.color || PAL[i % PAL.length];
      return '<span><i class="' + (s.kind === "line" ? "ln" : "sq") + '" style="background:' + c + '"></i>' + esc(s.name) + "</span>";
    }).join("") + "</div>";
  }

  /* o = { items:[{label, value, color}], size } */
  function pie(o) {
    var items = o.items.filter(function (x) { return x.value > 0; }), total = items.reduce(function (s, x) { return s + x.value; }, 0);
    if (!total) return empty(o.empty);
    var S = 220, c = S / 2, r = 100, ang = -Math.PI / 2, out = ['<svg class="pie" viewBox="0 0 ' + S + " " + S + '" role="img" aria-label="' + esc(o.aria || "Gráfico de pizza") + '">'];
    function pt(a, rr) { return [(c + rr * Math.cos(a)).toFixed(2), (c + rr * Math.sin(a)).toFixed(2)]; }
    items.forEach(function (it) {
      var frac = it.value / total, pct = Math.round(frac * 100), tip = it.label + ": " + it.value + " (" + pct + "%)";
      if (items.length === 1) {
        out.push('<circle cx="' + c + '" cy="' + c + '" r="' + r + '" style="fill:' + it.color + '"><title>' + esc(tip) + "</title></circle>");
        out.push('<text class="pl" x="' + c + '" y="' + (c + 5) + '" text-anchor="middle">100%</text>');
        return;
      }
      var a2 = ang + frac * 2 * Math.PI, p1 = pt(ang, r), p2 = pt(a2, r), large = frac > 0.5 ? 1 : 0;
      out.push('<path d="M' + c + " " + c + " L" + p1[0] + " " + p1[1] + " A" + r + " " + r + " 0 " + large + " 1 " + p2[0] + " " + p2[1] + ' Z" style="fill:' + it.color + ';stroke:var(--surface);stroke-width:2"><title>' + esc(tip) + "</title></path>");
      if (frac >= 0.06) { var pm = pt(ang + (a2 - ang) / 2, r * 0.64); out.push('<text class="pl" x="' + pm[0] + '" y="' + (parseFloat(pm[1]) + 4) + '" text-anchor="middle">' + pct + "%</text>"); }
      ang = a2;
    });
    out.push("</svg>");
    return out.join("");
  }

  window.DIBCharts = { bars: bars, pie: pie, legend: legend, PAL: PAL, num: num };
})();
