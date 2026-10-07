(function () {
  "use strict";
  var D = window.DIB, $ = D.$;
  var cfg = null, qtd = 2, slot = null, current = null, lookupPhone = "", reqId = 0;

  function show(id) { ["vLoading", "vForm", "vTicket"].forEach(function (v) { $(v).hidden = v !== id; }); }
  function area() { return (document.querySelector('input[name="area"]:checked') || {}).value || "Sem preferência"; }

  function updateSubmit() {
    var b = $("submit");
    b.disabled = !slot;
    b.textContent = slot ? "Reservar para " + slot + " em " + D.fmtDate($("data").value) : "Escolha um horário";
  }

  async function loadSlots() {
    var id = ++reqId, data = $("data").value, box = $("slots");
    slot = null; updateSubmit();
    if (!data) { box.innerHTML = ""; $("slotsHint").textContent = "Escolha uma data."; return; }
    $("slotsHint").textContent = "Buscando horários…"; box.innerHTML = "";
    try {
      var rows = await D.rpc("reserva_disponibilidade", { p_data: data, p_pessoas: qtd, p_area: area() });
      if (id !== reqId) return;
      if (!rows || !rows.length) {
        $("slotsHint").textContent = "Sem horários para este dia (fechado, data fora do período ou grupo acima do limite).";
        return;
      }
      var any = rows.some(function (r) { return r.disponivel; });
      var todosBloq = rows.every(function (r) { return r.bloqueado; });
      $("slotsHint").textContent = todosBloq ? "Não estamos aceitando reservas nesta data. Escolha outro dia."
        : any ? "" : "Todos os horários deste dia estão ocupados. Tente outra data ou área.";
      var NOMES = { almoco: "Almoço", jantar: "Jantar" }, ordem = ["almoco", "jantar"], html = "";
      ordem.forEach(function (t) {
        var g = rows.filter(function (r) { return r.turno === t; });
        if (!g.length) return;
        html += '<div class="slot-group"><div class="lbl">' + NOMES[t] + '</div><div class="slots">' + g.map(function (r) {
          return '<button type="button" class="slot" data-h="' + r.hora + '" aria-pressed="false"' + (r.disponivel ? "" : " disabled") + ">" + r.hora + "</button>";
        }).join("") + "</div></div>";
      });
      box.innerHTML = html;
      box.querySelectorAll(".slot").forEach(function (b) {
        b.onclick = function () {
          box.querySelectorAll(".slot").forEach(function (o) { o.setAttribute("aria-pressed", "false"); });
          b.setAttribute("aria-pressed", "true"); slot = b.getAttribute("data-h"); updateSubmit();
        };
      });
    } catch (e) { if (id === reqId) $("slotsHint").textContent = "Não foi possível buscar os horários: " + e.message; }
  }

  function renderTicket(r) {
    current = r;
    $("tCod").textContent = r.codigo; $("tNome").textContent = r.nome;
    $("tData").textContent = D.fmtDate(r.data) + " (" + D.weekday(r.data) + ")";
    $("tHora").textContent = r.hora; $("tPessoas").textContent = r.pessoas;
    var map = { pendente: ["Aguardando confirmação", "warn"], confirmada: ["Confirmada", "ok"], chegou: ["Check-in feito", "ok"],
      sentada: ["Em atendimento", "ok"], concluida: ["Concluída", "ok"], cancelada: ["Cancelada", "bad"], nao_compareceu: ["Não compareceu", "bad"] };
    var m = map[r.status] || [r.status, "mute"];
    $("tStatus").innerHTML = '<span class="pill ' + m[1] + '">' + D.esc(m[0]) + "</span>";
    var active = r.status === "pendente" || r.status === "confirmada";
    $("tMsg").textContent = r.status === "pendente" ? "Recebemos seu pedido. A equipe confirmará em breve."
      : r.status === "confirmada" ? "Reserva confirmada! Guarde o código. Chegue com até " + (cfg.tolerancia_atraso_min || 15) + " min de tolerância."
      : "";
    $("btnCancel").hidden = !active; $("btnIcs").hidden = !active;
    if (cfg.whatsapp) {
      $("btnWa").hidden = false;
      $("btnWa").href = D.waLink(cfg.whatsapp, "Olá! Sobre minha reserva " + r.codigo + " em " + D.fmtDate(r.data) + " às " + r.hora + ".");
    }
    show("vTicket"); window.scrollTo(0, 0);
  }

  function downloadIcs() {
    var r = current; if (!r) return;
    var d = r.data.replace(/-/g, ""), h = r.hora.replace(":", "") + "00";
    var endMin = parseInt(r.hora.slice(0, 2), 10) * 60 + parseInt(r.hora.slice(3), 10) + (cfg.duracao_reserva_min || 90);
    var eh = String(Math.floor(endMin / 60) % 24).padStart(2, "0") + String(endMin % 60).padStart(2, "0") + "00";
    var ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Drive In Burger//Reservas//PT", "BEGIN:VEVENT",
      "UID:" + r.codigo + "@driveinburger", "DTSTAMP:" + new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z",
      "DTSTART:" + d + "T" + h, "DTEND:" + d + "T" + eh,
      "SUMMARY:Reserva no Drive In Burger (" + r.pessoas + " pessoas)", "DESCRIPTION:Código da reserva: " + r.codigo,
      "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    a.download = "reserva-drive-in-burger.ics"; document.body.appendChild(a); a.click(); a.remove();
  }

  async function init() {
    if (!D.configured) { D.showSetupMissing($("root")); return; }
    try {
      cfg = await D.rpc("config_publica");
      var di = $("data"); di.min = cfg.hoje; di.max = D.addDays(cfg.hoje, cfg.antecedencia_max_dias); di.value = cfg.hoje;
      $("maxHint").textContent = "Reservas online até " + cfg.max_pessoas_reserva + " pessoas. Para grupos maiores, fale com o restaurante.";
      show("vForm"); loadSlots();
    } catch (e) {
      $("root").innerHTML = '<div class="notice err">Não foi possível carregar a página de reservas. Recarregue em instantes.</div>';
    }
  }

  $("comoBox").innerHTML = D.comoHtml("como"); D.bindComo("como");
  D.maskPhone($("tel")); D.maskPhone($("lkTel"));
  $("minus").onclick = function () { qtd = Math.max(1, qtd - 1); $("qtd").textContent = qtd; loadSlots(); };
  $("plus").onclick = function () { qtd = Math.min(cfg ? cfg.max_pessoas_reserva : 12, qtd + 1); $("qtd").textContent = qtd; loadSlots(); };
  $("data").addEventListener("change", loadSlots);
  document.querySelectorAll('input[name="area"]').forEach(function (r) { r.addEventListener("change", loadSlots); });

  $("form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var err = $("formErr"); D.setNotice(err, "");
    var nome = $("nome").value.trim(), tel = $("tel").value.trim();
    if (!slot) { D.setNotice(err, "Escolha um horário."); return; }
    if (nome.length < 2) { D.setNotice(err, "Informe seu nome."); $("nome").focus(); return; }
    if (D.digits(tel).length < 10) { D.setNotice(err, "Informe um telefone válido, com DDD."); $("tel").focus(); return; }
    var b = $("submit"); b.disabled = true;
    try {
      var r = await D.rpc("reserva_criar", {
        p_nome: nome, p_telefone: tel, p_email: $("email").value.trim() || null, p_data: $("data").value, p_hora: slot,
        p_pessoas: qtd, p_area: area(), p_como_conheceu: D.comoValue("como"), p_obs: $("obs").value.trim() || null
      });
      lookupPhone = tel; renderTicket(r);
    } catch (ex) {
      D.setNotice(err, ex.message); window.scrollTo(0, 0); loadSlots();
    }
  });

  $("lkBtn").onclick = async function () {
    var err = $("lkErr"); D.setNotice(err, "");
    try {
      var r = await D.rpc("reserva_consultar", { p_codigo: $("lkCod").value, p_telefone: $("lkTel").value });
      if (!r) { D.setNotice(err, "Reserva não encontrada. Confira o código e o telefone."); return; }
      lookupPhone = $("lkTel").value; renderTicket(r);
    } catch (ex) { D.setNotice(err, ex.message); }
  };

  $("btnCancel").onclick = async function () {
    if (!current || !confirm("Cancelar esta reserva?")) return;
    try {
      var ok = await D.rpc("reserva_cancelar", { p_codigo: current.codigo, p_telefone: lookupPhone });
      if (!ok) { D.toast("Não foi possível cancelar. Fale com o restaurante.", true); return; }
      current.status = "cancelada"; renderTicket(current);
    } catch (ex) { D.toast(ex.message, true); }
  };
  $("btnIcs").onclick = downloadIcs;
  $("btnBack").onclick = function () { current = null; show("vForm"); loadSlots(); };
  init();
})();
