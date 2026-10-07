(function () {
  "use strict";
  var D = window.DIB, $ = D.$, sb = D.sb, esc = D.esc;
  var S = { cfg: null, hoje: "", resData: "", mesas: [], fila: [], reservas: [], reservasHoje: [], pendentes: 0, tab: "fila", edit: false, relDias: 7, bloqueios: [], staffNome: "", channel: null };
  var audio = null;
  var AREAS = ["Salão Principal", "Mezanino", "Kids"];
  function areaOpts(any, sel) {
    return (any ? "<option>Sem preferência</option>" : "") + AREAS.map(function (a) { return "<option" + (a === sel ? " selected" : "") + ">" + a + "</option>"; }).join("");
  }

  // ------------------------------------------------------------ utils
  function nowIso() { return new Date().toISOString(); }
  function todayIn(tz) { return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date()); }
  function minsSince(ts) { return Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000)); }
  function hhmm(t) { return String(t).slice(0, 5); }
  function inicioMs(r) { return new Date(r.data + "T" + hhmm(r.hora) + ":00").getTime(); }
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
  function natural(a, b) { return String(a.nome).localeCompare(String(b.nome), "pt-BR", { numeric: true }); }
  function mesaById(id) { return S.mesas.filter(function (m) { return m.id === id; })[0]; }
  function must(r) { if (r.error) throw new Error(r.error.message); return r.data; }
  function beep() {
    try {
      if (!audio) return;
      var o = audio.createOscillator(), g = audio.createGain();
      o.connect(g); g.connect(audio.destination); o.frequency.value = 880; g.gain.value = 0.08;
      o.start(); o.stop(audio.currentTime + 0.25);
    } catch (e) {}
  }
  document.addEventListener("click", function () {
    if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  }, { once: true });

  function show(id) { ["vLogin", "vDenied", "vApp"].forEach(function (v) { $(v).hidden = v !== id; }); $("logout").hidden = id === "vLogin"; }

  // ------------------------------------------------------------ modal
  function openModal(html, onMount) {
    var root = $("modalRoot");
    root.innerHTML = '<div class="overlay" id="ov"><div class="modal" role="dialog" aria-modal="true">' + html + "</div></div>";
    $("ov").addEventListener("mousedown", function (e) { if (e.target.id === "ov") closeModal(); });
    if (onMount) onMount(root.querySelector(".modal"));
  }
  function closeModal() { $("modalRoot").innerHTML = ""; }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });

  // ------------------------------------------------------------ auth
  async function boot() {
    if (!D.configured) { D.showSetupMissing($("root")); return; }
    var s = await sb.auth.getSession();
    if (s.data && s.data.session) await enter(s.data.session.user); else show("vLogin");
    sb.auth.onAuthStateChange(function (ev) { if (ev === "SIGNED_OUT") { teardown(); show("vLogin"); } });
  }

  $("loginForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var err = $("loginErr"); D.setNotice(err, ""); $("loginBtn").disabled = true;
    var r = await sb.auth.signInWithPassword({ email: $("email").value.trim(), password: $("senha").value });
    $("loginBtn").disabled = false;
    if (r.error) { D.setNotice(err, "E-mail ou senha incorretos."); return; }
    $("senha").value = ""; await enter(r.data.user);
  });
  async function signOut() { await sb.auth.signOut(); }
  $("logout").onclick = signOut; $("deniedOut").onclick = signOut;

  async function enter(user) {
    var r = await sb.from("staff").select("nome").eq("user_id", user.id).maybeSingle();
    if (r.error || !r.data) { show("vDenied"); return; }
    $("who").textContent = r.data.nome || user.email; S.staffNome = r.data.nome || user.email;
    try {
      await loadAll(); show("vApp"); renderAll(); subscribe();
    } catch (e) { D.toast("Erro ao carregar: " + e.message, true); }
  }
  function teardown() { if (S.channel) { sb.removeChannel(S.channel); S.channel = null; } }

  // ------------------------------------------------------------ data
  async function loadCfg() {
    S.cfg = must(await sb.from("settings").select("*").eq("id", 1).single());
    S.hoje = todayIn(S.cfg.fuso);
    if (!S.resData) S.resData = S.hoje;
  }
  async function loadMesas() { S.mesas = (must(await sb.from("mesas").select("*")) || []).sort(natural); }
  async function loadFila() { S.fila = must(await sb.from("fila").select("*").eq("dia", S.hoje).order("created_at")) || []; }
  async function loadReservas() {
    S.reservas = must(await sb.from("reservas").select("*").eq("data", S.resData).order("hora")) || [];
    S.reservasHoje = S.resData === S.hoje ? S.reservas
      : (must(await sb.from("reservas").select("*").eq("data", S.hoje).order("hora")) || []);
    var c = await sb.from("reservas").select("id", { count: "exact", head: true }).eq("status", "pendente").gte("data", S.hoje);
    S.pendentes = c.count || 0;
  }
  async function loadBloqueios() { S.bloqueios = must(await sb.from("bloqueios").select("*").order("data_ini", { ascending: false }).order("created_at", { ascending: false })) || []; }
  async function loadAll() { await loadCfg(); await Promise.all([loadMesas(), loadFila(), loadReservas(), loadBloqueios()]); }

  function subscribe() {
    teardown();
    var rf = debounce(async function () { try { await loadFila(); renderActive(); } catch (e) {} }, 400);
    var rr = debounce(async function () { try { await loadReservas(); renderActive(); } catch (e) {} }, 400);
    var rm = debounce(async function () { try { await loadMesas(); renderActive(); } catch (e) {} }, 400);
    S.channel = sb.channel("dib-equipe")
      .on("postgres_changes", { event: "*", schema: "public", table: "fila" }, function (p) { if (p.eventType === "INSERT") beep(); rf(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "reservas" }, function (p) { if (p.eventType === "INSERT") beep(); rr(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "mesas" }, rm)
      .on("postgres_changes", { event: "*", schema: "public", table: "bloqueios" }, function () { loadBloqueios().then(renderActive).catch(function () {}); })
      .subscribe();
  }
  // plano B caso o tempo real falhe + atualiza os "há X min"
  setInterval(async function () {
    if ($("vApp").hidden) return;
    try { await Promise.all([loadFila(), loadReservas(), loadMesas(), loadBloqueios()]); renderActive(); } catch (e) {}
  }, 30000);

  // ------------------------------------------------------------ tabs / render
  $("tabs").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-tab]"); if (!b) return;
    S.tab = b.getAttribute("data-tab"); renderAll();
  });
  function renderAll() {
    document.querySelectorAll("#tabs button").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-tab") === S.tab); });
    renderActive();
  }
  function renderActive() {
    var ae = document.activeElement;
    if (ae && ae.classList && ae.classList.contains("pg")) return;
    var ativos = S.fila.filter(function (f) { return f.status === "aguardando" || f.status === "chamado"; }).length;
    $("bFila").textContent = ativos;
    $("bRes").textContent = S.pendentes; $("bRes").hidden = S.pendentes === 0;
    var nb = bloqAtivos().filter(function (b) { return b.data_fim >= S.hoje; }).length;
    $("bBloq").textContent = nb; $("bBloq").hidden = nb === 0;
    if (S.tab === "fila") renderFila();
    else if (S.tab === "bloqueios") renderBloqueios();
    else if (S.tab === "reservas") renderReservas();
    else if (S.tab === "mesas") renderMesas();
    else if (S.tab === "rel") renderRel();
    else renderAjustes();
  }

  // ------------------------------------------------------------ mesa state
  function mesaEstado(m) {
    if (m.status === "ocupada") return "ocupada";
    if (m.status === "limpeza") return "limpeza";
    var now = Date.now(), dur = S.cfg.duracao_reserva_min * 60000;
    var r = S.reservasHoje.filter(function (x) {
      return x.mesa_id === m.id && (x.status === "pendente" || x.status === "confirmada" || x.status === "chegou") &&
        inicioMs(x) - now < 60 * 60000 && inicioMs(x) + dur > now;
    })[0];
    return r ? "reservada" : "livre";
  }
  var ESTADO_TXT = { livre: "Livre", ocupada: "Ocupada", reservada: "Reservada", limpeza: "Limpeza" };

  async function setMesaStatus(id, status) {
    must(await sb.from("mesas").update({ status: status, ocupada_desde: status === "ocupada" ? nowIso() : null }).eq("id", id));
  }

  function pickMesa(titulo, pessoas, area, preferId, onPick) {
    var lista = S.mesas.filter(function (m) { return m.ativa; });
    var itens = lista.map(function (m) {
      var est = mesaEstado(m);
      var cabe = m.cap_max >= pessoas && m.cap_min <= pessoas;
      var areaOk = !area || area === "Sem preferência" || m.area === area;
      var sug = (est === "livre" || m.id === preferId) && cabe && areaOk;
      return { m: m, est: est, sug: sug, ord: (m.id === preferId ? 0 : sug ? 1 : est === "livre" ? 2 : 3) };
    }).sort(function (a, b) { return a.ord - b.ord || natural(a.m, b.m); });
    openModal('<h3>' + esc(titulo) + '</h3><p class="hint" style="margin:-8px 0 12px">Grupo de ' + pessoas + ' pessoa(s). Sugestões aparecem primeiro.</p><div class="pick" id="pk">' +
      itens.map(function (i) {
        return '<button data-id="' + i.m.id + '" class="' + (i.sug ? "sug" : "") + '"><span><b>' + esc(i.m.nome) + "</b> · " + esc(i.m.area) + " · " + i.m.cap_min + "-" + i.m.cap_max +
          ' lugares</span><span class="pill ' + (i.est === "livre" ? "ok" : i.est === "reservada" ? "warn" : "bad") + '">' + ESTADO_TXT[i.est] + "</span></button>";
      }).join("") + '</div><div class="foot"><button class="btn btn-secondary" id="semMesa">Sentar sem mesa</button><button class="btn btn-secondary" id="cx">Cancelar</button></div>',
      function (m) {
        m.querySelectorAll("#pk button").forEach(function (b) { b.onclick = function () { closeModal(); onPick(b.getAttribute("data-id")); }; });
        m.querySelector("#semMesa").onclick = function () { closeModal(); onPick(null); };
        m.querySelector("#cx").onclick = closeModal;
      });
  }

  async function act(fn, okMsg) {
    try { await fn(); if (okMsg) D.toast(okMsg); await Promise.all([loadFila(), loadReservas(), loadMesas(), loadBloqueios()]); renderActive(); }
    catch (e) { D.toast(e.message || "Erro", true); }
  }

  // ------------------------------------------------------------ FILA
  function renderFila() {
    var all = S.fila;
    var chamados = all.filter(function (f) { return f.status === "chamado"; });
    var aguard = all.filter(function (f) { return f.status === "aguardando"; }).sort(function (a, b) {
      if (a.prioritario !== b.prioritario) return a.prioritario ? -1 : 1;
      return new Date(a.created_at) - new Date(b.created_at);
    });
    var fechados = all.filter(function (f) { return f.status === "sentado" || f.status === "cancelado" || f.status === "nao_compareceu"; });
    var sentados = fechados.filter(function (f) { return f.status === "sentado" && f.sentado_em; });
    var media = sentados.length ? Math.round(sentados.reduce(function (s, f) { return s + (new Date(f.sentado_em) - new Date(f.created_at)) / 60000; }, 0) / sentados.length) : null;
    var pessoasFila = aguard.concat(chamados).reduce(function (s, f) { return s + f.pessoas; }, 0);

    function item(f, pos) {
      var called = f.status === "chamado";
      return '<div class="item ' + (called ? "called" : "") + '" data-id="' + f.id + '"><div class="top"><div class="num">' + String(f.pager).padStart(3, "0") + '</div><div class="nm">' + esc(f.nome) + "</div>" +
        (f.prioritario ? '<span class="pill gold">Prioritário</span>' : "") + (called ? '<span class="pill ok">Chamado há ' + minsSince(f.chamado_em) + " min</span>" : "") + "</div>" +
        '<div class="meta">' + (pos ? "<span><b>" + pos + "º</b> na fila</span>" : "") + "<span>👥 <b>" + f.pessoas + "</b></span><span>📍 " + esc(f.area) + "</span><span>" +
        "📣 " + esc(f.como_conheceu) + "</span><span>⏱ há <b>" + minsSince(f.created_at) + " min</b></span><span>📞 " + esc(f.telefone) + "</span></div>" +
        '<div class="meta" style="align-items:center"><label>📟 Pager nº <input class="pg" type="text" inputmode="numeric" maxlength="10" value="' + esc(f.pager_fisico || "") + '" placeholder="—" style="width:84px;padding:6px 8px;display:inline-block"></label></div>' +
        '<div class="acts">' + (called ? "" : '<button class="btn btn-secondary btn-sm" data-act="chamar">Chamar</button>') +
        '<button class="btn btn-primary btn-sm" data-act="sentar">Sentar</button><button class="btn btn-secondary btn-sm" data-act="wa">WhatsApp</button>' +
        '<button class="btn btn-secondary btn-sm" data-act="qr">QR da fila</button><button class="btn btn-secondary btn-sm" data-act="prio">' + (f.prioritario ? "Tirar prioridade" : "Prioridade") + '</button>' +
        '<button class="btn btn-danger btn-sm" data-act="naoveio">Não veio</button></div></div>';
    }

    $("pane").innerHTML =
      '<div class="toolbar"><label class="switch"><input type="checkbox" id="filaAberta" ' + (S.cfg.fila_aberta ? "checked" : "") + '> Fila aberta para novos clientes</label><span class="grow"></span>' +
      '<button class="btn btn-gold btn-sm" id="addFila">+ Adicionar cliente</button></div>' +
      '<div class="stats"><div class="stat"><div class="n">' + (aguard.length + chamados.length) + '</div><div class="l">grupos na fila</div></div>' +
      '<div class="stat"><div class="n">' + pessoasFila + '</div><div class="l">pessoas esperando</div></div>' +
      '<div class="stat"><div class="n">' + (media === null ? "—" : media + " min") + '</div><div class="l">espera média (atendidos hoje)</div></div>' +
      '<div class="stat"><div class="n">' + sentados.length + '</div><div class="l">grupos atendidos hoje</div></div></div>' +
      (chamados.length ? '<div class="section-t">Chamados</div><div class="list cols">' + chamados.map(function (f) { return item(f, 0); }).join("") + "</div>" : "") +
      '<div class="section-t">Aguardando</div>' +
      (aguard.length ? '<div class="list cols">' + aguard.map(function (f, i) { return item(f, i + 1); }).join("") + "</div>" : '<div class="empty">Ninguém aguardando agora. 🎫</div>') +
      (fechados.length ? '<div class="section-t">Encerrados hoje (' + fechados.length + ")</div>" +
        '<div class="list cols">' + fechados.slice().reverse().map(function (f) {
          var t = f.status === "sentado" ? ["Atendido", "ok"] : f.status === "cancelado" ? ["Desistiu", "bad"] : ["Não veio", "bad"];
          return '<div class="item"><div class="top"><div class="num">' + String(f.pager).padStart(3, "0") + '</div><div class="nm">' + esc(f.nome) + '</div><span class="pill ' + t[1] + '">' + t[0] + "</span></div></div>";
        }).join("") + "</div>" : "");

    $("filaAberta").onchange = function () {
      var v = this.checked;
      act(async function () { must(await sb.from("settings").update({ fila_aberta: v }).eq("id", 1)); S.cfg.fila_aberta = v; }, v ? "Fila aberta" : "Fila fechada para novos clientes");
    };
    $("addFila").onclick = modalAddFila;
    $("pane").querySelectorAll("[data-act]").forEach(function (b) {
      b.onclick = function () { filaAct(b.getAttribute("data-act"), b.closest(".item").getAttribute("data-id")); };
    });
    $("pane").querySelectorAll("input.pg").forEach(function (inp) {
      inp.onchange = async function () {
        var id = inp.closest(".item").getAttribute("data-id"), v = inp.value.trim() || null;
        try { must(await sb.from("fila").update({ pager_fisico: v }).eq("id", id)); D.toast(v ? "Pager " + v + " registrado" : "Pager removido"); inp.blur(); await loadFila(); renderActive(); }
        catch (e) { D.toast(e.message, true); }
      };
      inp.onkeydown = function (e) { if (e.key === "Enter") inp.blur(); };
    });
  }

  function filaQr(f) { showQr("Acompanhe sua posição — senha " + String(f.pager).padStart(3, "0"), new URL("fila", location.href).href + "?t=" + f.token); }

  function filaAct(a, id) {
    var f = S.fila.filter(function (x) { return x.id === id; })[0]; if (!f) return;
    if (a === "qr") filaQr(f);
    else if (a === "prio") act(async function () { must(await sb.from("fila").update({ prioritario: !f.prioritario }).eq("id", id)); }, f.prioritario ? "Prioridade removida" : "Marcado como prioritário");
    else if (a === "chamar") act(async function () { must(await sb.from("fila").update({ status: "chamado", chamado_em: nowIso() }).eq("id", id)); }, "Cliente chamado. Avise pelo WhatsApp se não estiver por perto.");
    else if (a === "naoveio") { if (confirm("Marcar " + f.nome + " como 'não veio'?")) act(async function () { must(await sb.from("fila").update({ status: "nao_compareceu" }).eq("id", id)); }); }
    else if (a === "wa") window.open(D.waLink(f.telefone, "Olá, " + f.nome + "! Aqui é do Drive In Burger. Sua mesa está pronta (senha " + String(f.pager).padStart(3, "0") + "). Pode vir à recepção!"), "_blank", "noopener");
    else if (a === "sentar") pickMesa("Sentar " + f.nome, f.pessoas, f.area, null, function (mesaId) {
      act(async function () {
        must(await sb.from("fila").update({ status: "sentado", sentado_em: nowIso(), mesa_id: mesaId }).eq("id", id));
        if (mesaId) await setMesaStatus(mesaId, "ocupada");
      }, "Cliente sentado");
    });
  }

  function modalAddFila() {
    openModal('<h3>Adicionar cliente à fila</h3><div class="notice err" id="e" hidden></div>' +
      '<div class="field"><label>Nome</label><input type="text" id="n" maxlength="80"></div>' +
      '<div class="row2"><div class="field"><label>Telefone</label><input type="tel" id="t" placeholder="(41) 90000-0000"></div><div class="field"><label>Pessoas</label><input type="number" id="p" min="1" max="30" value="2"></div></div>' +
      '<div class="row2"><div class="field"><label>Área</label><select id="a">' + areaOpts(true) + '</select></div>' +
      '<div id="coBox"></div></div>' +
      '<div class="field"><label>Nº do pager (opcional)</label><input type="text" id="pg" inputmode="numeric" maxlength="10" placeholder="Número do pager entregue ao cliente"></div>' +
      '<label class="switch"><input type="checkbox" id="pr"> Atendimento prioritário (idoso, gestante, PCD)</label>' +
      '<div class="foot"><button class="btn btn-secondary" id="cx">Cancelar</button><button class="btn btn-primary" id="ok">Adicionar</button></div>',
      function (m) {
        D.maskPhone(m.querySelector("#t")); m.querySelector("#cx").onclick = closeModal;
        m.querySelector("#coBox").innerHTML = D.comoHtml("co"); D.bindComo("co");
        m.querySelector("#ok").onclick = async function () {
          try {
            var r = await D.rpc("fila_adicionar_equipe", { p_nome: m.querySelector("#n").value, p_telefone: m.querySelector("#t").value, p_pessoas: parseInt(m.querySelector("#p").value, 10),
              p_area: m.querySelector("#a").value, p_como_conheceu: D.comoValue("co"), p_prioritario: m.querySelector("#pr").checked });
            var pg = m.querySelector("#pg").value.trim();
            if (pg) must(await sb.from("fila").update({ pager_fisico: pg }).eq("token", r.token));
            closeModal(); await loadFila(); renderActive();
            if (r.ja_existia) D.toast("Este telefone já estava na fila (senha " + String(r.pager).padStart(3, "0") + ")");
            else filaQr({ pager: r.pager, token: r.token });
          } catch (e) { D.setNotice(m.querySelector("#e"), e.message); }
        };
      });
  }

  // ------------------------------------------------------------ RESERVAS
  var RES_ST = { pendente: ["Pendente", "warn"], confirmada: ["Confirmada", "ok"], chegou: ["Chegou", "gold"], sentada: ["Sentada", "ok"],
    concluida: ["Concluída", "mute"], cancelada: ["Cancelada", "bad"], nao_compareceu: ["Não compareceu", "bad"] };

  function renderReservas() {
    var tol = S.cfg.tolerancia_atraso_min * 60000;
    var ativas = S.reservas.filter(function (r) { return ["pendente", "confirmada", "chegou", "sentada"].indexOf(r.status) >= 0; });
    var fim = S.reservas.filter(function (r) { return ["concluida", "cancelada", "nao_compareceu"].indexOf(r.status) >= 0; });
    var pessoas = ativas.reduce(function (s, r) { return s + r.pessoas; }, 0);
    var noshow = S.reservas.filter(function (r) { return r.status === "nao_compareceu"; }).length;

    function item(r) {
      var st = RES_ST[r.status], mesa = r.mesa_id ? mesaById(r.mesa_id) : null;
      var late = r.data === S.hoje && r.status === "confirmada" && Date.now() > inicioMs(r) + tol;
      var acts = "";
      if (r.status === "pendente") acts += '<button class="btn btn-primary btn-sm" data-act="confirmar">Confirmar</button>';
      if (r.status === "confirmada") acts += '<button class="btn btn-primary btn-sm" data-act="chegou">Cliente chegou</button>';
      if (r.status === "chegou") acts += '<button class="btn btn-primary btn-sm" data-act="sentar">Sentar</button>';
      if (r.status === "sentada") acts += '<button class="btn btn-primary btn-sm" data-act="finalizar">Finalizar</button>';
      if (r.status === "pendente" || r.status === "confirmada") acts += '<button class="btn btn-danger btn-sm" data-act="naocomp">Não compareceu</button><button class="btn btn-danger btn-sm" data-act="cancelar">Cancelar</button>';
      if (r.status === "pendente" || r.status === "confirmada" || r.status === "chegou") acts += '<button class="btn btn-secondary btn-sm" data-act="wa">WhatsApp</button>';
      return '<div class="item ' + (late ? "late" : "") + '" data-id="' + r.id + '"><div class="top"><div class="num">' + hhmm(r.hora) + '</div><div class="nm">' + esc(r.nome) + " · " + r.pessoas + 'p</div>' +
        (late ? '<span class="pill bad">Atrasada</span>' : "") + '<span class="pill ' + st[1] + '">' + st[0] + "</span></div>" +
        '<div class="meta"><span>🔑 <b>' + esc(r.codigo) + "</b></span><span>📞 " + esc(r.telefone) + "</span><span>📍 " + esc(r.area) + (mesa ? " · mesa <b>" + esc(mesa.nome) + "</b>" : "") + "</span><span>" +
        "📣 " + esc(r.como_conheceu) + "</span><span>" + (r.origem === "equipe" ? "☎️ equipe" : "🌐 online") + "</span>" + (r.obs ? "<span>📝 " + esc(r.obs) + "</span>" : "") + "</div>" +
        (acts ? '<div class="acts">' + acts + "</div>" : "") + "</div>";
    }

    $("pane").innerHTML =
      '<div class="toolbar"><div class="daynav"><button class="btn btn-secondary btn-sm" id="dPrev">‹</button><input type="date" id="dSel" value="' + S.resData + '"><button class="btn btn-secondary btn-sm" id="dNext">›</button>' +
      '<button class="btn btn-secondary btn-sm" id="dHoje">Hoje</button><span class="title">' + D.weekday(S.resData) + "</span></div><span class=\"grow\"></span>" +
      '<button class="btn btn-gold btn-sm" id="novaRes">+ Nova reserva</button></div>' +
      bloqBanner(S.resData) + '<div class="stats"><div class="stat"><div class="n">' + ativas.length + '</div><div class="l">reservas ativas</div></div><div class="stat"><div class="n">' + pessoas + '</div><div class="l">pessoas esperadas</div></div>' +
      '<div class="stat"><div class="n">' + S.pendentes + '</div><div class="l">pendentes de confirmação</div></div><div class="stat"><div class="n">' + noshow + '</div><div class="l">não compareceram (dia)</div></div></div>' +
      (ativas.length ? '<div class="list cols">' + ativas.map(item).join("") + "</div>" : '<div class="empty">Nenhuma reserva ativa neste dia. 📅</div>') +
      (fim.length ? '<div class="section-t">Encerradas (' + fim.length + ')</div><div class="list cols">' + fim.map(item).join("") + "</div>" : "");

    function go(d) { S.resData = d; act(async function () { await loadReservas(); }); }
    $("dSel").onchange = function () { if (this.value) go(this.value); };
    $("dPrev").onclick = function () { go(D.addDays(S.resData, -1)); };
    $("dNext").onclick = function () { go(D.addDays(S.resData, 1)); };
    $("dHoje").onclick = function () { go(S.hoje); };
    $("novaRes").onclick = modalNovaReserva;
    $("pane").querySelectorAll("[data-act]").forEach(function (b) { b.onclick = function () { resAct(b.getAttribute("data-act"), b.closest(".item").getAttribute("data-id")); }; });
  }

  function setRes(id, patch) { return async function () { must(await sb.from("reservas").update(patch).eq("id", id)); }; }

  function resAct(a, id) {
    var r = S.reservas.filter(function (x) { return x.id === id; })[0]; if (!r) return;
    if (a === "confirmar") act(setRes(id, { status: "confirmada" }), "Reserva confirmada");
    else if (a === "chegou") act(setRes(id, { status: "chegou" }), "Check-in feito");
    else if (a === "naocomp") { if (confirm("Marcar " + r.nome + " como 'não compareceu'?")) act(setRes(id, { status: "nao_compareceu" })); }
    else if (a === "cancelar") { if (confirm("Cancelar a reserva de " + r.nome + "?")) act(setRes(id, { status: "cancelada" })); }
    else if (a === "wa") window.open(D.waLink(r.telefone, "Olá, " + r.nome + "! Sua reserva " + r.codigo + " no Drive In Burger para " + D.fmtDate(r.data) + " às " + hhmm(r.hora) + " (" + r.pessoas + " pessoas) está confirmada. Até lá!"), "_blank", "noopener");
    else if (a === "sentar") pickMesa("Sentar " + r.nome, r.pessoas, r.area, r.mesa_id, function (mesaId) {
      act(async function () { await setRes(id, { status: "sentada", mesa_id: mesaId })(); if (mesaId) await setMesaStatus(mesaId, "ocupada"); }, "Cliente sentado");
    });
    else if (a === "finalizar") act(async function () {
      await setRes(id, { status: "concluida" })();
      var m = r.mesa_id ? mesaById(r.mesa_id) : null;
      if (m && m.status === "ocupada") await setMesaStatus(m.id, "limpeza");
    }, "Reserva finalizada. Mesa em limpeza.");
  }

  function modalNovaReserva() {
    openModal('<h3>Nova reserva (equipe)</h3><div class="notice err" id="e" hidden></div>' +
      '<div class="field"><label>Nome</label><input type="text" id="n" maxlength="80"></div>' +
      '<div class="row2"><div class="field"><label>Telefone</label><input type="tel" id="t" placeholder="(41) 90000-0000"></div><div class="field"><label>Pessoas</label><input type="number" id="p" min="1" max="100" value="2"></div></div>' +
      '<div class="row2"><div class="field"><label>Data</label><input type="date" id="d" value="' + S.resData + '"></div><div class="field"><label>Horário</label><input type="time" id="h" value="19:00"></div></div>' +
      '<div class="row2"><div class="field"><label>Área</label><select id="a">' + areaOpts(true) + '</select></div>' +
      '<div id="coBox"></div></div>' +
      '<div class="field"><label>Observações</label><textarea id="ob" maxlength="300"></textarea></div>' +
      '<div class="foot"><button class="btn btn-secondary" id="cx">Cancelar</button><button class="btn btn-primary" id="ok">Reservar</button></div>',
      function (m) {
        D.maskPhone(m.querySelector("#t")); m.querySelector("#cx").onclick = closeModal;
        m.querySelector("#coBox").innerHTML = D.comoHtml("co"); D.bindComo("co");
        m.querySelector("#ok").onclick = async function () {
          try {
            var bl = bloqueiosQueAtingem(m.querySelector("#d").value, m.querySelector("#h").value);
            if (bl.length && !confirm("Este horário está bloqueado para reservas online:\n" + bl.map(function (b) { return "• " + bloqEscopo(b) + ": " + b.motivo; }).join("\n") + "\n\nCriar a reserva mesmo assim?")) return;
            var r = await D.rpc("reserva_criar_equipe", { p_nome: m.querySelector("#n").value, p_telefone: m.querySelector("#t").value, p_email: null, p_data: m.querySelector("#d").value,
              p_hora: m.querySelector("#h").value, p_pessoas: parseInt(m.querySelector("#p").value, 10), p_area: m.querySelector("#a").value, p_como_conheceu: D.comoValue("co"), p_obs: m.querySelector("#ob").value || null });
            closeModal(); D.toast("Reserva criada: " + r.codigo); S.resData = m.querySelector("#d").value; await loadReservas(); renderActive();
          } catch (e) { D.setNotice(m.querySelector("#e"), e.message); }
        };
      });
  }

  // ------------------------------------------------------------ MESAS
  var CELL = 64, COLS = 12, ROWS = 8;
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function renderMesas() {
    var cont = { livre: 0, ocupada: 0, reservada: 0, limpeza: 0 };
    S.mesas.forEach(function (m) { if (m.ativa) cont[mesaEstado(m)]++; });
    $("pane").innerHTML =
      '<div class="toolbar"><div class="legend" style="margin:0"><span><i style="border-color:var(--success)"></i>Livre (' + cont.livre + ')</span><span><i style="border-color:var(--red)"></i>Ocupada (' + cont.ocupada +
      ')</span><span><i style="border-color:var(--gold)"></i>Reservada (' + cont.reservada + ')</span><span><i style="border-color:var(--text-muted);border-style:dashed"></i>Limpeza (' + cont.limpeza + ')</span></div><span class="grow"></span>' +
      '<label class="switch"><input type="checkbox" id="editMap" ' + (S.edit ? "checked" : "") + '> Editar layout</label><button class="btn btn-gold btn-sm" id="addMesa">+ Mesa</button></div>' +
      (S.edit ? '<div class="notice warn">Arraste as mesas para reorganizar o salão. Toque numa mesa para editar ou excluir.</div>' : "") +
      '<div class="map-scroll"><div class="map" id="map"></div></div>';
    var map = $("map");
    S.mesas.forEach(function (m) {
      var est = mesaEstado(m), el = document.createElement("div");
      el.className = "mesa " + est + (m.ativa ? "" : " inativa") + (S.edit ? " edit" : "");
      el.style.left = m.pos_x * CELL + "px"; el.style.top = m.pos_y * CELL + "px";
      el.innerHTML = esc(m.nome) + "<small>" + m.cap_min + "-" + m.cap_max + "</small>";
      el.title = m.nome + " · " + m.area + " · " + ESTADO_TXT[est];
      if (S.edit) bindDrag(el, m); else el.onclick = function () { modalMesa(m); };
      map.appendChild(el);
    });
    $("editMap").onchange = function () { S.edit = this.checked; renderMesas(); };
    $("addMesa").onclick = modalNovaMesa;
  }

  function bindDrag(el, m) {
    el.addEventListener("pointerdown", function (ev) {
      ev.preventDefault();
      try { el.setPointerCapture(ev.pointerId); } catch (e) {}
      var sx = ev.clientX, sy = ev.clientY, ox = m.pos_x * CELL, oy = m.pos_y * CELL, moved = false;
      function move(e) {
        var dx = e.clientX - sx, dy = e.clientY - sy;
        if (Math.abs(dx) + Math.abs(dy) > 5) moved = true;
        el.style.left = ox + dx + "px"; el.style.top = oy + dy + "px";
      }
      async function up(e) {
        el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
        if (!moved) { modalEditMesa(m); return; }
        var nx = clamp(Math.round((ox + e.clientX - sx) / CELL), 0, COLS - 1), ny = clamp(Math.round((oy + e.clientY - sy) / CELL), 0, ROWS - 1);
        var ocupado = S.mesas.some(function (o) { return o.id !== m.id && o.pos_x === nx && o.pos_y === ny; });
        if (ocupado) { renderMesas(); D.toast("Já existe uma mesa nessa posição.", true); return; }
        m.pos_x = nx; m.pos_y = ny; renderMesas();
        try { must(await sb.from("mesas").update({ pos_x: nx, pos_y: ny }).eq("id", m.id)); } catch (er) { D.toast(er.message, true); }
      }
      el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    });
  }

  function modalMesa(m) {
    var est = mesaEstado(m);
    var prox = S.reservasHoje.filter(function (r) { return r.mesa_id === m.id && ["pendente", "confirmada", "chegou"].indexOf(r.status) >= 0 && inicioMs(r) + S.cfg.duracao_reserva_min * 60000 > Date.now(); });
    openModal("<h3>Mesa " + esc(m.nome) + '</h3><p class="hint" style="margin:-8px 0 12px">' + esc(m.area) + " · " + m.cap_min + "-" + m.cap_max + ' lugares · <b>' + ESTADO_TXT[est] + "</b>" +
      (m.status === "ocupada" && m.ocupada_desde ? " há " + minsSince(m.ocupada_desde) + " min" : "") + "</p>" +
      (prox.length ? '<div class="section-t" style="margin-top:0">Reservas de hoje nesta mesa</div>' + prox.map(function (r) { return '<div class="trow"><span class="k">' + hhmm(r.hora) + '</span><span class="v">' + esc(r.nome) + " · " + r.pessoas + "p</span></div>"; }).join("") : "") +
      '<div class="foot" style="flex-wrap:wrap"><button class="btn btn-secondary" data-s="livre">Liberar</button><button class="btn btn-secondary" data-s="ocupada">Ocupada</button><button class="btn btn-secondary" data-s="limpeza">Limpeza</button></div>' +
      '<div class="foot"><button class="btn btn-secondary" id="cx">Fechar</button></div>',
      function (md) {
        md.querySelector("#cx").onclick = closeModal;
        md.querySelectorAll("[data-s]").forEach(function (b) { b.onclick = function () { closeModal(); act(function () { return setMesaStatus(m.id, b.getAttribute("data-s")); }); }; });
      });
  }

  function mesaForm(m) {
    return '<div class="notice err" id="e" hidden></div><div class="row2"><div class="field"><label>Nome</label><input type="text" id="n" maxlength="20" value="' + esc(m ? m.nome : "") + '"></div>' +
      '<div class="field"><label>Área</label><select id="a">' + areaOpts(false, m && m.area) + '</select></div></div>' +
      '<div class="row2"><div class="field"><label>Lugares (mín.)</label><input type="number" id="mn" min="1" value="' + (m ? m.cap_min : 1) + '"></div><div class="field"><label>Lugares (máx.)</label><input type="number" id="mx" min="1" value="' + (m ? m.cap_max : 4) + '"></div></div>';
  }
  function readMesa(md) {
    var mn = parseInt(md.querySelector("#mn").value, 10), mx = parseInt(md.querySelector("#mx").value, 10), n = md.querySelector("#n").value.trim();
    if (!n) throw new Error("Informe o nome da mesa.");
    if (!(mn >= 1) || !(mx >= mn)) throw new Error("A capacidade máxima deve ser maior ou igual à mínima.");
    return { nome: n, area: md.querySelector("#a").value, cap_min: mn, cap_max: mx };
  }

  function modalNovaMesa() {
    openModal("<h3>Nova mesa</h3>" + mesaForm(null) + '<div class="foot"><button class="btn btn-secondary" id="cx">Cancelar</button><button class="btn btn-primary" id="ok">Adicionar</button></div>', function (md) {
      md.querySelector("#cx").onclick = closeModal;
      md.querySelector("#ok").onclick = async function () {
        try {
          var d = readMesa(md), pos = null;
          for (var y = 0; y < ROWS && !pos; y++) for (var x = 0; x < COLS && !pos; x++) {
            if (!S.mesas.some(function (o) { return o.pos_x === x && o.pos_y === y; })) pos = { x: x, y: y };
          }
          if (!pos) throw new Error("O mapa está cheio.");
          d.pos_x = pos.x; d.pos_y = pos.y; must(await sb.from("mesas").insert(d));
          closeModal(); D.toast("Mesa adicionada"); await loadMesas(); renderActive();
        } catch (e) { D.setNotice(md.querySelector("#e"), e.message); }
      };
    });
  }

  function modalEditMesa(m) {
    openModal("<h3>Editar mesa " + esc(m.nome) + "</h3>" + mesaForm(m) +
      '<label class="switch"><input type="checkbox" id="at" ' + (m.ativa ? "checked" : "") + '> Mesa ativa (aceita reservas e fila)</label>' +
      '<div class="foot"><button class="btn btn-danger" id="del">Excluir</button><button class="btn btn-secondary" id="cx">Cancelar</button><button class="btn btn-primary" id="ok">Salvar</button></div>', function (md) {
      md.querySelector("#cx").onclick = closeModal;
      md.querySelector("#ok").onclick = async function () {
        try { var d = readMesa(md); d.ativa = md.querySelector("#at").checked; must(await sb.from("mesas").update(d).eq("id", m.id)); closeModal(); D.toast("Mesa salva"); await loadMesas(); renderActive(); }
        catch (e) { D.setNotice(md.querySelector("#e"), e.message); }
      };
      md.querySelector("#del").onclick = async function () {
        if (!confirm("Excluir a mesa " + m.nome + "? Reservas já feitas nela ficarão sem mesa definida.")) return;
        try { must(await sb.from("mesas").delete().eq("id", m.id)); closeModal(); D.toast("Mesa excluída"); await Promise.all([loadMesas(), loadReservas()]); renderActive(); }
        catch (e) { D.setNotice(md.querySelector("#e"), e.message); }
      };
    });
  }

  // ------------------------------------------------------------ RELATÓRIOS
  var relSeq = 0;
  async function fetchAll(table, cols, apply) {
    var out = [], from = 0, step = 1000;
    for (;;) {
      var rows = must(await apply(sb.from(table).select(cols)).range(from, from + step - 1)) || [];
      out = out.concat(rows);
      if (rows.length < step) break;
      from += step;
    }
    return out;
  }
  var ORIGENS_LISTA = ["Indicação de amigos/familiares", "Passando em frente ao Drive", "Google", "Redes Sociais", "Prêmio Bom Gourmet", "Outros"];
  function normOrigem(v) {
    v = String(v || "").trim();
    if (!v || v === "Não informado") return "Não informado";
    return ORIGENS_LISTA.indexOf(v) >= 0 ? v : "Outros";   // "Outros: texto" e valores inesperados entram em "Outros"
  }
  var REL_PERIODOS = [[1, "Hoje"], [7, "7 dias"], [30, "30 dias"], [90, "90 dias"]];

  async function renderRel() {
    var id = ++relSeq;
    $("pane").innerHTML = '<div class="empty">Calculando…</div>';
    try {
      var n = S.relDias || 7, ini = D.addDays(S.hoje, -(n - 1));
      var f = await fetchAll("fila", "dia,status,created_at,sentado_em,pessoas,como_conheceu", function (q) { return q.gte("dia", ini).order("created_at"); });
      var r = await fetchAll("reservas", "data,status,pessoas,origem,como_conheceu,created_at", function (q) { return q.gte("data", ini).lte("data", S.hoje).order("created_at"); });
      if (id !== relSeq || S.tab !== "rel") return;

      // ---- números gerais
      var sent = f.filter(function (x) { return x.status === "sentado" && x.sentado_em; });
      var media = sent.length ? Math.round(sent.reduce(function (s, x) { return s + (new Date(x.sentado_em) - new Date(x.created_at)) / 60000; }, 0) / sent.length) : null;
      var desist = f.filter(function (x) { return x.status === "cancelado" || x.status === "nao_compareceu"; }).length;
      var comparec = r.filter(function (x) { return ["chegou", "sentada", "concluida"].indexOf(x.status) >= 0; }).length;
      var nos = r.filter(function (x) { return x.status === "nao_compareceu"; }).length;
      var cancel = r.filter(function (x) { return x.status === "cancelada"; }).length;
      var taxaNo = comparec + nos ? Math.round(nos * 100 / (comparec + nos)) : null;

      // ---- barras por dia (até 7 dias) ou por semana
      var size = n <= 7 ? 1 : 7, buckets = [];
      for (var i = 0; i < n; i += size) buckets.push([D.addDays(ini, i), D.addDays(ini, Math.min(i + size, n) - 1)]);
      function inB(v, b) { return v >= b[0] && v <= b[1]; }
      function lab(b) { var a = b[0].slice(8) + "/" + b[0].slice(5, 7); return size === 1 ? a : a + " a " + b[1].slice(8) + "/" + b[1].slice(5, 7); }
      var fB = buckets.map(function (b) { return f.filter(function (x) { return inB(x.dia, b); }).length; });
      var rB = buckets.map(function (b) { return r.filter(function (x) { return inB(x.data, b) && x.status !== "cancelada"; }).length; });
      function bars(vals) {
        var mx = Math.max.apply(null, vals.concat([1]));
        return '<div class="bars">' + buckets.map(function (b, i) {
          return '<div class="bar-row" style="grid-template-columns:' + (size === 1 ? 70 : 120) + 'px 1fr 40px"><span>' + lab(b) + '</span><div class="bar"><i style="width:' + Math.round(vals[i] * 100 / mx) + '%"></i></div><b>' + vals[i] + "</b></div>";
        }).join("") + "</div>";
      }

      // ---- como conheceu o Drive
      var ORIGENS = ORIGENS_LISTA;
      var cont = {}; ORIGENS.concat(["Não informado"]).forEach(function (k) { cont[k] = { fila: 0, res: 0 }; });
      var outrosTxt = {};
      function conta(v, tipo) {
        var k = normOrigem(v); if (!cont[k]) cont[k] = { fila: 0, res: 0 };
        cont[k][tipo]++;
        if (k === "Outros" && String(v).indexOf("Outros:") === 0) {
          var t = String(v).slice(7).trim(), key = t.toLowerCase(); if (t) outrosTxt[key] = outrosTxt[key] || { t: t, n: 0 }, outrosTxt[key].n++;
        }
      }
      f.forEach(function (x) { conta(x.como_conheceu, "fila"); });
      r.forEach(function (x) { conta(x.como_conheceu, "res"); });
      var tot = function (k) { return cont[k].fila + cont[k].res; };
      var informados = ORIGENS.reduce(function (s, k) { return s + tot(k); }, 0);
      var ranking = ORIGENS.slice().sort(function (a, b) { return tot(b) - tot(a); });
      var topo = informados && tot(ranking[0]) ? ranking[0] : null;
      var maxO = Math.max(tot(ranking[0]), 1);
      var origHtml = ranking.map(function (k) {
        var t = tot(k), pct = informados ? Math.round(t * 100 / informados) : 0;
        return '<div class="orig-row"><div class="orig-top"><b>' + esc(k) + "</b><span>" + t + " · " + pct + '% <small>fila ' + cont[k].fila + " · reservas " + cont[k].res + '</small></span></div><div class="bar"><i style="width:' + Math.round(t * 100 / maxO) + '%"></i></div></div>';
      }).join("");
      var outrosList = Object.keys(outrosTxt).map(function (k) { return outrosTxt[k]; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 10);
      var semInfo = tot("Não informado"), totalClientes = informados + semInfo;

      var perHtml = REL_PERIODOS.map(function (p) { return '<button class="btn btn-sm ' + (p[0] === n ? "btn-primary" : "btn-secondary") + '" data-per="' + p[0] + '">' + p[1] + "</button>"; }).join("");
      $("pane").innerHTML =
        '<div class="toolbar"><div class="daynav">' + perHtml + '</div><span class="grow"></span><span class="hint" style="margin:0">' + D.fmtDate(ini) + " a " + D.fmtDate(S.hoje) + "</span></div>" +
        '<div class="stats">' +
        '<div class="stat"><div class="n">' + f.length + '</div><div class="l">entradas na fila</div></div>' +
        '<div class="stat"><div class="n">' + (media === null ? "—" : media + " min") + '</div><div class="l">espera média até sentar</div></div>' +
        '<div class="stat"><div class="n">' + (f.length ? Math.round(desist * 100 / f.length) + "%" : "—") + '</div><div class="l">desistência na fila</div></div>' +
        '<div class="stat"><div class="n">' + r.length + '</div><div class="l">reservas feitas</div></div>' +
        '<div class="stat"><div class="n">' + (taxaNo === null ? "—" : taxaNo + "%") + '</div><div class="l">no-show das reservas</div></div>' +
        '<div class="stat"><div class="n">' + cancel + '</div><div class="l">reservas canceladas</div></div></div>' +
        '<div class="card"><h3 style="font-size:17px;margin-bottom:4px">Como os clientes conheceram o Drive</h3>' +
        '<p class="hint" style="margin:0 0 14px">Fila e reservas juntas. ' + (topo ? "Canal que mais traz clientes: <b>" + esc(topo) + "</b>. " : "") +
        (totalClientes ? semInfo + " de " + totalClientes + " não responderam (" + Math.round(semInfo * 100 / totalClientes) + "%); os percentuais consideram só quem respondeu." : "Sem registros no período.") + "</p>" +
        (informados ? origHtml : '<div class="empty" style="padding:16px">Ninguém respondeu neste período.</div>') +
        (outrosList.length ? '<div class="section-t">O que escreveram em "Outros"</div>' + outrosList.map(function (o) { return '<div class="trow"><span class="k">' + esc(o.t) + '</span><span class="v">' + o.n + "</span></div>"; }).join("") : "") + "</div>" +
        '<div class="card"><h3 style="font-size:17px;margin-bottom:12px">Fila ' + (size === 1 ? "por dia" : "por semana") + "</h3>" + bars(fB) + "</div>" +
        '<div class="card"><h3 style="font-size:17px;margin-bottom:12px">Reservas ' + (size === 1 ? "por dia" : "por semana") + "</h3>" + bars(rB) + "</div>";

      $("pane").querySelectorAll("[data-per]").forEach(function (b) { b.onclick = function () { S.relDias = parseInt(b.getAttribute("data-per"), 10); renderRel(); }; });
    } catch (e) { $("pane").innerHTML = '<div class="notice err">' + esc(e.message) + "</div>"; }
  }

  // ------------------------------------------------------------ BLOQUEIOS
  function bloqAtivos() { return S.bloqueios.filter(function (b) { return !b.removido_em; }); }
  function bloqEscopo(b) {
    if (b.hora_ini) return "Horários de " + hhmm(b.hora_ini) + " às " + hhmm(b.hora_fim);
    if (b.turno === "almoco") return "Almoço";
    if (b.turno === "jantar") return "Jantar";
    return "Dia inteiro";
  }
  function bloqPeriodo(b) { return b.data_ini === b.data_fim ? D.fmtDate(b.data_ini) : D.fmtDate(b.data_ini) + " a " + D.fmtDate(b.data_fim); }
  function turnoDeHora(data, hora) {
    var fx = (S.cfg.horarios || {})[String(new Date(data + "T12:00:00").getDay())] || [];
    for (var i = 0; i < fx.length; i++) if (hora >= fx[i][0] && hora <= fx[i][1]) return fx[i][2] || (fx[i][0] < "16:00" ? "almoco" : "jantar");
    return hora < "16:00" ? "almoco" : "jantar";
  }
  function bloqueiaHorario(b, data, hora) {
    if (data < b.data_ini || data > b.data_fim) return false;
    if (b.hora_ini) return hora >= hhmm(b.hora_ini) && hora < hhmm(b.hora_fim);
    return !b.turno || turnoDeHora(data, hora) === b.turno;
  }
  function bloqueiosQueAtingem(data, hora) { return bloqAtivos().filter(function (b) { return bloqueiaHorario(b, data, hora); }); }
  function bloqBanner(data) {
    var l = bloqAtivos().filter(function (b) { return data >= b.data_ini && data <= b.data_fim; });
    if (!l.length) return "";
    return '<div class="notice warn">🚫 <b>Reservas online bloqueadas neste dia:</b> ' + l.map(function (b) { return esc(bloqEscopo(b)) + " — " + esc(b.motivo); }).join(" · ") + "</div>";
  }
  function fmtQuando(ts) { var d = new Date(ts); return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }

  function renderBloqueios() {
    var ativos = bloqAtivos().filter(function (b) { return b.data_fim >= S.hoje; }).sort(function (a, b) { return a.data_ini < b.data_ini ? -1 : a.data_ini > b.data_ini ? 1 : 0; });
    var hist = S.bloqueios.filter(function (b) { return b.removido_em || b.data_fim < S.hoje; }).slice(0, 30);
    function item(b, ativo) {
      return '<div class="item bloq-item" data-id="' + b.id + '"><div class="top"><div class="nm">' + esc(bloqPeriodo(b)) + '</div><span class="pill ' + (ativo ? "bad" : "mute") + '">' + esc(bloqEscopo(b)) + "</span>" +
        (b.removido_em ? '<span class="pill mute">Removido</span>' : !ativo ? '<span class="pill mute">Encerrado</span>' : "") + "</div>" +
        '<div class="motivo"><b>Justificativa:</b> ' + esc(b.motivo) + "</div>" +
        '<div class="meta"><span>Criado por <b>' + esc(b.criado_por_nome || "—") + "</b> em " + fmtQuando(b.created_at) + "</span>" +
        (b.removido_em ? "<span>Removido por <b>" + esc(b.removido_por_nome || "—") + "</b> em " + fmtQuando(b.removido_em) + "</span>" : "") + "</div>" +
        (ativo ? '<div class="acts"><button class="btn btn-danger btn-sm" data-act="rm">Remover bloqueio</button></div>' : "") + "</div>";
    }
    $("pane").innerHTML =
      '<div class="toolbar"><div class="grow"><b>Bloqueio de reservas</b><div class="hint" style="margin:2px 0 0">Vale para as reservas online (/reservas). Não afeta a fila e não cancela reservas já feitas.</div></div><button class="btn btn-gold btn-sm" id="novoBloq">+ Novo bloqueio</button></div>' +
      '<div class="section-t" style="margin-top:0">Ativos e programados</div>' +
      (ativos.length ? '<div class="list cols">' + ativos.map(function (b) { return item(b, true); }).join("") + "</div>" : '<div class="empty">Nenhum bloqueio ativo. As reservas seguem o horário de funcionamento. ✅</div>') +
      (hist.length ? '<div class="section-t">Histórico</div><div class="list cols">' + hist.map(function (b) { return item(b, false); }).join("") + "</div>" : "");
    $("novoBloq").onclick = modalNovoBloqueio;
    $("pane").querySelectorAll('[data-act="rm"]').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.closest(".item").getAttribute("data-id"), b = S.bloqueios.filter(function (x) { return x.id === id; })[0]; if (!b) return;
        if (!confirm("Remover o bloqueio de " + bloqPeriodo(b) + " (" + bloqEscopo(b) + ")?\nOs horários voltam a ficar disponíveis para reservas online. O registro fica no histórico.")) return;
        act(async function () { must(await sb.from("bloqueios").update({ removido_em: nowIso(), removido_por_nome: S.staffNome }).eq("id", id)); }, "Bloqueio removido");
      };
    });
  }

  function modalNovoBloqueio() {
    openModal('<h3>Novo bloqueio de reservas</h3><div class="notice err" id="e" hidden></div>' +
      '<div class="field"><label>O que bloquear?</label><div class="chips" id="tipo">' +
      '<input type="radio" name="tp" id="tp1" value="dia" checked><label for="tp1">Dia inteiro</label>' +
      '<input type="radio" name="tp" id="tp2" value="almoco"><label for="tp2">Só almoço</label>' +
      '<input type="radio" name="tp" id="tp3" value="jantar"><label for="tp3">Só jantar</label>' +
      '<input type="radio" name="tp" id="tp4" value="hora"><label for="tp4">Horário específico</label></div></div>' +
      '<div class="row2"><div class="field"><label>De</label><input type="date" id="di" min="' + S.hoje + '" value="' + (S.resData >= S.hoje ? S.resData : S.hoje) + '"></div>' +
      '<div class="field"><label>Até <span style="font-weight:400;color:var(--text-muted)">(vazio = só um dia)</span></label><input type="date" id="df" min="' + S.hoje + '"></div></div>' +
      '<div class="row2" id="horas" hidden><div class="field"><label>Das</label><input type="time" id="hi" value="19:00"></div><div class="field"><label>Às</label><input type="time" id="hf" value="21:00"></div></div>' +
      '<div class="hint" id="horasHint" hidden style="margin:-8px 0 12px">Bloqueia reservas que <b>começam</b> nesse intervalo (o horário final não entra).</div>' +
      '<div class="field"><label for="mt">Justificativa <span style="color:var(--danger)">*</span></label><textarea id="mt" maxlength="300" placeholder="Ex.: evento fechado, manutenção, feriado, cozinha reduzida…"></textarea><div class="hint">Obrigatória. Fica registrada com o seu nome e a data.</div></div>' +
      '<div class="foot"><button class="btn btn-secondary" id="cx">Cancelar</button><button class="btn btn-primary" id="ok">Bloquear</button></div>',
      function (m) {
        m.querySelector("#cx").onclick = closeModal;
        m.querySelectorAll('input[name="tp"]').forEach(function (r) {
          r.onchange = function () { var h = m.querySelector('input[name="tp"]:checked').value === "hora"; m.querySelector("#horas").hidden = !h; m.querySelector("#horasHint").hidden = !h; };
        });
        m.querySelector("#ok").onclick = async function () {
          var err = m.querySelector("#e"), btn = this;
          try {
            var tp = m.querySelector('input[name="tp"]:checked').value, di = m.querySelector("#di").value, df = m.querySelector("#df").value || di, mt = m.querySelector("#mt").value.trim();
            if (mt.length < 5) throw new Error("Informe a justificativa do bloqueio (mínimo de 5 caracteres).");
            if (!di) throw new Error("Informe a data inicial.");
            if (di < S.hoje) throw new Error("A data inicial não pode ser no passado.");
            if (df < di) throw new Error("A data final deve ser igual ou posterior à inicial.");
            var b = { data_ini: di, data_fim: df, turno: tp === "almoco" || tp === "jantar" ? tp : null, hora_ini: null, hora_fim: null, motivo: mt, criado_por_nome: S.staffNome };
            if (tp === "hora") {
              b.hora_ini = m.querySelector("#hi").value; b.hora_fim = m.querySelector("#hf").value;
              if (!b.hora_ini || !b.hora_fim || b.hora_ini >= b.hora_fim) throw new Error("O horário inicial deve ser anterior ao final.");
            }
            btn.disabled = true;
            var ex = await fetchAll("reservas", "data,hora,status,nome", function (q) { return q.gte("data", di).lte("data", df).in("status", ["pendente", "confirmada", "chegou"]).order("created_at"); });
            var afet = ex.filter(function (r) { return bloqueiaHorario(b, r.data, hhmm(r.hora)); });
            if (afet.length && !confirm("Já existem " + afet.length + " reserva(s) ativa(s) nesse período/horário. Elas NÃO serão canceladas automaticamente: você precisará tratá-las na aba Reservas.\n\nCriar o bloqueio mesmo assim?")) { btn.disabled = false; return; }
            must(await sb.from("bloqueios").insert(b));
            closeModal(); D.toast("Bloqueio criado" + (afet.length ? " — atenção às " + afet.length + " reserva(s) já existente(s)" : "")); await loadBloqueios(); renderActive();
          } catch (e) { btn.disabled = false; D.setNotice(err, e.message); }
        };
      });
  }

  // ------------------------------------------------------------ AJUSTES
  var DOW = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  function showQr(titulo, url) {
    var img = "";
    try { var q = window.qrcode(0, "M"); q.addData(url); q.make(); img = '<img alt="QR Code" src="' + q.createDataURL(8, 2) + '">'; } catch (e) {}
    openModal('<div class="print-area qr-box"><h2>' + esc(titulo) + "</h2>" + (img || "<p>Não foi possível gerar o QR Code. Use o link abaixo.</p>") + '<p style="word-break:break-all;font-size:13px">' + esc(url) + '</p></div>' +
      '<div class="foot"><button class="btn btn-secondary" id="cx">Fechar</button><button class="btn btn-primary" id="pr">Imprimir</button></div>', function (md) {
      md.querySelector("#cx").onclick = closeModal; md.querySelector("#pr").onclick = function () { window.print(); };
    });
  }

  function renderAjustes() {
    var c = S.cfg, h = c.horarios || {};
    var urlFila = new URL("fila", location.href).href, urlRes = new URL("reservas", location.href).href;
    function turnosDoDia(i) {
      var out = { almoco: null, jantar: null };
      (h[String(i)] || []).forEach(function (f) { var t = f[2] || (f[0] < "16:00" ? "almoco" : "jantar"); if (!out[t]) out[t] = f; });
      return out;
    }
    var hoursHtml = DOW.map(function (n, i) {
      var t = turnosDoDia(i);
      function row(key, label, def) {
        var f = t[key];
        return '<div class="hours-row"><label class="switch"><input type="checkbox" data-t="' + key + '" data-k="open" data-d="' + i + '" ' + (f ? "checked" : "") + "> " + label + '</label>' +
          '<input type="time" data-t="' + key + '" data-k="a" data-d="' + i + '" value="' + (f ? f[0] : def[0]) + '"><input type="time" data-t="' + key + '" data-k="f" data-d="' + i + '" value="' + (f ? f[1] : def[1]) + '"></div>';
      }
      return '<div class="hours-day"><div class="hd-name">' + n + "</div>" + row("almoco", "Almoço", ["11:00", "15:00"]) + row("jantar", "Jantar", ["18:00", "23:00"]) + "</div>";
    }).join("");
    function num(id, label, val, min, max, hint) { return '<div class="field"><label for="' + id + '">' + label + '</label><input type="number" id="' + id + '" min="' + min + '" max="' + max + '" value="' + val + '">' + (hint ? '<div class="hint">' + hint + "</div>" : "") + "</div>"; }

    $("pane").innerHTML =
      '<div class="card"><h3 style="font-size:18px;margin-bottom:12px">Links e QR Codes</h3><p class="hint" style="margin-top:0">Cada link só mostra o seu próprio ambiente. Só este painel enxerga os dois.</p>' +
      '<div class="lbl">Fila de espera (imprima o QR Code e coloque na entrada)</div><div class="url-row"><input type="text" readonly value="' + esc(urlFila) + '"><button class="btn btn-secondary btn-sm" id="cpF">Copiar</button><button class="btn btn-gold btn-sm" id="qrF">QR Code</button></div>' +
      '<div class="lbl" style="margin-top:12px">Reservas (divulgue em Instagram, Google e WhatsApp)</div><div class="url-row"><input type="text" readonly value="' + esc(urlRes) + '"><button class="btn btn-secondary btn-sm" id="cpR">Copiar</button><button class="btn btn-gold btn-sm" id="qrR">QR Code</button></div></div>' +
      '<div class="card"><h3 style="font-size:18px;margin-bottom:12px">Horário de funcionamento</h3><p class="hint" style="margin-top:0">Define os horários que o cliente vê ao reservar. Cada dia tem dois turnos, <b>Almoço</b> e <b>Jantar</b>: desmarque o turno em que o restaurante não aceita reservas. Para bloquear um dia ou horário específico, use a aba <b>Bloqueios</b>.</p>' + hoursHtml + "</div>" +
      '<div class="card"><h3 style="font-size:18px;margin-bottom:12px">Regras</h3><div class="notice err" id="sErr" hidden></div><div class="settings-grid">' +
      num("sDur", "Duração da reserva (min)", c.duracao_reserva_min, 30, 360, "Tempo que a mesa fica reservada.") +
      num("sInt", "Intervalo entre horários (min)", c.intervalo_slot_min, 15, 120) +
      num("sUlt", "Última reserva antes de fechar (min)", c.ultima_reserva_antes_fechar_min, 0, 360) +
      num("sMax", "Máx. de pessoas por reserva online", c.max_pessoas_reserva, 1, 100) +
      num("sAnt", "Antecedência mínima (min)", c.antecedencia_min_min, 0, 1440) +
      num("sDias", "Reservar com até (dias)", c.antecedencia_max_dias, 1, 365) +
      num("sTol", "Tolerância de atraso (min)", c.tolerancia_atraso_min, 0, 120, "Depois disso a reserva aparece como atrasada.") +
      num("sTmp", "Tempo médio por grupo na fila (min)", c.tempo_medio_por_grupo_min, 1, 120, "Usado para estimar a espera do cliente.") + "</div>" +
      '<div class="field"><label for="sWa">WhatsApp do restaurante</label><input type="tel" id="sWa" value="' + esc(c.whatsapp) + '" placeholder="(41) 90000-0000"></div>' +
      '<div class="field"><label class="switch"><input type="checkbox" id="sAuto" ' + (c.confirmar_automatico ? "checked" : "") + "> Confirmar reservas automaticamente quando houver mesa</label></div>" +
      '<button class="btn btn-primary" id="salvar">Salvar ajustes</button></div>';

    D.maskPhone($("sWa"));
    $("cpF").onclick = function () { copy(urlFila); }; $("cpR").onclick = function () { copy(urlRes); };
    $("qrF").onclick = function () { showQr("Entre na fila — Drive In Burger", urlFila); };
    $("qrR").onclick = function () { showQr("Reserve sua mesa — Drive In Burger", urlRes); };
    $("salvar").onclick = salvarAjustes;
  }
  function copy(t) { if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { D.toast("Link copiado"); }, function () { D.toast("Copie manualmente o link.", true); }); }

  async function salvarAjustes() {
    var err = $("sErr"); D.setNotice(err, "");
    try {
      var hor = {};
      for (var i = 0; i < 7; i++) {
        var lista = [];
        ["almoco", "jantar"].forEach(function (t) {
          var q = function (k) { return document.querySelector('[data-t="' + t + '"][data-k="' + k + '"][data-d="' + i + '"]'); };
          if (!q("open").checked) return;
          var a = q("a").value, f = q("f").value;
          if (!a || !f || a >= f) throw new Error("Horário inválido no " + (t === "almoco" ? "almoço" : "jantar") + " de " + DOW[i] + ": a abertura deve ser antes do fechamento.");
          lista.push([a, f, t]);
        });
        if (lista.length === 2 && lista[0][1] > lista[1][0]) throw new Error("Em " + DOW[i] + ", o almoço deve terminar antes do início do jantar.");
        hor[String(i)] = lista;
      }
      function n(id) { return parseInt($(id).value, 10); }
      var patch = { horarios: hor, duracao_reserva_min: n("sDur"), intervalo_slot_min: n("sInt"), ultima_reserva_antes_fechar_min: n("sUlt"), max_pessoas_reserva: n("sMax"),
        antecedencia_min_min: n("sAnt"), antecedencia_max_dias: n("sDias"), tolerancia_atraso_min: n("sTol"), tempo_medio_por_grupo_min: n("sTmp"),
        whatsapp: $("sWa").value.trim(), confirmar_automatico: $("sAuto").checked };
      Object.keys(patch).forEach(function (k) { if (typeof patch[k] === "number" && isNaN(patch[k])) throw new Error("Preencha todos os campos numéricos."); });
      must(await sb.from("settings").update(patch).eq("id", 1));
      await loadCfg(); D.toast("Ajustes salvos");
    } catch (e) { D.setNotice(err, e.message); window.scrollTo(0, document.body.scrollHeight); }
  }

  boot();
})();
