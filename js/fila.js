(function () {
  "use strict";
  var D = window.DIB, $ = D.$;
  // tolerância a arquivos de versões diferentes publicados juntos: sem estes recursos a página ainda abre
  ["aplicarAreasRadios", "avisoGrupo"].forEach(function (k) { if (typeof D[k] !== "function") D[k] = function () {}; });
  var KEY = "dib_fila_token";
  var qtd = 2, pollTimer = null, lastStatus = null, lastPos = null;

  // ------------------------------------------------------------ sons (WebAudio, sem arquivos)
  // Navegadores só liberam áudio depois de um toque do usuário: o primeiro toque na página já destrava.
  var SOM_KEY = "dib_fila_som", actx = null, somOn = true, chamadoTimer = null, silenciado = false;
  try { somOn = localStorage.getItem(SOM_KEY) !== "off"; } catch (e) {}
  function ctx() {
    try {
      if (!actx) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; actx = new AC(); }
      if (actx.state === "suspended") actx.resume();
      return actx;
    } catch (e) { return null; }
  }
  function tom(freq, ini, dur, vol, tipo) {
    var c = ctx(); if (!c) return;
    var o = c.createOscillator(), g = c.createGain(), t = c.currentTime + ini;
    o.type = tipo || "sine"; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.25, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.05);
  }
  // posição mudou: subiu na fila = dois tons ascendentes; desceu (entrou prioridade na frente) = um tom grave
  function somPosicao(melhorou) {
    if (!somOn) return;
    if (melhorou) { tom(660, 0, 0.18, 0.22); tom(880, 0.16, 0.28, 0.22); }
    else tom(330, 0, 0.3, 0.2);
    try { if (navigator.vibrate) navigator.vibrate(120); } catch (e) {}
  }
  // chamado: padrão intermitente (3 bips rápidos, pausa) repetido até o cliente silenciar ou a situação mudar
  function ciclo() {
    if (!somOn) return;
    tom(1040, 0, 0.14, 0.35, "square"); tom(1040, 0.22, 0.14, 0.35, "square"); tom(1320, 0.44, 0.22, 0.35, "square");
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 300]); } catch (e) {}
  }
  function iniciarChamado() {
    if (chamadoTimer || silenciado) return;
    ciclo(); chamadoTimer = setInterval(ciclo, 2200);
  }
  function pararChamado() { if (chamadoTimer) { clearInterval(chamadoTimer); chamadoTimer = null; } }
  function atualizarBotaoSom() {
    var b = $("btnSom"); if (!b) return;
    b.textContent = somOn ? "🔔 Som ativado" : "🔕 Som desativado"; b.setAttribute("aria-pressed", somOn ? "true" : "false");
  }
  ["pointerdown", "touchstart", "keydown"].forEach(function (ev) { document.addEventListener(ev, function () { ctx(); }, { passive: true }); });

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
    D.avisoGrupo("aviso70T", $("tLive"), (s.status === "aguardando" || s.status === "chamado") ? s.pessoas : 0, true);
    $("btnCancel").hidden = !(s.status === "aguardando" || s.status === "chamado");
    $("btnNew").hidden = (s.status === "aguardando" || s.status === "chamado");

    var map = {
      aguardando: ["Aguardando", "warn"], chamado: ["Mesa pronta", "ok"], sentado: ["Atendido", "ok"],
      cancelado: ["Cancelada", "bad"], nao_compareceu: ["Não compareceu", "bad"], expirado: ["Expirada", "mute"]
    };
    var m = map[s.status] || [s.status, "mute"];
    st.innerHTML = '<span class="pill ' + m[1] + '">' + D.esc(m[0]) + "</span>";

    if (s.status === "aguardando") {
      live.innerHTML = "Sua posição: <strong>" + s.posicao + "º</strong>";
    } else if (s.status === "chamado") {
      live.innerHTML = "<strong>Estamos te chamando.</strong> Procure a recepção e informe a senha.";
    } else if (s.status === "sentado") {
      live.innerHTML = "Bom apetite! 🍔";
    } else {
      live.innerHTML = "Esta senha não está mais ativa.";
    }

    if (s.status === "chamado" && lastStatus !== "chamado") {
      document.title = "Mesa pronta! — Drive In Burger";
      silenciado = false;
    }
    if (s.status === "chamado") iniciarChamado(); else pararChamado();
    if (s.status === "aguardando") {
      if (lastPos !== null && s.posicao !== lastPos) somPosicao(s.posicao < lastPos);
      lastPos = s.posicao;
    } else lastPos = null;
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
  $("minus").onclick = function () { qtd = Math.max(1, qtd - 1); $("qtd").textContent = qtd; D.aplicarAreasRadios("area", qtd); avisoForm(); };
  $("plus").onclick = function () { qtd = Math.min(30, qtd + 1); $("qtd").textContent = qtd; D.aplicarAreasRadios("area", qtd); avisoForm(); };
  function avisoForm() { D.avisoGrupo("aviso70", $("qtd").closest(".field"), qtd, false); }
  D.aplicarAreasRadios("area", qtd); avisoForm();

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
      lastStatus = null; lastPos = null;
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
  $("btnNew").onclick = function () { localStorage.removeItem(KEY); lastStatus = null; lastPos = null; pararChamado(); document.title = "Fila de espera — Drive In Burger"; init(); };

  if ($("btnSom")) $("btnSom").onclick = function () {
    somOn = !somOn; try { localStorage.setItem(SOM_KEY, somOn ? "on" : "off"); } catch (e) {}
    atualizarBotaoSom();
    if (somOn) { tom(880, 0, 0.2, 0.2); if (lastStatus === "chamado") { silenciado = false; iniciarChamado(); } } else pararChamado();
  };
  if ($("btnSilenciar")) $("btnSilenciar").onclick = function () { silenciado = true; pararChamado(); D.toast("Alerta silenciado. Procure a recepção."); };
  atualizarBotaoSom();

  document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
  init();
})();
