/* ============================================================
   MySystemFit — Panel del coach, conectado a Supabase (datos reales)
   ============================================================ */
(function () {
  "use strict";

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const api = window.msfApi;

  let PROFILE = null;      // profile del coach logueado
  let STUDENTS = [];       // cache local, se refresca tras cada escritura
  let PAYMENTS = [];
  let FOLLOW_UPS = [];
  let CURRENT_STUDENT_ID = null; // alumno activo en drawer / builder de rutinas
  let studentFilter = { text: "", type: "all", state: "all" };

  const badgeClass = { ok: "badge--ok", pend: "badge--pend", late: "badge--late" };
  const stateLabel = { ok: "Activa", pend: "Pendiente", late: "Atrasada" };

  /* ---------- Toast ---------- */
  const icons = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    err: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  };
  function toast(txt, sub = "", type = "ok") {
    const stack = $("#toastStack");
    const el = document.createElement("div");
    el.className = "toast toast--" + type;
    el.innerHTML = `<span class="toast__ico">${icons[type]}</span><div><div class="toast__txt">${txt}</div>${sub ? `<div class="toast__sub">${sub}</div>` : ""}</div>`;
    stack.appendChild(el);
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 220); }, 2800);
  }
  window.msfToast = toast;
  function errToast(e, fallback) { toast(fallback, e?.message || "", "err"); }

  /* ---------- Navegación entre vistas ---------- */
  const titles = {
    dashboard: ["Dashboard", ""],
    alumnos: ["Alumnos", "Gestiona a tu comunidad"],
    pagos: ["Pagos", "Control de cobros y membresías"],
    rutinas: ["Rutinas", "Constructor de entrenamientos"],
    comunidad: ["Comunidad", "Novedades para tus alumnos"],
    mensajes: ["Mensajes", "Conversaciones activas"],
    ajustes: ["Ajustes", "Tu cuenta y preferencias"],
  };
  function goTo(view) {
    $$(".view").forEach((v) => v.classList.remove("is-active"));
    const target = $("#view-" + view);
    if (target) target.classList.add("is-active");
    $$(".nav__item").forEach((n) => n.classList.toggle("is-active", n.dataset.nav === view));
    if (titles[view]) { $("#pageTitle").firstChild.textContent = titles[view][0]; $("#pageSub").textContent = titles[view][1]; }
    $("#sidebar").classList.remove("is-open");
    document.querySelector(".content").scrollTo?.(0, 0);
    window.scrollTo(0, 0);
    if (view === "dashboard") runCountUp();
    if (view === "comunidad") renderCommunity();
    if (view === "mensajes") renderConversations();
  }
  document.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]");
    if (nav) { goTo(nav.dataset.nav); }
  });

  $("#menuToggle")?.addEventListener("click", () => $("#sidebar").classList.toggle("is-open"));

  function toggleTheme() {
    const html = document.documentElement;
    const light = html.getAttribute("data-theme") === "light";
    html.setAttribute("data-theme", light ? "dark" : "light");
    toast(light ? "Modo oscuro activado" : "Modo claro activado", "", "info");
  }
  $("#themeToggle")?.addEventListener("click", toggleTheme);
  $("#themeToggle2")?.addEventListener("click", toggleTheme);

  /* ---------- Render alumnos ---------- */
  function filteredStudents() {
    return STUDENTS.filter((s) => {
      if (studentFilter.text && !s.full_name.toLowerCase().includes(studentFilter.text.toLowerCase())) return false;
      if (studentFilter.type !== "all" && s.training_type !== studentFilter.type) return false;
      if (studentFilter.state !== "all" && s.state !== studentFilter.state) return false;
      return true;
    });
  }
  function dueLabel(s) {
    const p = PAYMENTS.find((p) => p.student_id === s.id && p.state !== "ok");
    if (!p) return { text: "Al día", tone: "t3" };
    const days = Math.ceil((new Date(p.due_date) - new Date()) / 86400000);
    if (days < 0) return { text: `Atrasado ${-days}d`, tone: "coral" };
    if (days === 0) return { text: "Vence hoy", tone: "coral" };
    if (days <= 3) return { text: `En ${days} días`, tone: "amber" };
    return { text: new Date(p.due_date).toLocaleDateString("es-MX", { day: "2-digit", month: "short" }), tone: "t3" };
  }
  function renderStudents() {
    const list = filteredStudents();
    const tbody = $("#studentsTbody");
    const cards = $("#studentsCards");
    if (tbody) tbody.innerHTML = list.map((s) => {
      const due = dueLabel(s);
      return `
      <tr data-student="${s.id}" style="cursor:pointer">
        <td><div class="cell-user"><div class="avatar avatar--sm">${s.initials}</div><div><div class="cell-user__name">${s.full_name}</div><div class="cell-user__sub">${s.age ? s.age + " años" : "—"}</div></div></div></td>
        <td><span class="badge ${badgeClass[s.state]}">${stateLabel[s.state]}</span></td>
        <td>${s.training_type}</td>
        <td class="muted">${s.goal || "—"}</td>
        <td><span style="color:var(--${due.tone === "t3" ? "text-3" : due.tone});font-family:var(--font-mono);font-size:13px">${due.text}</span></td>
        <td><div class="cell-actions">
          <button class="icon-btn js-msg-student" data-student="${s.id}" style="width:32px;height:32px" title="Mensaje"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v12H5.2L4 17.2V4z"/></svg></button>
          <button class="icon-btn js-open-student" style="width:32px;height:32px" title="Ver ficha"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></button>
        </div></td>
      </tr>`;
    }).join("") : "";
    if (!list.length && tbody) tbody.innerHTML = `<tr><td colspan="6" class="t3 text-sm" style="padding:20px;text-align:center">Sin alumnos que coincidan con el filtro.</td></tr>`;

    if (cards) cards.innerHTML = list.map((s) => {
      const due = dueLabel(s);
      return `
      <div class="card card--hover student-card" data-student="${s.id}" style="cursor:pointer">
        <div class="student-card__head"><div class="avatar avatar--md">${s.initials}</div><div><div class="student-card__name">${s.full_name}</div><div class="student-card__sub">${s.age ? s.age + " años · " : ""}${s.training_type}</div></div></div>
        <div style="margin-bottom:12px"><span class="badge ${badgeClass[s.state]}">${stateLabel[s.state]}</span></div>
        <div class="student-card__rows">
          <div class="kv"><span>Objetivo</span><span>${s.goal || "—"}</span></div>
          <div class="kv"><span>Próximo pago</span><span style="color:var(--${due.tone === "t3" ? "text-2" : due.tone})">${due.text}</span></div>
        </div>
        <div class="student-card__foot"><button class="btn btn--ghost btn--sm js-msg-student" data-student="${s.id}" style="flex:1">Mensaje</button><button class="btn btn--primary btn--sm js-open-student" style="flex:1">Ver ficha</button></div>
      </div>`;
    }).join("");

    const head = $(".page-head p");
    if (head && $("#view-alumnos").classList.contains("is-active")) {
      const active = STUDENTS.filter((s) => s.state === "ok").length;
      const pend = PAYMENTS.filter((p) => p.state !== "ok").length;
      const headP = $("#view-alumnos .page-head p");
      if (headP) headP.textContent = `${active} activos · ${pend} pendientes de pago`;
    }
  }

  function renderPayments() {
    const tbody = $("#paymentsTbody");
    if (!tbody) return;
    tbody.innerHTML = PAYMENTS.map((p) => `
      <tr data-payment="${p.id}">
        <td><div class="cell-user"><div class="avatar avatar--sm">${p.initials}</div><div class="cell-user__name">${p.student_name}</div></div></td>
        <td class="muted">${p.concept}</td>
        <td class="mono" style="font-weight:600">$${Number(p.amount).toLocaleString("es-MX")}</td>
        <td>${new Date(p.due_date).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}</td>
        <td><span class="badge ${badgeClass[p.state]}">${p.state === "ok" ? "Pagado" : stateLabel[p.state]}</span></td>
        <td class="cell-actions">${p.state === "ok" ? '<span class="t3 text-sm">—</span>' : '<button class="btn btn--lime btn--sm js-mark-paid" data-payment="' + p.id + '">Cobrar</button>'}</td>
      </tr>`).join("") || `<tr><td colspan="6" class="t3 text-sm" style="padding:20px;text-align:center">Sin pagos registrados.</td></tr>`;
  }

  function renderDueList() {
    const wrap = $("#dueList");
    if (!wrap) return;
    const due = PAYMENTS.filter((p) => p.state !== "ok").slice(0, 4);
    wrap.innerHTML = due.map((p) => {
      const days = Math.ceil((new Date(p.due_date) - new Date()) / 86400000);
      const tone = days <= 0 ? "due-row__days--late" : days <= 3 ? "due-row__days--soon" : "t3";
      const label = days < 0 ? `Atrasado ${-days}d` : days === 0 ? "Vence hoy" : `En ${days} días`;
      return `<div class="due-row">
        <div class="avatar avatar--sm">${p.initials}</div>
        <div class="due-row__meta"><div class="due-row__name">${p.student_name}</div><div class="due-row__sub">${p.concept} · $${p.amount}</div></div>
        <span class="due-row__days ${tone}">${label}</span>
        <button class="btn btn--lime btn--sm js-mark-paid" data-payment="${p.id}">Marcar pagado</button>
      </div>`;
    }).join("") || `<p class="t3 text-sm">No hay pagos próximos a vencer 🎉</p>`;
  }

  function renderFollowUps() {
    const wrap = $("#followUpsList");
    if (!wrap) return;
    wrap.innerHTML = FOLLOW_UPS.map((f) => `
      <div class="alert-item ${f.is_done ? "is-done" : ""}" data-followup="${f.id}">
        <span class="check js-check ${f.is_done ? "is-done" : ""}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>
        <div><div class="alert-item__txt">${f.title}</div><div class="alert-item__sub">${f.subtitle || (f.students ? f.students.full_name : "")}</div></div>
        <span class="alert-item__time">${new Date(f.due_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</span>
      </div>`).join("") || `<p class="t3 text-sm">Sin seguimientos pendientes hoy.</p>`;
  }

  /* ---------- Toggle tabla / tarjetas ---------- */
  $("#viewToggle")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-vt]");
    if (!b) return;
    $$("#viewToggle button").forEach((x) => x.classList.remove("is-active"));
    b.classList.add("is-active");
    const cards = b.dataset.vt === "cards";
    $("#studentsTable").classList.toggle("hidden", cards);
    $("#studentsCards").classList.toggle("hidden", !cards);
  });

  /* ---------- Búsqueda y filtros de alumnos ---------- */
  $(".search input")?.addEventListener("input", (e) => {
    studentFilter.text = e.target.value;
    renderStudents();
  });
  $$(".row.gap-2.wrap.mb-4 .pill").forEach((pill, idx, arr) => {
    pill.addEventListener("click", () => {
      arr.forEach((p) => p.classList.remove("is-active"));
      pill.classList.add("is-active");
      const txt = pill.textContent.trim();
      const map = { "Todos": ["all", "all"], "Online": ["Online", "all"], "Presencial": ["Presencial", "all"], "Activos": ["all", "ok"], "Pendientes": ["all", "pend"], "Atrasados": ["all", "late"] };
      const key = Object.keys(map).find((k) => txt.includes(k)) || "Todos";
      studentFilter.type = map[key][0];
      studentFilter.state = map[key][1];
      renderStudents();
    });
  });

  /* ---------- Drawer ficha alumno ---------- */
  const drawer = $("#studentDrawer");
  const overlay = $("#drawerOverlay");
  async function openDrawer(id) {
    const s = STUDENTS.find((x) => x.id === id);
    if (!s) return;
    CURRENT_STUDENT_ID = id;
    $("#dwAvatar").textContent = s.initials;
    $("#dwName").textContent = s.full_name;
    const st = $("#dwState");
    st.className = "badge " + badgeClass[s.state];
    st.textContent = stateLabel[s.state];
    $("#dwGoal") && ($("#dwGoal").textContent = s.goal || "—");
    $("#dwType") && ($("#dwType").textContent = s.training_type);
    $("#dwWeight") && ($("#dwWeight").textContent = s.weight_current ?? "—");
    $("#dwHeight") && ($("#dwHeight").textContent = s.height ?? "—");
    $("#dwEmail") && ($("#dwEmail").textContent = s.email || "—");
    $("#dwPhone") && ($("#dwPhone").textContent = s.phone || "—");
    $("#dwSince") && ($("#dwSince").textContent = s.member_since ? new Date(s.member_since).toLocaleDateString("es-MX", { month: "long", year: "numeric" }) : "—");
    $("#dwNotes") && ($("#dwNotes").value = s.private_notes || "");

    const dwPayments = $("#dwPayments");
    if (dwPayments) {
      const rows = PAYMENTS.filter((p) => p.student_id === id);
      dwPayments.innerHTML = rows.map((p) => `<div class="due-row"><div class="due-row__meta"><div class="due-row__name">${p.concept}</div><div class="due-row__sub">${p.state === "ok" ? "Pagado" : new Date(p.due_date).toLocaleDateString("es-MX")}</div></div><span class="mono">$${p.amount}</span><span class="badge ${badgeClass[p.state]}">${p.state === "ok" ? "Pagado" : stateLabel[p.state]}</span></div>`).join("") || `<p class="t3 text-sm">Sin pagos registrados.</p>`;
    }

    drawer.classList.add("is-open");
    overlay.classList.add("is-open");
    document.body.style.overflow = "hidden";
  }
  function closeDrawer() {
    drawer.classList.remove("is-open");
    overlay.classList.remove("is-open");
    document.body.style.overflow = "";
  }
  $("#drawerClose")?.addEventListener("click", closeDrawer);
  overlay?.addEventListener("click", closeDrawer);
  document.addEventListener("click", (e) => {
    const row = e.target.closest("[data-student]");
    if (row && !row.classList.contains("js-msg-student")) { openDrawer(row.dataset.student); }
  });
  $("#dwNotes")?.addEventListener("blur", async (e) => {
    if (!CURRENT_STUDENT_ID) return;
    try {
      await api.updateStudent(CURRENT_STUDENT_ID, { private_notes: e.target.value });
      toast("Nota guardada", "", "ok");
    } catch (ex) { errToast(ex, "No se pudo guardar la nota"); }
  });

  $("#dwTabs")?.addEventListener("click", (e) => {
    const t = e.target.closest(".tab");
    if (!t) return;
    $$("#dwTabs .tab").forEach((x) => x.classList.remove("is-active"));
    t.classList.add("is-active");
    $$(".drawer__body .tab-panel").forEach((p) => p.classList.toggle("is-active", p.dataset.panel === t.dataset.tab));
  });

  /* ---------- Modales ---------- */
  document.addEventListener("click", (e) => {
    const open = e.target.closest("[data-modal]");
    if (open) { $("#modal-" + open.dataset.modal)?.classList.add("is-open"); }
    if (e.target.classList.contains("modal-overlay") || e.target.closest(".js-modal-close")) {
      $$(".modal-overlay").forEach((m) => m.classList.remove("is-open"));
    }
  });

  /* ---------- Nuevo alumno (persistido) ---------- */
  $("#formNewStudent")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#nsName").value.trim();
    if (!name) return;
    try {
      const created = await api.createStudent(PROFILE.id, {
        full_name: name,
        training_type: $("#nsType").value,
        goal: $("#nsGoal").value,
        state: "pend",
      });
      STUDENTS.push({ ...created, initials: api.initials(created.full_name) });
      renderStudents();
      $$(".modal-overlay").forEach((m) => m.classList.remove("is-open"));
      e.target.reset();
      toast("Alumno creado", name, "ok");
    } catch (ex) { errToast(ex, "No se pudo crear el alumno"); }
  });

  /* ---------- Checkboxes de seguimientos (persistidos) ---------- */
  document.addEventListener("click", async (e) => {
    const chk = e.target.closest(".js-check");
    if (!chk) return;
    const item = chk.closest("[data-followup]");
    if (!item) return;
    const id = item.dataset.followup;
    const nowDone = !chk.classList.contains("is-done");
    chk.classList.toggle("is-done", nowDone);
    item.classList.toggle("is-done", nowDone);
    try {
      await api.toggleFollowUp(id, nowDone);
      const f = FOLLOW_UPS.find((x) => x.id === id);
      if (f) f.is_done = nowDone;
    } catch (ex) { errToast(ex, "No se pudo actualizar el seguimiento"); }
  });

  /* ---------- Marcar pago / guardar ---------- */
  document.addEventListener("click", async (e) => {
    const payBtn = e.target.closest(".js-mark-paid");
    if (payBtn) {
      e.stopPropagation();
      const id = payBtn.dataset.payment;
      payBtn.disabled = true;
      try {
        await api.markPaymentPaid(id);
        await refreshPayments();
        renderStudents();
        toast("Pago registrado", "Se marcó como cobrado correctamente", "ok");
      } catch (ex) {
        payBtn.disabled = false;
        errToast(ex, "No se pudo registrar el pago");
      }
      return;
    }
    if (e.target.closest(".js-save")) {
      toast("Cambios guardados", "Todo quedó actualizado", "ok");
    }
    const msgBtn = e.target.closest(".js-msg-student");
    if (msgBtn) {
      e.stopPropagation();
      goTo("mensajes");
      selectConversation(msgBtn.dataset.student);
    }
  });

  /* ---------- Ajustes: guardar perfil ---------- */
  $("#formProfile")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await window.msfSupabase.from("profiles").update({
        full_name: $("#profName").value.trim(),
        specialty: $("#profSpecialty").value.trim(),
      }).eq("id", PROFILE.id);
      toast("Cambios guardados", "Todo quedó actualizado", "ok");
    } catch (ex) { errToast(ex, "No se pudo guardar el perfil"); }
  });

  $("#btnLogout")?.addEventListener("click", () => window.msfAuth.signOut());
  $("#btnConfirmDelete")?.addEventListener("click", async () => {
    try {
      await window.msfSupabase.auth.signOut();
      toast("Sesión cerrada", "Contacta a soporte para eliminar tu cuenta definitivamente", "info");
      window.location.href = "login.html";
    } catch (ex) { errToast(ex, "No se pudo cerrar la cuenta"); }
  });

  /* ---------- Tilt 3D en cards ---------- */
  function attachTilt(el, maxDeg = 6) {
    el.addEventListener("mousemove", (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `perspective(700px) rotateY(${(px * maxDeg).toFixed(2)}deg) rotateX(${(-py * maxDeg).toFixed(2)}deg) translateY(-2px)`;
    });
    el.addEventListener("mouseleave", () => { el.style.transform = ""; });
  }
  const supportsHoverTilt = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (supportsHoverTilt) $$(".tilt").forEach((el) => attachTilt(el));

  /* ---------- Tooltip interactivo en gráficos SVG ---------- */
  function attachChartTooltip(wrap, { values, prefix = "", suffix = "" }) {
    const dot = wrap.querySelector(".chart-hover-dot");
    const tip = wrap.querySelector(".chart-tooltip");
    if (!dot || !tip || !values.length) return;
    const min = Math.min(...values), max = Math.max(...values);
    wrap.addEventListener("mousemove", (e) => {
      const rect = wrap.getBoundingClientRect();
      const pct = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
      const idx = Math.round(pct * (values.length - 1));
      const val = values[idx];
      const xPct = (idx / (values.length - 1)) * 100;
      const norm = max === min ? 0.5 : (val - min) / (max - min);
      const yPct = 78 - norm * 56;
      dot.style.left = xPct + "%";
      dot.style.top = yPct + "%";
      tip.style.left = xPct + "%";
      tip.style.top = yPct + "%";
      tip.textContent = prefix + val.toLocaleString("es-MX", { maximumFractionDigits: 1 }) + suffix;
      dot.classList.add("show");
      tip.classList.add("show");
    });
    wrap.addEventListener("mouseleave", () => {
      dot.classList.remove("show");
      tip.classList.remove("show");
    });
  }
  function initChartTooltips() {
    $$("[data-chart-values]").forEach((wrap) => {
      const values = wrap.dataset.chartValues.split(",").map(Number);
      const isMoney = wrap.dataset.chartMax !== undefined;
      attachChartTooltip(wrap, { values, prefix: isMoney ? "$" : "", suffix: wrap.dataset.chartUnit ? " " + wrap.dataset.chartUnit : "" });
    });
  }

  /* ---------- Constructor de rutinas (persistido) ---------- */
  async function loadRoutineBuilder(studentId) {
    const board = $("#builderBoard");
    if (!board || !studentId) return;
    try {
      let routine = await api.getStudentRoutine(studentId);
      if (!routine) {
        routine = await api.createRoutine(PROFILE.id, studentId, { name: "Rutina", phase: "Fase inicial", week: 1 });
        routine.days = [];
      }
      board.dataset.routineId = routine.id;
      const s = STUDENTS.find((x) => x.id === studentId);
      $("#builderTitle") && ($("#builderTitle").textContent = `Rutina de ${s ? s.full_name : ""} · ${routine.phase || ""} · Semana ${routine.week || 1}`);
      const days = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];
      const dayLabels = { lunes: "Lunes", martes: "Martes", miercoles: "Miércoles", jueves: "Jueves", viernes: "Viernes", sabado: "Sábado", domingo: "Domingo" };
      board.innerHTML = days.slice(0, 4).map((d) => {
        const existing = routine.days.find((x) => x.day_name === d);
        const exercises = existing?.exercises || [];
        return `<div class="day-col" data-day="${d}">
          <div class="day-col__head"><span class="day-col__title">${dayLabels[d]}</span><span class="day-col__count">${existing?.label || "Día"} · ${exercises.length}</span></div>
          ${exercises.map((ex) => `<div class="ex-card" draggable="true"><div class="ex-card__name">${ex.name}</div><div class="ex-card__grid"><div class="ex-input"><label>Series</label><input value="${ex.sets ?? ""}" data-field="sets"></div><div class="ex-input"><label>Reps</label><input value="${ex.reps ?? ""}" data-field="reps"></div><div class="ex-input"><label>Kg</label><input value="${ex.kg ?? ""}" data-field="kg"></div><div class="ex-input"><label>Desc</label><input value="${ex.rest_seconds ?? ""}" data-field="rest_seconds"></div></div></div>`).join("")}
          <div class="day-add">+ Añadir ejercicio</div>
        </div>`;
      }).join("");
      initBuilderDnD();
      $$(".ex-input input").forEach((inp) => {
        inp.addEventListener("blur", () => { inp.classList.add("is-saved"); setTimeout(() => inp.classList.remove("is-saved"), 900); });
      });
    } catch (ex) { errToast(ex, "No se pudo cargar la rutina"); }
  }

  $("#btnSaveRoutine")?.addEventListener("click", async () => {
    const board = $("#builderBoard");
    const routineId = board?.dataset.routineId;
    if (!routineId) return;
    try {
      const cols = $$(".day-col", board);
      for (let i = 0; i < cols.length; i++) {
        const col = cols[i];
        const day = col.dataset.day;
        const label = $(".day-col__count", col)?.textContent.split("·")[0].trim() || "Día";
        const exercises = $$(".ex-card", col).map((card) => ({
          name: card.querySelector(".ex-card__name").textContent.trim(),
          sets: Number($('[data-field="sets"]', card)?.value) || null,
          reps: Number($('[data-field="reps"]', card)?.value) || null,
          kg: Number($('[data-field="kg"]', card)?.value) || null,
          rest_seconds: Number($('[data-field="rest_seconds"]', card)?.value) || null,
        }));
        await api.saveRoutineDay(routineId, day, label, exercises, i);
      }
      toast("Rutina guardada", "Se envió al alumno", "ok");
    } catch (ex) { errToast(ex, "No se pudo guardar la rutina"); }
  });

  function initBuilderDnD() {
    const board = $("#builderBoard");
    if (!board) return;
    let dragEl = null;
    let placeholder = null;
    function removePlaceholder() { placeholder?.remove(); placeholder = null; }
    function getAfterElement(col, y) {
      const cards = $$(".ex-card:not(.is-dragging)", col);
      return cards.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        return offset < 0 && offset > closest.offset ? { offset, element: child } : closest;
      }, { offset: -Infinity, element: null }).element;
    }
    function updateDayCounts() {
      $$(".day-col", board).forEach((col) => {
        const countEl = $(".day-col__count", col);
        if (!countEl || !countEl.textContent.includes("·")) return;
        const label = countEl.textContent.split("·")[0].trim();
        const n = $$(".ex-card", col).length;
        countEl.textContent = `${label} · ${n}`;
      });
    }
    $$(".ex-card", board).forEach((card) => {
      card.addEventListener("dragstart", (e) => {
        dragEl = card;
        card.classList.add("is-dragging");
        requestAnimationFrame(() => card.classList.add("is-lifted"));
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", "");
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("is-dragging", "is-lifted");
        $$(".day-col", board).forEach((d) => d.classList.remove("is-dragover"));
        removePlaceholder();
        dragEl = null;
      });
    });
    $$(".day-col", board).forEach((col) => {
      col.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (!dragEl) return;
        col.classList.add("is-dragover");
        if (!placeholder) { placeholder = document.createElement("div"); placeholder.className = "drop-placeholder"; }
        const addBtn = $(".day-add", col);
        const after = getAfterElement(col, e.clientY);
        if (after) col.insertBefore(placeholder, after);
        else if (addBtn) col.insertBefore(placeholder, addBtn);
        else col.appendChild(placeholder);
      });
      col.addEventListener("dragleave", (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove("is-dragover"); });
      col.addEventListener("drop", (e) => {
        e.preventDefault();
        col.classList.remove("is-dragover");
        if (dragEl && placeholder) { placeholder.replaceWith(dragEl); updateDayCounts(); }
        removePlaceholder();
      });
    });
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-nav='rutinas']") && CURRENT_STUDENT_ID) loadRoutineBuilder(CURRENT_STUDENT_ID);
  });

  /* ---------- Comunidad (persistido) ---------- */
  async function renderCommunity() {
    const feed = $("#communityFeed");
    if (!feed) return;
    try {
      const posts = await api.listCommunityPosts(PROFILE.id);
      feed.innerHTML = posts.map((p) => {
        const liked = p.community_likes.some((l) => l.profile_id === PROFILE.id);
        return `<div class="card mb-4" data-post="${p.id}">
          <div class="row gap-3 mb-4"><div class="avatar avatar--md">${api.initials(p.profiles?.full_name)}</div><div><div class="fw-600">${p.profiles?.full_name || "Coach"}</div><div class="t3 text-sm">${new Date(p.created_at).toLocaleString("es-MX")}</div></div></div>
          <p style="margin-bottom:12px">${p.body}</p>
          <div class="row gap-4 mt-4">
            <button class="pill js-like ${liked ? "is-active" : ""}" data-post="${p.id}" data-liked="${liked}">❤ ${p.community_likes.length}</button>
            <button class="pill">💬 ${p.community_comments.length} comentarios</button>
          </div>
        </div>`;
      }).join("") || `<p class="t3 text-sm">Aún no hay publicaciones.</p>`;
    } catch (ex) { errToast(ex, "No se pudo cargar la comunidad"); }
  }
  $("#formNewPost")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = $("#newPostBody").value.trim();
    if (!body) return;
    try {
      await api.createCommunityPost(PROFILE.id, PROFILE.id, body);
      $("#newPostBody").value = "";
      renderCommunity();
      toast("Publicado", "", "ok");
    } catch (ex) { errToast(ex, "No se pudo publicar"); }
  });
  document.addEventListener("click", async (e) => {
    const likeBtn = e.target.closest(".js-like");
    if (!likeBtn) return;
    const liked = likeBtn.dataset.liked === "true";
    try {
      await api.toggleLike(likeBtn.dataset.post, PROFILE.id, liked);
      renderCommunity();
    } catch (ex) { errToast(ex, "No se pudo procesar el like"); }
  });

  /* ---------- Mensajes (persistido) ---------- */
  let activeConversationId = null;
  async function renderConversations() {
    const list = $("#conversationsList");
    if (!list) return;
    try {
      const convos = await api.listConversations(PROFILE.id);
      list.innerHTML = convos.map((c) => `<div class="alert-item radius-0 js-conversation" data-student="${c.id}" style="cursor:pointer"><div class="avatar avatar--md">${api.initials(c.full_name)}</div><div><div class="alert-item__txt">${c.full_name}</div></div></div>`).join("") || `<p class="t3 text-sm" style="padding:16px">Sin conversaciones aún.</p>`;
      if (convos.length && !activeConversationId) selectConversation(convos[0].id);
    } catch (ex) { errToast(ex, "No se pudieron cargar los mensajes"); }
  }
  async function selectConversation(studentId) {
    activeConversationId = studentId;
    const s = STUDENTS.find((x) => x.id === studentId);
    $("#threadName") && ($("#threadName").textContent = s ? s.full_name : "");
    $("#threadAvatar") && ($("#threadAvatar").textContent = s ? s.initials : "");
    const body = $("#threadBody");
    if (!body) return;
    try {
      const msgs = await api.listMessages(PROFILE.id, studentId);
      body.innerHTML = msgs.map((m) => `<div style="align-self:${m.sender_id === PROFILE.id ? "flex-end" : "flex-start"};max-width:70%;background:${m.sender_id === PROFILE.id ? "var(--indigo)" : "var(--surface-3)"};color:${m.sender_id === PROFILE.id ? "#fff" : "inherit"};padding:10px 14px;border-radius:14px 14px ${m.sender_id === PROFILE.id ? "4px 14px" : "14px 4px"}">${m.body}</div>`).join("") || `<p class="t3 text-sm">Aún no hay mensajes en esta conversación.</p>`;
      body.scrollTop = body.scrollHeight;
    } catch (ex) { errToast(ex, "No se pudieron cargar los mensajes"); }
  }
  document.addEventListener("click", (e) => {
    const convo = e.target.closest(".js-conversation");
    if (convo) selectConversation(convo.dataset.student);
  });
  $("#formSendMessage")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("#messageInput");
    const body = input.value.trim();
    if (!body || !activeConversationId) return;
    try {
      await api.sendMessage(PROFILE.id, activeConversationId, PROFILE.id, body);
      input.value = "";
      selectConversation(activeConversationId);
    } catch (ex) { errToast(ex, "No se pudo enviar el mensaje"); }
  });

  /* ---------- Count-up de KPIs ---------- */
  function runCountUp() {
    $$("#view-dashboard .kpi__value[data-count]").forEach((el) => {
      const target = +el.dataset.count;
      const prefix = el.dataset.prefix || "";
      const dur = 900;
      const start = performance.now();
      function tick(now) {
        const p = Math.min((now - start) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        const val = Math.round(target * eased);
        el.textContent = prefix + val.toLocaleString("es-MX");
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }
  function updateKpis() {
    const active = STUDENTS.filter((s) => s.state === "ok").length;
    const pendPayments = PAYMENTS.filter((p) => p.state !== "ok").length;
    const revenue = PAYMENTS.filter((p) => p.state === "ok").reduce((sum, p) => sum + Number(p.amount), 0);
    const kEl = (n) => $(`#view-dashboard .kpi__value[data-count]`);
    const kpis = $$("#view-dashboard .kpi__value[data-count]");
    if (kpis[0]) kpis[0].dataset.count = revenue;
    if (kpis[1]) kpis[1].dataset.count = active;
    if (kpis[3]) kpis[3].dataset.count = pendPayments;
  }

  /* ---------- Refrescos ---------- */
  async function refreshPayments() { PAYMENTS = await api.listPayments(PROFILE.id); renderPayments(); renderDueList(); }

  /* ---------- Init ---------- */
  async function init() {
    const auth = await window.msfAuth.requireRole("coach");
    if (!auth) return;
    PROFILE = auth.profile;
    $("#pageSub") && ($("#pageSub").textContent = `Buenas, ${PROFILE.full_name.split(" ")[0]} 👋`);
    $$(".coach-card__name").forEach((el) => (el.textContent = PROFILE.full_name));
    $$(".avatar.avatar--ring, .coach-card .avatar").forEach((el) => (el.textContent = api.initials(PROFILE.full_name)));
    $("#profName") && ($("#profName").value = PROFILE.full_name);
    $("#profEmail") && ($("#profEmail").value = PROFILE.email);
    $("#profSpecialty") && ($("#profSpecialty").value = PROFILE.specialty || "");
    $("#coachIdDisplay") && ($("#coachIdDisplay").textContent = PROFILE.id);

    try {
      [STUDENTS, PAYMENTS, FOLLOW_UPS] = await Promise.all([
        api.listStudents(PROFILE.id),
        api.listPayments(PROFILE.id),
        api.listFollowUps(PROFILE.id),
      ]);
    } catch (ex) { errToast(ex, "No se pudieron cargar los datos"); }

    renderStudents();
    renderPayments();
    renderDueList();
    renderFollowUps();
    updateKpis();
    runCountUp();
    initChartTooltips();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
