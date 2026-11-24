(function () {
  "use strict";
  var D = window.DIB, $ = D.$;
  // tolerância a arquivos de versões diferentes publicados juntos: sem estes recursos a página ainda abre
  ["aplicarAreasRadios", "avisoGrupo"].forEach(function (k) { if (typeof D[k] !== "function") D[k] = function () {}; });
  var KEY = "dib_fila_token";
  var qtd = 2, pollTimer = null, lastStatus = null, lastPos = null;

  // ------------------------------------------------------------ sons
  // Usa elementos <audio> com sons gerados no próprio código (sem arquivos): tocam mesmo com o celular no modo
  // silencioso do iPhone e só precisam de UM toque do cliente na tela para serem liberados pelo navegador.
  var SOM_KEY = "dib_fila_som", somOn = true, chamadoTimer = null, silenciado = false, desbloqueado = false, SONS = null, wakeLock = null;
  try { somOn = localStorage.getItem(SOM_KEY) !== "off"; } catch (e) {}

  function wavUri(segs, total, quadrada) {
    var sr = 22050, n = Math.round(sr * total), pcm = new Int16Array(n);
    segs.forEach(function (g) {                        // g = [frequência, início(s), duração(s), volume]
      var i0 = Math.round(g[1] * sr), len = Math.round(g[2] * sr);
      for (var i = 0; i < len && i0 + i < n; i++) {
        var t = i / sr, env = Math.min(1, t / 0.008) * Math.exp(-3 * t / g[2]) , w = Math.sin(2 * Math.PI * g[0] * t);
        if (quadrada) w = w >= 0 ? 0.7 : -0.7;
        pcm[i0 + i] = Math.max(-32767, Math.min(32767, Math.round(w * env * g[3] * 32767)));
      }
    });
    var buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    function str(o, t) { for (var k = 0; k < t.length; k++) v.setUint8(o + k, t.charCodeAt(k)); }
    str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, "data"); v.setUint32(40, n * 2, true);
    for (var j = 0; j < n; j++) v.setInt16(44 + j * 2, pcm[j], true);
    var bin = "", bytes = new Uint8Array(buf);
    for (var q = 0; q < bytes.length; q += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(q, q + 8192));
    return "data:audio/wav;base64," + btoa(bin);
  }
  function sons() {
    if (SONS) return SONS;
    function el(uri, loop) { var a = new Audio(uri); a.preload = "auto"; a.loop = !!loop; return a; }
    SONS = {
      up: el(wavUri([[660, 0, 0.2, 0.7], [880, 0.18, 0.32, 0.7]], 0.55)),
      down: el(wavUri([[330, 0, 0.35, 0.7]], 0.4)),
      alert: el(wavUri([[1040, 0, 0.16, 0.9], [1040, 0.24, 0.16, 0.9], [1320, 0.48, 0.28, 0.9]], 2.2, true), true)
    };
    return SONS;
  }
  function tocar(a) {
    try { a.currentTime = 0; var p = a.play(); if (p && p.catch) p.catch(function () { desbloqueado = false; atualizarBanner(); }); } catch (e) {}
  }
  // o navegador só libera o áudio depois de um toque: ao primeiro toque, "acorda" os sons em silêncio
  function destravar() {
    if (desbloqueado) return;
    desbloqueado = true;
    var S = sons();
    ["up", "down", "alert"].forEach(function (k) {
      var a = S[k]; if (!a.paused) return;
      a.muted = true;
      var p; try { p = a.play(); } catch (e) {}
      if (p && p.then) p.then(function () { a.pause(); a.currentTime = 0; a.muted = false; }).catch(function () { a.muted = false; });
      else a.muted = false;
    });
    atualizarBanner();
  }
  function atualizarBanner() {
    var b = $("btnAtivarSom");
    var precisa = somOn && !desbloqueado && !$("vTicket").hidden;
    if (!b) {
      if (!precisa) return;
      b = document.createElement("button"); b.type = "button"; b.id = "btnAtivarSom"; b.className = "btn btn-gold";
      b.style.cssText = "width:100%;margin-bottom:12px"; b.textContent = "🔔 Toque aqui para ativar o alerta sonoro";
      b.onclick = function () { destravar(); if (somOn) tocar(sons().up); };
      $("vTicket").insertBefore(b, $("vTicket").firstChild);
    }
    b.hidden = !precisa;
  }
  function somTeste() { if (somOn) tocar(sons().up); }
  // posição mudou: subiu na fila = dois tons ascendentes; desceu (entrou prioridade na frente) = um tom grave
  function somPosicao(melhorou) {
    if (!somOn) return;
    tocar(melhorou ? sons().up : sons().down);
    try { if (navigator.vibrate) navigator.vibrate(120); } catch (e) {}
  }
  // chamado: padrão intermitente (3 bips rápidos, pausa) em repetição até o cliente silenciar ou a situação mudar
  function vibraChamado() { try { if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 300]); } catch (e) {} }
  function iniciarChamado() {
    if (chamadoTimer || silenciado) return;
    if (somOn) tocar(sons().alert);
    vibraChamado(); chamadoTimer = setInterval(vibraChamado, 2200);
  }
  function pararChamado() {
    if (chamadoTimer) { clearInterval(chamadoTimer); chamadoTimer = null; }
    if (SONS) { try { SONS.alert.pause(); SONS.alert.currentTime = 0; } catch (e) {} }
  }
  function atualizarBotaoSom() {
    var b = $("btnSom"); if (!b) return;
    b.textContent = somOn ? "🔔 Som ativado" : "🔕 Som desativado"; b.setAttribute("aria-pressed", somOn ? "true" : "false");
  }
  // mantém a tela acesa enquanto o cliente espera (celular com tela apagada não toca o alerta)
  function manterTela() {
    try {
      if (navigator.wakeLock && !wakeLock) navigator.wakeLock.request("screen").then(function (l) { wakeLock = l; l.addEventListener("release", function () { wakeLock = null; }); }).catch(function () {});
    } catch (e) {}
  }
  ["pointerdown", "touchstart", "keydown"].forEach(function (ev) { document.addEventListener(ev, destravar, { passive: true }); });

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
    var big = $("tPager"), lab = $("tLabel");
    $("tSenha").textContent = String(s.pager).padStart(3, "0");
    big.style.fontSize = "";
    if (s.status === "aguardando") { lab.textContent = "SUA POSIÇÃO NA FILA"; big.textContent = s.posicao + "º"; }
    else if (s.status === "chamado") { lab.textContent = "SUA VEZ"; big.textContent = "Mesa pronta"; big.style.fontSize = "36px"; }
    else { lab.textContent = "SENHA"; big.textContent = String(s.pager).padStart(3, "0"); }
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
      live.innerHTML = '<span class="live-aviso">Atualizamos a sua posição automaticamente.<br>Mantenha esta página aberta.</span>';
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
    atualizarBanner();
    if (s.status === "aguardando" || s.status === "chamado") manterTela();
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
    if (somOn) { destravar(); somTeste(); if (lastStatus === "chamado") { silenciado = false; iniciarChamado(); } } else pararChamado();
    atualizarBanner();
  };
  if ($("btnSilenciar")) $("btnSilenciar").onclick = function () { silenciado = true; pararChamado(); D.toast("Alerta silenciado. Procure a recepção."); };
  atualizarBotaoSom();

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) return;
    refresh(); manterTela();
    if (chamadoTimer && !silenciado && somOn && SONS && SONS.alert.paused) tocar(SONS.alert);
  });
  init();
})();
