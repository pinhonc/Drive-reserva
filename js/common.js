(function () {
  "use strict";
  var cfg = window.DIB_CONFIG || {};
  var configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    cfg.SUPABASE_URL.indexOf("COLE_AQUI") === -1 && window.supabase);
  var sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function digits(s) { return String(s || "").replace(/\D/g, ""); }
  function fmtPhone(v) {
    var d = digits(v).slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 6) return "(" + d.slice(0, 2) + ") " + d.slice(2);
    if (d.length <= 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
    return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
  }
  function maskPhone(input) {
    input.addEventListener("input", function () { input.value = fmtPhone(input.value); });
  }
  function fmtDate(iso) { var p = String(iso).split("-"); return p[2] + "/" + p[1] + "/" + p[0]; }
  var DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
  function weekday(iso) { return DIAS[new Date(iso + "T12:00:00").getDay()]; }
  function addDays(iso, n) {
    var d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function waLink(phone, text) {
    var d = digits(phone);
    if (d.length <= 11) d = "55" + d;
    return "https://wa.me/" + d + "?text=" + encodeURIComponent(text);
  }
  async function rpc(name, args) {
    var r = await sb.rpc(name, args || {});
    if (r.error) throw new Error(r.error.message || "Erro inesperado. Tente novamente.");
    return r.data;
  }
  var toastTimer;
  function toast(msg, isErr) {
    var el = document.getElementById("toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
    el.className = "toast" + (isErr ? " err" : "");
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3500);
  }
  function setNotice(el, msg, kind) {
    if (!msg) { el.hidden = true; return; }
    el.className = "notice " + (kind || "err"); el.textContent = msg; el.hidden = false;
  }
  function showSetupMissing(root) {
    root.innerHTML = '<div class="card"><h3>Configuração pendente</h3><p>Preencha o arquivo <b>config.js</b> com a URL e a chave <i>anon</i> do projeto Supabase e publique novamente.</p></div>';
  }

  // "Como conheceu o Drive?" (lista + campo livre para "Outros")
  var COMO = ["Indicação de amigos/familiares", "Passando em frente ao Drive", "Google", "Redes Sociais", "Prêmio Bom Gourmet", "Outros"];
  function comoHtml(id) {
    return '<div class="field"><label for="' + id + '">Como conheceu o Drive?</label><select id="' + id + '"><option value="">Selecione…</option>' +
      COMO.map(function (o) { return "<option>" + esc(o) + "</option>"; }).join("") + "</select>" +
      '<input type="text" id="' + id + 'Outro" maxlength="60" placeholder="Conte como nos conheceu" style="margin-top:8px" hidden></div>';
  }
  function bindComo(id) {
    var sel = $(id), out = $(id + "Outro");
    sel.addEventListener("change", function () { out.hidden = sel.value !== "Outros"; if (!out.hidden) out.focus(); });
  }
  function comoValue(id) {
    var v = $(id).value; if (!v) return "";
    if (v === "Outros") { var t = $(id + "Outro").value.trim(); return t ? "Outros: " + t : "Outros"; }
    return v;
  }
  window.DIB = {
    comoHtml: comoHtml, bindComo: bindComo, comoValue: comoValue,
    sb: sb, configured: configured, $: $, esc: esc, digits: digits, fmtPhone: fmtPhone, maskPhone: maskPhone,
    fmtDate: fmtDate, weekday: weekday, addDays: addDays, waLink: waLink, rpc: rpc, toast: toast,
    setNotice: setNotice, showSetupMissing: showSetupMissing
  };
})();
