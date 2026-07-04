/* ============================================================
   MySystemFit — Panel del coach, conectado a Supabase (datos reales)
   ============================================================ */
(function () {
  "use strict";

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const api = window.msfApi;

  let PROFILE = null;      // profile del coach logueado
  let FEATURES = null;     // features del plan del coach (rutinas/comunidad/IA)
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
    el.innerHTML = `<span class="toast__ico">${icons[type]}</span><div><div class="toast__txt">${api.esc(txt)}</div>${sub ? `<div class="toast__sub">${api.esc(sub)}</div>` : ""}</div>`;
    stack.appendChild(el);
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 220); }, 2800);
  }
  window.msfToast = toast;
  function errToast(e, fallback) {
    console.error(fallback + ":", e); // detalle técnico solo a consola, nunca al usuario
    toast(fallback, api.friendlyError(e), "err");
  }

  /* ---------- Navegación entre vistas ---------- */
  const titles = {
    dashboard: ["Dashboard", ""],
    alumnos: ["Alumnos", "Gestiona a tu comunidad"],
    pagos: ["Pagos", "Control de cobros y membresías"],
    rutinas: ["Rutinas", "Constructor de entrenamientos"],
    comunidad: ["Comunidad", "Novedades para tus alumnos"],
    mensajes: ["Mensajes", "Conversaciones activas"],
    referidos: ["Referidos", "Tu código y tu red de coaches"],
    ajustes: ["Ajustes", "Tu cuenta y preferencias"],
  };
  /* Vistas que dependen del plan del coach */
  const VIEW_FEATURE = { rutinas: "routines", comunidad: "community" };
  function viewLocked(view) {
    const feat = VIEW_FEATURE[view];
    return feat && FEATURES && !FEATURES[feat];
  }
  function goTo(view) {
    if (viewLocked(view)) {
      const what = view === "rutinas" ? "El constructor de rutinas personalizadas" : "La comunidad para tus alumnos";
      $("#upsellText") && ($("#upsellText").textContent = `${what} forma parte del plan Star Plus. Mejora tu plan para desbloquearlo.`);
      $("#modal-upsell")?.classList.add("is-open");
      return;
    }
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
    if (view === "referidos") renderReferrals();
  }
  document.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]");
    if (nav) { goTo(nav.dataset.nav); }
  });

  $("#menuToggle")?.addEventListener("click", () => $("#sidebar").classList.toggle("is-open"));

  function toggleTheme() {
    const mode = window.msfTheme.toggleMode();
    toast(mode === "light" ? "Modo claro activado" : "Modo oscuro activado", "", "info");
  }
  $("#themeToggle")?.addEventListener("click", toggleTheme);
  $("#themeToggle2")?.addEventListener("click", toggleTheme);

  /* ---------- Ajustes: color de acento ---------- */
  function renderAccentSwatches() {
    const wrap = $("#accentSwatches");
    if (!wrap) return;
    const current = window.msfTheme.getAccent().toLowerCase();
    wrap.innerHTML = window.msfTheme.PRESETS.map((p) =>
      `<button type="button" class="swatch ${p.hex.toLowerCase() === current ? "is-active" : ""}" data-accent="${p.hex}" title="${p.name}" style="background:${p.hex}"></button>`
    ).join("");
    const custom = $("#accentCustom");
    if (custom) custom.value = window.msfTheme.getAccent();
  }
  $("#accentSwatches")?.addEventListener("click", (e) => {
    const sw = e.target.closest("[data-accent]");
    if (!sw) return;
    window.msfTheme.setAccent(sw.dataset.accent);
    renderAccentSwatches();
    toast("Color actualizado", "", "ok");
  });
  $("#accentCustom")?.addEventListener("input", (e) => {
    window.msfTheme.setAccent(e.target.value);
    renderAccentSwatches();
  });
  $("#accentReset")?.addEventListener("click", () => {
    window.msfTheme.reset();
    renderAccentSwatches();
    toast("Color restablecido", "", "info");
  });

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
        <td><div class="cell-user"><div class="avatar avatar--sm">${s.initials}</div><div><div class="cell-user__name">${api.esc(s.full_name)}</div><div class="cell-user__sub">${s.age ? s.age + " años" : "—"}</div></div></div></td>
        <td><span class="badge ${badgeClass[s.state]}">${stateLabel[s.state]}</span></td>
        <td>${api.esc(s.training_type)}</td>
        <td class="muted">${api.esc(s.goal || "—")}</td>
        <td><span style="color:var(--${due.tone === "t3" ? "text-3" : due.tone});font-family:var(--font-mono);font-size:13px">${due.text}</span></td>
        <td><div class="cell-actions">
          <button class="icon-btn js-msg-student" data-student="${s.id}" style="width:32px;height:32px" title="Mensaje"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v12H5.2L4 17.2V4z"/></svg></button>
          <button class="icon-btn js-open-student" style="width:32px;height:32px" title="Ver ficha"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></button>
        </div></td>
      </tr>`;
    }).join("");
    if (!list.length && tbody) tbody.innerHTML = `<tr><td colspan="6" class="t3 text-sm" style="padding:20px;text-align:center">Sin alumnos que coincidan con el filtro.</td></tr>`;

    if (cards) cards.innerHTML = list.map((s) => {
      const due = dueLabel(s);
      return `
      <div class="card card--hover student-card" data-student="${s.id}" style="cursor:pointer">
        <div class="student-card__head"><div class="avatar avatar--md">${s.initials}</div><div><div class="student-card__name">${api.esc(s.full_name)}</div><div class="student-card__sub">${s.age ? s.age + " años · " : ""}${api.esc(s.training_type)}</div></div></div>
        <div style="margin-bottom:12px"><span class="badge ${badgeClass[s.state]}">${stateLabel[s.state]}</span></div>
        <div class="student-card__rows">
          <div class="kv"><span>Objetivo</span><span>${api.esc(s.goal || "—")}</span></div>
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
        <td><div class="cell-user"><div class="avatar avatar--sm">${p.initials}</div><div class="cell-user__name">${api.esc(p.student_name)}</div></div></td>
        <td class="muted">${api.esc(p.concept)}</td>
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
        <div class="due-row__meta"><div class="due-row__name">${api.esc(p.student_name)}</div><div class="due-row__sub">${api.esc(p.concept)} · $${p.amount}</div></div>
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
        <div><div class="alert-item__txt">${api.esc(f.title)}</div><div class="alert-item__sub">${api.esc(f.subtitle || (f.students ? f.students.full_name : ""))}</div></div>
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
    if (e.target.value && !$("#view-alumnos").classList.contains("is-active")) goTo("alumnos");
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

    // Objetivos del onboarding del alumno (solo si ya lo completó)
    const obCard = $("#dwOnboardingCard");
    if (obCard) {
      if (s.onboarding_completed_at) {
        obCard.classList.remove("hidden");
        $("#dwWeightGoal") && ($("#dwWeightGoal").textContent = s.weight_goal ?? "—");
        $("#dwExperience") && ($("#dwExperience").textContent = s.experience_level || "—");
        $("#dwFrequency") && ($("#dwFrequency").textContent = s.training_frequency ? s.training_frequency + " días/sem" : "—");
        $("#dwTargetDate") && ($("#dwTargetDate").textContent = s.target_date ? new Date(s.target_date + "T00:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" }) : "—");
        $("#dwInjuries") && ($("#dwInjuries").textContent = s.injuries || "Ninguna");
        $("#dwMotivation") && ($("#dwMotivation").textContent = s.motivation || "—");
      } else {
        obCard.classList.add("hidden");
      }
    }

    const dwPayments = $("#dwPayments");
    if (dwPayments) {
      const rows = PAYMENTS.filter((p) => p.student_id === id);
      dwPayments.innerHTML = rows.map((p) => `<div class="due-row"><div class="due-row__meta"><div class="due-row__name">${api.esc(p.concept)}</div><div class="due-row__sub">${p.state === "ok" ? "Pagado" : new Date(p.due_date).toLocaleDateString("es-MX")}</div></div><span class="mono">$${p.amount}</span><span class="badge ${badgeClass[p.state]}">${p.state === "ok" ? "Pagado" : stateLabel[p.state]}</span></div>`).join("") || `<p class="t3 text-sm">Sin pagos registrados.</p>`;
    }

    // Seguimientos del alumno (reales)
    const dwFu = $("#dwFollowUps");
    if (dwFu) {
      const fus = FOLLOW_UPS.filter((f) => f.student_id === id);
      dwFu.innerHTML = fus.map((f) => `
        <div class="alert-item ${f.is_done ? "is-done" : ""}" data-followup="${f.id}">
          <span class="check js-check ${f.is_done ? "is-done" : ""}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>
          <div><div class="alert-item__txt">${api.esc(f.title)}</div><div class="alert-item__sub">${f.is_done ? "Completado" : new Date(f.due_at).toLocaleDateString("es-MX")}</div></div>
        </div>`).join("") || `<p class="t3 text-sm">Sin seguimientos para este alumno.</p>`;
    }

    loadDrawerRoutine(id);
    loadDrawerPhotos(id);
    drawer.classList.add("is-open");
    overlay.classList.add("is-open");
    document.body.style.overflow = "hidden";
  }

  /* Rutina real del alumno en la pestaña Rutina del drawer */
  async function loadDrawerRoutine(studentId) {
    const box = $("#dwRoutine");
    if (!box) return;
    $("#dwEditRoutine") && ($("#dwEditRoutine").style.display = FEATURES?.routines ? "" : "none");
    box.innerHTML = `<p class="t3 text-sm">Cargando…</p>`;
    try {
      const routine = await api.getStudentRoutine(studentId);
      if (!routine || !routine.days?.length) {
        box.innerHTML = `<p class="t3 text-sm">Sin rutina asignada todavía.</p>`;
        return;
      }
      const dayLabels = { lunes: "Lunes", martes: "Martes", miercoles: "Miércoles", jueves: "Jueves", viernes: "Viernes", sabado: "Sábado", domingo: "Domingo" };
      box.innerHTML = `<div class="section-title">${api.esc(routine.name || "Rutina")} · ${api.esc(routine.phase || "")} · Semana ${routine.week || 1}</div>` +
        routine.days.map((d) => `<div class="kv mb-2"><span>${api.esc(dayLabels[d.day_name] || d.day_name)}</span><span>${api.esc(d.label || "Día")} · ${(d.exercises || []).length} ejercicios</span></div>`).join("");
    } catch (ex) { box.innerHTML = `<p class="t3 text-sm">No se pudo cargar la rutina.</p>`; }
  }

  /* Fotos de progreso reales del alumno en la pestaña Progreso del drawer */
  async function loadDrawerPhotos(studentId) {
    const compare = $('#studentDrawer [data-panel="progreso"] .compare');
    if (!compare) return;
    try {
      const photos = await api.listProgressPhotos(studentId);
      if (!photos.length) return; // conserva los placeholders si aún no hay fotos
      const first = photos[0];
      const last = photos[photos.length - 1];
      const cell = (p, label) => `<div class="compare__ph"><span>${label} · ${new Date(p.taken_at).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}</span><img src="${p.url}" style="width:100%;height:100%;object-fit:cover" alt="${label}"></div>`;
      compare.innerHTML = photos.length === 1 ? cell(first, "Última") : cell(first, "Primera") + cell(last, "Última");
    } catch (ex) { console.error("No se pudieron cargar las fotos de progreso:", ex); }
  }

  /* ---------- Editar datos del alumno (desde la ficha) ---------- */
  let EDIT_STUDENT_ID = null;
  function setStudentModalMode(edit) {
    const modal = $("#modal-newStudent");
    if (!modal) return;
    modal.querySelector("h3").textContent = edit ? "Editar alumno" : "Nuevo alumno";
    modal.querySelector("p").textContent = edit
      ? "Actualiza los datos del alumno. El correo y la contraseña de acceso no se cambian aquí."
      : "Crea la cuenta del alumno y su membresía. Se sincroniza con Pagos, Mensajes y Rutinas.";
    $("#nsSubmit").textContent = edit ? "Guardar cambios" : "Crear alumno";
    // Campos que solo aplican al alta (cuenta y cobro inicial)
    ["nsEmail", "nsPassword", "nsAmount", "nsPayState"].forEach((id) => {
      const f = $("#" + id)?.closest(".field");
      if (f) f.style.display = edit ? "none" : "";
    });
  }
  function openStudentEditor(id) {
    const s = STUDENTS.find((x) => x.id === id);
    if (!s) return;
    EDIT_STUDENT_ID = id;
    $("#nsName").value = s.full_name || "";
    $("#nsPhone").value = s.phone || "";
    $("#nsType").value = s.training_type || "Online";
    if (s.goal) $("#nsGoal").value = s.goal;
    $("#nsWeight").value = s.weight_current ?? "";
    $("#nsWeightGoal").value = s.weight_goal ?? "";
    $("#nsStart").value = s.member_since || "";
    $("#nsEnd").value = s.membership_end || "";
    $("#nsNotes").value = s.private_notes || "";
    setStudentModalMode(true);
    $("#modal-newStudent").classList.add("is-open");
  }
  $("#btnEditStudent")?.addEventListener("click", () => { if (CURRENT_STUDENT_ID) openStudentEditor(CURRENT_STUDENT_ID); });
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
    if (open) {
      const name = open.dataset.modal;
      const today = new Date().toISOString().slice(0, 10);
      if (name === "newPayment") {
        fillStudentSelect($("#npStudent"), { includeEmpty: true, emptyLabel: "Selecciona…" });
        if (!$("#npDue").value) $("#npDue").value = today;
      }
      if (name === "newFollowUp") {
        fillStudentSelect($("#fuStudent"), { includeEmpty: true, emptyLabel: "Sin alumno" });
        if (!$("#fuDate").value) $("#fuDate").value = today;
      }
      if (name === "newStudent" && open.matches("[data-modal='newStudent']")) {
        // Apertura desde "Nuevo alumno" → modo alta limpio
        EDIT_STUDENT_ID = null;
        $("#formNewStudent").reset();
        setStudentModalMode(false);
        $("#nsStart").value = today;
      }
      $("#modal-" + name)?.classList.add("is-open");
    }
    if (e.target.classList.contains("modal-overlay") || e.target.closest(".js-modal-close")) {
      $$(".modal-overlay").forEach((m) => m.classList.remove("is-open"));
    }
  });

  /* ---------- Nuevo alumno (completo + sincronizado) ---------- */
  $("#formNewStudent")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#nsName").value.trim();
    if (!name) return;
    const email = $("#nsEmail").value.trim();
    const password = $("#nsPassword").value;
    if (email && (!password || password.length < 6)) {
      return errToast({ message: "La contraseña debe tener al menos 6 caracteres." }, "Falta la contraseña");
    }
    const btn = $("#nsSubmit");
    const btnLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Guardando…";
    const num = (v) => (v === "" || v == null ? null : Number(v));

    // ----- Modo edición: actualiza la ficha existente (sin auth ni cobro) -----
    if (EDIT_STUDENT_ID) {
      try {
        const updated = await api.updateStudent(EDIT_STUDENT_ID, {
          full_name: name,
          phone: $("#nsPhone").value.trim() || null,
          training_type: $("#nsType").value,
          goal: $("#nsGoal").value,
          weight_current: num($("#nsWeight").value),
          weight_goal: num($("#nsWeightGoal").value),
          member_since: $("#nsStart").value || null,
          membership_end: $("#nsEnd").value || null,
          private_notes: $("#nsNotes").value.trim() || null,
        });
        const idx = STUDENTS.findIndex((x) => x.id === EDIT_STUDENT_ID);
        if (idx > -1) STUDENTS[idx] = { ...STUDENTS[idx], ...updated, initials: api.initials(updated.full_name) };
        renderStudents();
        if (CURRENT_STUDENT_ID === EDIT_STUDENT_ID) openDrawer(EDIT_STUDENT_ID);
        $$(".modal-overlay").forEach((m) => m.classList.remove("is-open"));
        EDIT_STUDENT_ID = null;
        toast("Alumno actualizado", name, "ok");
      } catch (ex) { errToast(ex, "No se pudo actualizar el alumno"); }
      finally { btn.disabled = false; btn.textContent = btnLabel; }
      return;
    }
    try {
      const created = await api.createStudentFull(PROFILE.id, {
        full_name: name,
        email, password,
        phone: $("#nsPhone").value.trim(),
        training_type: $("#nsType").value,
        goal: $("#nsGoal").value,
        weight_current: num($("#nsWeight").value),
        weight_goal: num($("#nsWeightGoal").value),
        member_since: $("#nsStart").value || null,
        membership_end: $("#nsEnd").value || null,
        payment_amount: num($("#nsAmount").value),
        state: $("#nsPayState").value,
        private_notes: $("#nsNotes").value.trim(),
      });
      STUDENTS.push(created);
      STUDENTS.sort((a, b) => a.full_name.localeCompare(b.full_name));
      renderStudents();
      await refreshPayments();
      updateKpis();
      $$(".modal-overlay").forEach((m) => m.classList.remove("is-open"));
      e.target.reset();
      toast("Alumno creado", email ? `${name} ya puede iniciar sesión` : name, "ok");
      applyPlanGating();
    } catch (ex) {
      if (ex._planLimit) toast("Límite del plan alcanzado", ex.message, "err");
      else if (ex._authOnly) errToast(ex, "No se pudo crear la cuenta de acceso (¿correo ya usado?)");
      else errToast(ex, "No se pudo crear el alumno");
    } finally { btn.disabled = false; btn.textContent = btnLabel; }
  });

  /* ---------- Registrar pago (persistido) ---------- */
  $("#formNewPayment")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const studentId = $("#npStudent").value;
    const amount = Number($("#npAmount").value);
    if (!studentId || !amount) return;
    try {
      await api.createPayment(PROFILE.id, {
        student_id: studentId,
        concept: $("#npConcept").value.trim() || "Membresía",
        amount,
        due_date: $("#npDue").value,
        state: $("#npState").value,
        paid_at: $("#npState").value === "ok" ? new Date().toISOString() : null,
      });
      await refreshPayments();
      renderStudents();
      updateKpis();
      $$(".modal-overlay").forEach((m) => m.classList.remove("is-open"));
      e.target.reset();
      $("#npConcept").value = "Membresía";
      toast("Pago registrado", "", "ok");
    } catch (ex) { errToast(ex, "No se pudo registrar el pago"); }
  });

  /* ---------- Nuevo objetivo / seguimiento (persistido) ---------- */
  $("#formNewFollowUp")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("#fuTitle").value.trim();
    if (!title) return;
    const studentId = $("#fuStudent").value || null;
    try {
      await api.createFollowUp(PROFILE.id, studentId, {
        title,
        due_at: ($("#fuDate").value ? new Date($("#fuDate").value).toISOString() : new Date().toISOString()),
      });
      FOLLOW_UPS = await api.listFollowUps(PROFILE.id);
      renderFollowUps();
      renderNotifications();
      $$(".modal-overlay").forEach((m) => m.classList.remove("is-open"));
      e.target.reset();
      toast("Objetivo creado", "", "ok");
    } catch (ex) { errToast(ex, "No se pudo crear el objetivo"); }
  });

  /* Rellena los <select> de alumnos al abrir cada modal / vista */
  function fillStudentSelect(sel, { includeEmpty = false, emptyLabel = "" } = {}) {
    if (!sel) return;
    const opts = (includeEmpty ? `<option value="">${emptyLabel}</option>` : "") +
      STUDENTS.map((s) => `<option value="${s.id}">${api.esc(s.full_name)}</option>`).join("");
    const prev = sel.value;
    sel.innerHTML = opts;
    if (prev) sel.value = prev;
  }

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
      renderNotifications();
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

  /* ---------- Tilt 3D + glare en cards ----------
     La card rota en perspectiva y expone --gx/--gy para que el
     brillo radial (.tilt::after) siga al cursor. */
  function attachTilt(el, maxDeg = 6) {
    el.addEventListener("mousemove", (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `perspective(700px) rotateY(${(px * maxDeg).toFixed(2)}deg) rotateX(${(-py * maxDeg).toFixed(2)}deg) translateY(-2px)`;
      el.style.setProperty("--gx", ((px + 0.5) * 100).toFixed(1) + "%");
      el.style.setProperty("--gy", ((py + 0.5) * 100).toFixed(1) + "%");
    });
    el.addEventListener("mouseleave", () => { el.style.transform = ""; });
  }
  const supportsHoverTilt = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (supportsHoverTilt) {
    $$(".tilt").forEach((el) => attachTilt(el));
    // Cards interactivas también reciben tilt sutil + glare
    $$(".card--hover, .border-conic").forEach((el) => {
      if (!el.classList.contains("tilt")) { el.classList.add("tilt"); attachTilt(el, 3.5); }
    });
  }

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
          <div class="day-col__head"><span class="day-col__title">${dayLabels[d]}</span><span class="day-col__count">${api.esc(existing?.label || "Día")} · ${exercises.length}</span></div>
          ${exercises.map((ex) => exerciseCardHTML(ex)).join("")}
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
          muscle_group: $('[data-field="muscle_group"]', card)?.value || null,
        }));
        await api.saveRoutineDay(routineId, day, label, exercises, i);
      }
      toast("Rutina guardada", "Se envió al alumno", "ok");
    } catch (ex) { errToast(ex, "No se pudo guardar la rutina"); }
  });

  let dragEl = null;
  let placeholder = null;
  function attachCardDrag(card) {
    const board = $("#builderBoard");
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
      placeholder?.remove(); placeholder = null;
      dragEl = null;
    });
  }
  const MUSCLE_GROUPS = ["Pecho", "Pecho superior", "Pecho inferior", "Espalda", "Dorsal", "Espalda baja", "Hombro", "Deltoide frontal", "Deltoide lateral", "Deltoide posterior", "Bíceps", "Tríceps", "Antebrazo", "Cuádriceps", "Femoral", "Glúteo", "Pantorrilla", "Core", "Abdomen", "Oblicuos", "Full body", "Cardio"];
  function muscleSelectHTML(current) {
    return `<select class="select" data-field="muscle_group" style="height:30px;font-size:12px;padding:0 8px;margin-top:6px;width:100%">
      <option value="">Músculo…</option>
      ${MUSCLE_GROUPS.map((m) => `<option${current === m ? " selected" : ""}>${m}</option>`).join("")}
    </select>`;
  }
  function exerciseCardHTML(ex = {}) {
    return `<div class="ex-card" draggable="true"><div class="ex-card__name" contenteditable="true">${api.esc(ex.name || "Nuevo ejercicio")}</div><div class="ex-card__grid"><div class="ex-input"><label>Series</label><input value="${ex.sets ?? ""}" data-field="sets"></div><div class="ex-input"><label>Reps</label><input value="${ex.reps ?? ""}" data-field="reps"></div><div class="ex-input"><label>Kg</label><input value="${ex.kg ?? ""}" data-field="kg"></div><div class="ex-input"><label>Desc</label><input value="${ex.rest_seconds ?? ""}" data-field="rest_seconds"></div></div>${muscleSelectHTML(ex.muscle_group)}</div>`;
  }
  function addExercise(col, ex = {}) {
    const tmp = document.createElement("div");
    tmp.innerHTML = exerciseCardHTML(ex);
    const card = tmp.firstElementChild;
    const addBtn = $(".day-add", col);
    if (addBtn) col.insertBefore(card, addBtn); else col.appendChild(card);
    attachCardDrag(card);
    const countEl = $(".day-col__count", col);
    if (countEl && countEl.textContent.includes("·")) {
      const label = countEl.textContent.split("·")[0].trim();
      countEl.textContent = `${label} · ${$$(".ex-card", col).length}`;
    }
  }
  function initBuilderDnD() {
    const board = $("#builderBoard");
    if (!board) return;
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
    $$(".ex-card", board).forEach((card) => attachCardDrag(card));
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
    if (e.target.closest("[data-nav='rutinas']") && CURRENT_STUDENT_ID) {
      const sel = $("#routineStudentSelect");
      if (sel) sel.value = CURRENT_STUDENT_ID;
      loadRoutineBuilder(CURRENT_STUDENT_ID);
    }
  });

  /* Selector de alumno directamente en la vista Rutinas (crear rutina manual) */
  function fillRoutineSelect() {
    const sel = $("#routineStudentSelect");
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = `<option value="">Selecciona un alumno…</option>` +
      STUDENTS.map((s) => `<option value="${s.id}">${api.esc(s.full_name)}</option>`).join("");
    if (prev) sel.value = prev;
  }
  $("#routineStudentSelect")?.addEventListener("change", (e) => {
    const id = e.target.value;
    if (!id) return;
    CURRENT_STUDENT_ID = id;
    loadRoutineBuilder(id);
  });

  /* "+ Añadir ejercicio" y biblioteca (click para agregar al primer día) */
  $("#builderBoard")?.addEventListener("click", (e) => {
    const add = e.target.closest(".day-add");
    if (!add) return;
    const col = add.closest(".day-col");
    if (col) addExercise(col);
  });
  document.querySelector(".ex-library")?.addEventListener("click", (e) => {
    const item = e.target.closest(".ex-lib-item");
    if (!item) return;
    if (!$("#builderBoard")?.dataset.routineId) return toast("Elige un alumno primero", "", "info");
    const name = item.querySelector(".fw-600")?.textContent.trim() || "Ejercicio";
    const firstCol = $("#builderBoard .day-col");
    if (firstCol) { addExercise(firstCol, { name }); toast("Ejercicio añadido", name, "ok"); }
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
          <div class="row gap-3 mb-4"><div class="avatar avatar--md">${api.initials(p.profiles?.full_name)}</div><div><div class="fw-600">${api.esc(p.profiles?.full_name || "Coach")}</div><div class="t3 text-sm">${new Date(p.created_at).toLocaleString("es-MX")}</div></div></div>
          <p style="margin-bottom:12px">${api.esc(p.body)}</p>
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
      list.innerHTML = convos.map((c) => `<div class="alert-item radius-0 js-conversation" data-student="${c.id}" style="cursor:pointer"><div class="avatar avatar--md">${api.initials(c.full_name)}</div><div><div class="alert-item__txt">${api.esc(c.full_name)}</div></div></div>`).join("") || `<p class="t3 text-sm" style="padding:16px">Sin conversaciones aún.</p>`;
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
      body.innerHTML = msgs.map((m) => `<div style="align-self:${m.sender_id === PROFILE.id ? "flex-end" : "flex-start"};max-width:70%;background:${m.sender_id === PROFILE.id ? "var(--indigo)" : "var(--surface-3)"};color:${m.sender_id === PROFILE.id ? "#fff" : "inherit"};padding:10px 14px;border-radius:14px 14px ${m.sender_id === PROFILE.id ? "4px 14px" : "14px 4px"}">${api.esc(m.body)}</div>`).join("") || `<p class="t3 text-sm">Aún no hay mensajes en esta conversación.</p>`;
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

  /* ---------- Notificaciones (derivadas de datos reales) ---------- */
  const NOTIF_READ_KEY = "msf_notif_read";
  function readNotifIds() { try { return new Set(JSON.parse(localStorage.getItem(NOTIF_READ_KEY) || "[]")); } catch { return new Set(); } }
  function buildNotifications() {
    const items = [];
    PAYMENTS.filter((p) => p.state !== "ok").forEach((p) => {
      const days = Math.ceil((new Date(p.due_date) - new Date()) / 86400000);
      if (days > 5) return;
      const late = days < 0;
      items.push({
        id: "pay-" + p.id,
        tone: late ? "coral" : "amber",
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
        text: late ? `Pago atrasado · ${p.student_name}` : `Pago por vencer · ${p.student_name}`,
        sub: `$${p.amount} · ${late ? `atrasado ${-days}d` : days === 0 ? "vence hoy" : `en ${days} días`}`,
        nav: "pagos",
      });
    });
    FOLLOW_UPS.filter((f) => !f.is_done).forEach((f) => {
      items.push({
        id: "fu-" + f.id,
        tone: "indigo",
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
        text: f.title,
        sub: f.subtitle || (f.students ? f.students.full_name : "Seguimiento"),
        nav: "dashboard",
      });
    });
    return items;
  }
  function renderNotifications() {
    const list = $("#notifList");
    const dot = $("#notifDot");
    if (!list) return;
    const items = buildNotifications();
    const read = readNotifIds();
    const unread = items.filter((i) => !read.has(i.id)).length;
    if (dot) { dot.textContent = unread; dot.classList.toggle("hidden", unread === 0); }
    list.innerHTML = items.map((i) => `
      <button class="notif-item ${read.has(i.id) ? "" : "is-unread"}" data-notif-nav="${i.nav}">
        <span class="notif-item__ico notif-item__ico--${i.tone}">${i.icon}</span>
        <span class="notif-item__body"><span class="notif-item__txt">${api.esc(i.text)}</span><span class="notif-item__sub">${api.esc(i.sub)}</span></span>
      </button>`).join("") || `<p class="t3 text-sm" style="padding:16px;text-align:center">Todo al día 🎉</p>`;
  }
  $("#notifBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    $("#notifPanel")?.classList.toggle("is-open");
    renderNotifications();
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".notif-wrap")) $("#notifPanel")?.classList.remove("is-open");
    const n = e.target.closest("[data-notif-nav]");
    if (n) { goTo(n.dataset.notifNav); $("#notifPanel")?.classList.remove("is-open"); }
  });
  $("#notifMarkAll")?.addEventListener("click", () => {
    const ids = buildNotifications().map((i) => i.id);
    localStorage.setItem(NOTIF_READ_KEY, JSON.stringify(ids));
    renderNotifications();
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
  /* Delta real de un KPI: texto + dirección (up/down) calculados de los datos */
  function setKpiDelta(kpiEl, text, dir) {
    const delta = kpiEl?.querySelector(".kpi__delta");
    if (!delta) return;
    const arrow = dir === "down"
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>';
    delta.className = "kpi__delta " + (dir === "down" ? "down" : "up");
    delta.innerHTML = arrow + api.esc(text);
  }
  /* Sparkline con la serie real (o se oculta si no hay historia que mostrar) */
  function setKpiSpark(kpiEl, values) {
    const spark = kpiEl?.querySelector(".kpi__spark polyline");
    if (!spark) return;
    if (!values || values.length < 2 || values.every((v) => v === values[0])) {
      spark.closest("svg").style.visibility = "hidden";
      return;
    }
    spark.closest("svg").style.visibility = "";
    const max = Math.max(...values), min = Math.min(...values);
    const pts = values.map((v, i) => {
      const x = Math.round((i / (values.length - 1)) * 100);
      const y = Math.round(26 - ((v - min) / (max - min || 1)) * 22);
      return x + "," + y;
    });
    spark.setAttribute("points", pts.join(" "));
  }
  function updateKpis() {
    const fin = api.financeKpis(PAYMENTS);
    const active = STUDENTS.filter((s) => s.state === "ok").length;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const newThisMonth = STUDENTS.filter((s) => s.created_at && new Date(s.created_at) >= monthStart).length;
    const newPrevMonth = STUDENTS.filter((s) => s.created_at && new Date(s.created_at) >= prevMonthStart && new Date(s.created_at) < monthStart).length;
    const kpiEls = $$("#view-dashboard .kpi");
    const kpis = $$("#view-dashboard .kpi__value[data-count]");
    if (kpis[0]) kpis[0].dataset.count = fin.collectedMonth;
    if (kpis[1]) kpis[1].dataset.count = active;
    if (kpis[2]) kpis[2].dataset.count = newThisMonth;
    if (kpis[3]) kpis[3].dataset.count = fin.pendingCount;

    // Deltas y sparklines con datos reales (nada de números decorativos)
    const monthly = fin.monthly.map((m) => m.total);
    const prevRev = monthly[monthly.length - 2] || 0;
    const curRev = monthly[monthly.length - 1] || 0;
    const revPct = prevRev > 0 ? Math.round(((curRev - prevRev) / prevRev) * 100) : null;
    setKpiDelta(kpiEls[0], revPct === null ? "vs mes anterior: —" : `${Math.abs(revPct)}% vs mes anterior`, revPct !== null && revPct < 0 ? "down" : "up");
    setKpiSpark(kpiEls[0], monthly);
    setKpiDelta(kpiEls[1], `+${newThisMonth} este mes`, "up");
    setKpiSpark(kpiEls[1], null);
    const newDiff = newThisMonth - newPrevMonth;
    setKpiDelta(kpiEls[2], `${newDiff >= 0 ? "+" : ""}${newDiff} vs mes anterior`, newDiff < 0 ? "down" : "up");
    setKpiSpark(kpiEls[2], null);
    const lateCount = PAYMENTS.filter((p) => p.state === "late" || (p.state !== "ok" && new Date(p.due_date) < now)).length;
    setKpiDelta(kpiEls[3], `${lateCount} atrasados`, lateCount > 0 ? "down" : "up");
    setKpiSpark(kpiEls[3], null);
    renderFinance(fin);
  }

  /* ---------- Finanzas reales (vista Pagos + gráfico del dashboard) ---------- */
  const money = (n) => "$" + Number(n || 0).toLocaleString("es-MX");
  function renderFinance(fin) {
    fin = fin || api.financeKpis(PAYMENTS);
    $("#finCollected") && ($("#finCollected").textContent = money(fin.collectedMonth));
    $("#finPending") && ($("#finPending").textContent = money(fin.pendingAmount));
    $("#finOverdue") && ($("#finOverdue").textContent = money(fin.overdueAmount));
    $("#finTicket") && ($("#finTicket").textContent = money(fin.avgTicket));

    // Gráfico de ingresos del dashboard con los cobros reales de 12 meses
    const wrap = $("#revenueChartWrap");
    if (!wrap) return;
    const values = fin.monthly.map((m) => m.total);
    wrap.dataset.chartValues = values.join(",");
    const totalEl = wrap.closest(".chart-card")?.querySelector(".chart-total");
    if (totalEl) totalEl.textContent = money(fin.collectedMonth);
    const max = Math.max(...values, 1);
    const pts = values.map((v, i) => [Math.round(i * (640 / (values.length - 1))), Math.round(200 - (v / max) * 160)]);
    const line = "M" + pts.map((p) => p.join(",")).join(" L");
    const svg = wrap.querySelector(".chart-svg");
    if (svg) {
      const paths = svg.querySelectorAll("path");
      if (paths[0]) paths[0].setAttribute("d", line + " L640,240 L0,240 Z");
      if (paths[1]) paths[1].setAttribute("d", line);
      const dot = svg.querySelector("circle.chart-dot-indigo");
      if (dot && pts.length) { dot.setAttribute("cx", pts[pts.length - 1][0]); dot.setAttribute("cy", pts[pts.length - 1][1]); }
    }
    const legend = wrap.closest(".chart-card")?.querySelector(".chart-legend span:first-child");
    if (legend) legend.innerHTML = `<i style="background:var(--indigo)"></i>Ingresos ${new Date().getFullYear()}`;
    const updated = wrap.closest(".chart-card")?.querySelector(".chart-legend .t3");
    if (updated) updated.textContent = "Cobros reales · últimos 12 meses";
  }

  /* ---------- Gating por plan ---------- */
  const lockSvg = '<svg viewBox="0 0 24 24" width="13" fill="none" stroke="currentColor" stroke-width="2" style="margin-left:auto;opacity:.6"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
  function applyPlanGating() {
    const plan = PROFILE.plan || "Star";
    FEATURES = api.planFeatures(plan);
    // Badge del plan en el sidebar
    const planBadge = $(".coach-card__plan .badge");
    if (planBadge) planBadge.textContent = "★ " + plan;
    // Candados en la navegación: se añaden si la feature está bloqueada y se
    // quitan si el plan la desbloquea (p. ej. tras subir a Star Plus).
    Object.entries(VIEW_FEATURE).forEach(([view, feat]) => {
      const item = $(`.nav__item[data-nav="${view}"]`);
      if (!item) return;
      const existing = item.querySelector("svg[data-lock]");
      if (!FEATURES[feat] && !existing) {
        const tmp = document.createElement("span");
        tmp.innerHTML = lockSvg;
        tmp.firstChild.dataset.lock = "1";
        item.appendChild(tmp.firstChild);
      } else if (FEATURES[feat] && existing) {
        existing.remove();
      }
    });
    // Tarjeta del plan en Ajustes: nombre, límite y uso
    const limit = api.planLimit(plan);
    $("#planName") && ($("#planName").textContent = plan);
    $("#planDesc") && ($("#planDesc").textContent = FEATURES.routines
      ? `Hasta ${limit} alumnos · Rutinas personalizadas · Comunidad`
      : `Hasta ${limit} alumnos · Gestión de alumnos y pagos`);
    $("#planUsage") && ($("#planUsage").textContent = `${STUDENTS.length}/${limit}`);
    $("#planUsageBar") && ($("#planUsageBar").style.width = Math.min(100, (STUDENTS.length / limit) * 100) + "%");
    renderSubscription();
  }

  /* ---------- Suscripción (Stripe) ---------- */
  const STATUS_LABEL = {
    active: ["Activa", "badge--ok"], trialing: ["Prueba", "badge--ok"],
    past_due: ["Pago pendiente", "badge--pend"], unpaid: ["Sin pagar", "badge--late"],
    canceled: ["Cancelada", "badge--late"], incomplete: ["Incompleta", "badge--pend"],
    incomplete_expired: ["Expirada", "badge--late"],
  };
  function renderSubscription() {
    const plan = PROFILE.plan || "Star";
    const status = PROFILE.subscription_status;
    const active = status === "active" || status === "trialing";
    const row = $("#subStatusRow"), badge = $("#subStatusBadge");
    if (row && badge) {
      if (status) {
        row.classList.remove("hidden");
        const [txt, cls] = STATUS_LABEL[status] || [status, "badge--pend"];
        badge.textContent = txt;
        badge.className = "badge " + cls;
      } else {
        row.classList.add("hidden");
      }
    }
    // Botones: resalta el plan actual, ofrece el cambio, y muestra "Administrar" si ya hay suscripción.
    const bStar = $("#btnPlanStar"), bPlus = $("#btnPlanStarPlus"), manage = $("#btnManageSub"), hint = $("#planHint");
    if (bStar && bPlus) {
      bStar.disabled = active && plan === "Star";
      bPlus.disabled = active && plan === "Star Plus";
      bStar.textContent = plan === "Star" && active ? "Star · plan actual" : "Star · $500/mes";
      bPlus.textContent = plan === "Star Plus" && active ? "Star Plus · plan actual" : "Star Plus · $1,000/mes";
    }
    if (manage) manage.classList.toggle("hidden", !PROFILE.stripe_customer_id);
    if (hint) {
      hint.textContent = active
        ? (PROFILE.current_period_end ? `Se renueva el ${new Date(PROFILE.current_period_end).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" })}` : "")
        : "Suscríbete para activar tu plan. Pagos seguros con Stripe.";
    }
  }

  async function startCheckout(plan) {
    try {
      const { data: { session } } = await window.msfSupabase.auth.getSession();
      if (!session) return toast("Sesión expirada, vuelve a entrar", "", "err");
      toast("Abriendo pago seguro…", "", "info");
      const r = await fetch("/api/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: session.access_token, plan }),
      });
      const data = await r.json();
      if (!r.ok || !data.url) throw new Error(data.error || "No se pudo iniciar el pago");
      window.location.href = data.url;
    } catch (ex) { errToast(ex, "No se pudo iniciar el pago"); }
  }
  async function openPortal() {
    try {
      const { data: { session } } = await window.msfSupabase.auth.getSession();
      if (!session) return toast("Sesión expirada, vuelve a entrar", "", "err");
      const r = await fetch("/api/portal", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: session.access_token }),
      });
      const data = await r.json();
      if (!r.ok || !data.url) throw new Error(data.error || "No se pudo abrir el portal");
      window.location.href = data.url;
    } catch (ex) { errToast(ex, "No se pudo abrir el portal"); }
  }
  $("#btnPlanStar")?.addEventListener("click", () => startCheckout("Star"));
  $("#btnPlanStarPlus")?.addEventListener("click", () => startCheckout("Star Plus"));
  $("#btnManageSub")?.addEventListener("click", openPortal);

  /* Al volver de Stripe: refresca el perfil (el webhook ya sincronizó el plan). */
  async function handleCheckoutReturn() {
    const params = new URLSearchParams(location.search);
    const state = params.get("checkout");
    if (!state) return;
    history.replaceState({}, "", location.pathname);
    if (state === "cancel") { toast("Pago cancelado", "", "info"); return; }
    toast("Confirmando tu suscripción…", "", "info");
    // El webhook puede tardar un par de segundos; reintenta leyendo el perfil.
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const fresh = await window.msfAuth.getSessionProfile();
      if (fresh?.profile) {
        PROFILE = fresh.profile;
        applyPlanGating();
        if (PROFILE.subscription_status === "active") { toast("¡Suscripción activa! 🎉", `Plan ${PROFILE.plan}`, "ok"); return; }
      }
    }
    toast("Pago recibido. Si el plan no cambió, recarga en un momento.", "", "info");
  }

  /* ---------- Referidos ---------- */
  async function renderReferrals() {
    try {
      const info = await api.getReferralInfo(PROFILE.id);
      $("#refCodeDisplay") && ($("#refCodeDisplay").textContent = info.code || "—");
      $("#refCount") && ($("#refCount").textContent = info.referrals.length);
      const list = $("#refList");
      if (list && info.referrals.length) {
        list.innerHTML = info.referrals.map((r) => `
          <div class="due-row">
            <div class="avatar avatar--sm">${api.initials(r.referred?.full_name)}</div>
            <div class="due-row__meta"><div class="due-row__name">${api.esc(r.referred?.full_name || "Coach")}</div><div class="due-row__sub">${api.esc(r.referred?.email || "")}</div></div>
            <span class="t3 text-sm">${new Date(r.created_at).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}</span>
          </div>`).join("");
      }
    } catch (ex) { errToast(ex, "No se pudieron cargar los referidos"); }
  }
  $("#btnCopyRefCode")?.addEventListener("click", async () => {
    const code = $("#refCodeDisplay")?.textContent.trim();
    if (!code || code === "—") return;
    try { await navigator.clipboard.writeText(code); toast("Código copiado", code, "ok"); }
    catch { toast(code, "Cópialo manualmente", "info"); }
  });

  /* ---------- Asistencia confirmada (lista del ciclo actual) ----------
     Muestra los alumnos que confirmaron asistencia. La lista persiste entre
     días hasta que el coach pulsa "Reiniciar Día". */
  async function renderAttendanceToday() {
    const wrap = $("#attendanceToday");
    if (!wrap) return;
    try {
      const rows = await api.listCoachAttendance();
      if (!rows.length) {
        wrap.innerHTML = `<p class="t3 text-sm">Aún nadie ha confirmado asistencia. Cuando tus alumnos confirmen, aparecerán aquí.</p>`;
        $("#attendanceSummary") && ($("#attendanceSummary").textContent = "");
        return;
      }
      $("#attendanceSummary") && ($("#attendanceSummary").textContent = `${rows.length} confirmado${rows.length === 1 ? "" : "s"}`);
      wrap.innerHTML = rows.map((r) => {
        const s = r.students || {};
        const day = new Date(r.attend_date + "T00:00:00").toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });
        return `<div class="due-row">
          <div class="avatar avatar--sm">${api.initials(s.full_name)}</div>
          <div class="due-row__meta"><div class="due-row__name">${api.esc(s.full_name || "Alumno")}</div><div class="due-row__sub">Confirmó para ${api.esc(day)}</div></div>
          <span class="badge badge--ok">Va</span>
        </div>`;
      }).join("");
    } catch (ex) { wrap.innerHTML = `<p class="t3 text-sm">No se pudo cargar la asistencia.</p>`; }
  }
  $("#btnResetAttendance")?.addEventListener("click", async () => {
    const btn = $("#btnResetAttendance"); btn.disabled = true;
    try {
      await api.resetAttendanceDay();
      await renderAttendanceToday();
      toast("Día reiniciado", "La lista quedó limpia para el siguiente día", "ok");
    } catch (ex) { errToast(ex, "No se pudo reiniciar el día"); }
    finally { btn.disabled = false; }
  });

  /* ---------- Refrescos ---------- */
  async function refreshPayments() { PAYMENTS = await api.listPayments(PROFILE.id); renderPayments(); renderDueList(); renderNotifications(); }

  /* ---------- Realtime (mensajes, pagos, seguimientos) ---------- */
  function subscribeRealtime() {
    if (!window.msfSupabase || !PROFILE) return;
    window.msfSupabase
      .channel("coach-" + PROFILE.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `coach_id=eq.${PROFILE.id}` }, (payload) => {
        const m = payload.new;
        if (m.sender_id === PROFILE.id) return; // fue enviado por el propio coach
        if ($("#view-mensajes").classList.contains("is-active") && activeConversationId === m.student_id) {
          selectConversation(m.student_id);
        } else {
          const s = STUDENTS.find((x) => x.id === m.student_id);
          toast("Nuevo mensaje", s ? s.full_name : "", "info");
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "payments", filter: `coach_id=eq.${PROFILE.id}` }, () => {
        refreshPayments(); renderStudents(); updateKpis();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "follow_ups", filter: `coach_id=eq.${PROFILE.id}` }, async () => {
        FOLLOW_UPS = await api.listFollowUps(PROFILE.id); renderFollowUps(); renderNotifications();
      })
      .subscribe();
  }

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
    // Enlace de invitación permanente del coach (login?coach=<id>)
    const inviteUrl = `${location.origin}/login?coach=${PROFILE.id}`;
    $("#inviteLinkDisplay") && ($("#inviteLinkDisplay").textContent = inviteUrl);
    const copyInvite = async () => {
      try { await navigator.clipboard.writeText(inviteUrl); toast("Enlace copiado", "Compártelo con tus alumnos", "ok"); }
      catch { toast("Cópialo manualmente", inviteUrl, "info"); }
    };
    $("#btnCopyInvite")?.addEventListener("click", copyInvite);
    $("#btnCopyInvite2")?.addEventListener("click", copyInvite);

    try {
      [STUDENTS, PAYMENTS, FOLLOW_UPS] = await Promise.all([
        api.listStudents(PROFILE.id),
        api.listPayments(PROFILE.id),
        api.listFollowUps(PROFILE.id),
      ]);
    } catch (ex) { errToast(ex, "No se pudieron cargar los datos"); }

    applyPlanGating();
    renderStudents();
    renderPayments();
    renderDueList();
    renderFollowUps();
    updateKpis();
    runCountUp();
    initChartTooltips();
    renderNotifications();
    fillRoutineSelect();
    renderAccentSwatches();
    renderAttendanceToday();
    subscribeRealtime();
    handleCheckoutReturn();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
