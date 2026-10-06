(function () {
  "use strict";
  var D = window.DIB, $ = D.$;
  var KEY = "dib_fila_token";
  var qtd = 2, pollTimer = null, lastStatus = null;

  // link do QR gerado pela recepção: ?t=<token> devolve o cliente à sua senha
  (function () {
    var t = new URLSearchParams(location.search).get("t");
    if (t && /^[0-9a-f-]{36}$/i.test(t)) { localStorage.setItem(KEY, t); try { history.replaceState(null, "", location.pathname); } catch (e) {} }
  })();

  function show(id) {
    ["vLoading", "vClosed", "vForm", "vTicket"].forEach(function (v) { $(v).hidden = v !== id; });
  }

  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  function startPoll() { stopPoll(); pollTimer = setInterval(refresh, 4000); }

  function renderTicket(s) {
    $("tPager").textContent = String(s.pager).padStart(3, "0");
    $("tNome").textContent = s.nome;
    $("tPessoas").textContent = s.pessoas;
    $("tArea").textContent = s.area;
    $("rowPager").hidden = !s.pager_fisico; $("tPagerFis").textContent = s.pager_fisico || "";
    var st = $("tStatus"), live = $("tLive");
    $("calledBanner").hidden = s.status !== "chamado";
    $("btnCancel").hidden = !(s.status === "aguardando" || s.status === "chamado");
    $("btnNew").hidden = (s.status === "aguardando" || s.status === "chamado");

    var map = {
      aguardando: ["Aguardando", "warn"], chamado: ["Mesa pronta", "ok"], sentado: ["Atendido", "ok"],
      cancelado: ["Cancelada", "bad"], nao_compareceu: ["Não compareceu", "bad"], expirado: ["Expirada", "mute"]
    };
    var m = map[s.status] || [s.status, "mute"];
    st.innerHTML = '<span class="pill ' + m[1] + '">' + D.esc(m[0]) + "</span>";

    if (s.status === "aguardando") {
      var esp = s.espera_min > 0 ? "~" + s.espera_min + " min" : "a qualquer momento";
      live.innerHTML = "Sua posição: <strong>" + s.posicao + "º</strong> · Espera estimada: <strong>" + esp + "</strong>";
    } else if (s.status === "chamado") {
      live.innerHTML = "<strong>Estamos te chamando.</strong> Procure a recepção e informe a senha.";
    } else if (s.status === "sentado") {
      live.innerHTML = "Bom apetite! 🍔";
    } else {
      live.innerHTML = "Esta senha não está mais ativa.";
    }

    if (s.status === "chamado" && lastStatus !== "chamado") {
      try { if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]); } catch (e) {}
      document.title = "Mesa pronta! — Drive In Burger";
    }
    lastStatus = s.status;
    if (!(s.status === "aguardando" || s.status === "chamado")) stopPoll();
  }

  async function refresh() {
    var token = localStorage.getItem(KEY);
    if (!token) return;
    try {
      var s = await D.rpc("fila_status", { p_token: token });
      if (!s) { localStorage.removeItem(KEY); await init(); return; }
      show("vTicket"); renderTicket(s);
    } catch (e) { /* mantém a última tela; tenta de novo no próximo ciclo */ }
  }

  async function init() {
    if (!D.configured) { D.showSetupMissing($("root")); return; }
    try {
      var token = localStorage.getItem(KEY);
      if (token) {
        var s = await D.rpc("fila_status", { p_token: token });
        if (s && (s.status === "aguardando" || s.status === "chamado")) {
          show("vTicket"); renderTicket(s); startPoll(); return;
        }
        localStorage.removeItem(KEY);
      }
      var cfg = await D.rpc("config_publica");
      show(cfg.fila_aberta ? "vForm" : "vClosed");
    } catch (e) {
      $("root").innerHTML = '<div class="notice err">Não foi possível carregar a fila. Verifique sua conexão e recarregue a página.</div>';
    }
  }

  $("comoBox").innerHTML = D.comoHtml("como"); D.bindComo("como");
  D.maskPhone($("tel"));
  $("minus").onclick = function () { qtd = Math.max(1, qtd - 1); $("qtd").textContent = qtd; };
  $("plus").onclick = function () { qtd = Math.min(30, qtd + 1); $("qtd").textContent = qtd; };

  $("form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var err = $("formErr"); D.setNotice(err, "");
    var nome = $("nome").value.trim(), tel = $("tel").value.trim();
    if (nome.length < 2) { D.setNotice(err, "Informe seu nome."); return; }
    if (D.digits(tel).length < 10) { D.setNotice(err, "Informe um telefone válido, com DDD."); return; }
    var btn = $("submit"); btn.disabled = true;
    try {
      var r = await D.rpc("fila_entrar", {
        p_nome: nome, p_telefone: tel, p_pessoas: qtd,
        p_area: (document.querySelector('input[name="area"]:checked') || {}).value || "Sem preferência",
        p_como_conheceu: D.comoValue("como"), p_prioritario: false
      });
      localStorage.setItem(KEY, r.token);
      lastStatus = null;
      await refresh(); startPoll();
    } catch (ex) {
      D.setNotice(err, ex.message);
    } finally { btn.disabled = false; }
  });

  $("btnCancel").onclick = async function () {
    if (!confirm("Deseja sair da fila? Você perderá sua posição.")) return;
    try {
      await D.rpc("fila_cancelar", { p_token: localStorage.getItem(KEY) });
      await refresh();
    } catch (e) { D.toast(e.message, true); }
  };
  $("btnNew").onclick = function () { localStorage.removeItem(KEY); lastStatus = null; document.title = "Fila de espera — Drive In Burger"; init(); };

  document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
  init();
})();
