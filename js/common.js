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
  // Regra de salões por tamanho do grupo: acima de 8 só Mezanino; Kids comporta até 6 por mesa.
  function areaPermitida(area, pessoas) {
    if (pessoas > 8) return area === "Mezanino";
    if (pessoas > 6) return area !== "Kids";
    return true;
  }
  function areaAviso(pessoas) {
    if (pessoas > 8) return "Para grupos acima de 8 pessoas, atendemos somente no Mezanino.";
    if (pessoas > 6) return "O salão Kids comporta até 6 pessoas por mesa.";
    return "";
  }
  // radios (cliente): esconde as opções que não valem e troca a marcada se precisar
  function aplicarAreasRadios(nome, pessoas) {
    var radios = [].slice.call(document.querySelectorAll('input[name="' + nome + '"]'));
    if (!radios.length) return;
    radios.forEach(function (r) {
      var ok = areaPermitida(r.value, pessoas), lb = r.nextElementSibling;
      r.hidden = !ok; r.disabled = !ok; if (lb && lb.tagName === "LABEL") lb.hidden = !ok;
    });
    var marc = radios.filter(function (r) { return r.checked && !r.disabled; })[0];
    if (!marc) {
      var alvo = radios.filter(function (r) { return !r.disabled && r.value === "Mezanino"; })[0] || radios.filter(function (r) { return !r.disabled; })[0];
      if (alvo) { alvo.checked = true; alvo.dispatchEvent(new Event("change", { bubbles: true })); }
    }
    var box = radios[0].parentNode, hint = document.getElementById("areaHint");
    if (!hint) { hint = document.createElement("p"); hint.id = "areaHint"; hint.className = "hint"; box.parentNode.insertBefore(hint, box.nextSibling); }
    hint.textContent = areaAviso(pessoas); hint.hidden = !hint.textContent;
  }
  // select (painel da equipe)
  function aplicarAreasSelect(sel, pessoas, comTanto) {
    var atual = sel.value, ops = ["Salão Principal", "Mezanino", "Kids"].filter(function (a) { return areaPermitida(a, pessoas); });
    if (comTanto && pessoas <= 8) ops.unshift("Sem preferência");
    sel.innerHTML = ops.map(function (a) { return "<option" + (a === atual ? " selected" : "") + ">" + a + "</option>"; }).join("");
    if (ops.indexOf(atual) < 0) sel.value = pessoas > 8 ? "Mezanino" : ops[0];
  }
  // Aviso para grupos grandes: a mesa só é liberada com pelo menos 70% do grupo presente
  var GRUPO_70 = 6;
  function avisoGrupo(id, ancora, pessoas, antes) {
    var el = document.getElementById(id);
    if (!(pessoas >= GRUPO_70)) { if (el) el.hidden = true; return; }
    if (!el) {
      el = document.createElement("div"); el.id = id; el.className = "notice warn"; el.setAttribute("role", "note");
      el.style.marginTop = "12px";
      if (antes) ancora.parentNode.insertBefore(el, ancora); else ancora.parentNode.insertBefore(el, ancora.nextSibling);
    }
    var min = Math.ceil(pessoas * 0.7 - 1e-9);
    el.innerHTML = "<strong>Atenção:</strong> para grupos de 6 pessoas ou mais, a mesa <strong>somente é liberada com a presença de no mínimo 70% do grupo</strong>. No seu grupo de " + pessoas + ", é preciso que pelo menos <strong>" + min + " pessoas</strong> já estejam presentes.";
    el.hidden = false;
  }
  window.DIB = {
    avisoGrupo: avisoGrupo,
    areaPermitida: areaPermitida, areaAviso: areaAviso, aplicarAreasRadios: aplicarAreasRadios, aplicarAreasSelect: aplicarAreasSelect,
    comoHtml: comoHtml, bindComo: bindComo, comoValue: comoValue,
    sb: sb, configured: configured, $: $, esc: esc, digits: digits, fmtPhone: fmtPhone, maskPhone: maskPhone,
    fmtDate: fmtDate, weekday: weekday, addDays: addDays, waLink: waLink, rpc: rpc, toast: toast,
    setNotice: setNotice, showSetupMissing: showSetupMissing
  };
})();
