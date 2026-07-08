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
  let studentFilter = { text: "", type: "all", state: "all", groupBy: false, goalText: "" };

  // Estados de PAGOS (ok/pend/late) — no confundir con estados del alumno
  const badgeClass = { ok: "badge--ok", pend: "badge--pend", late: "badge--late" };
  const stateLabel = { ok: "Activa", pend: "Pendiente", late: "Atrasada" };
  // Estado visible del alumno. Base de actividad calculada en la BD
  // (display_state en students_with_state: activo/suspendido/sin_iniciar_sesion)
  // y encima el estado por vencimiento de pago (ver studentState).
  const S_BADGE = { activo: "badge--ok", por_vencer: "badge--pend", ultimo_dia: "badge--late", suspendido: "badge--late", sin_iniciar_sesion: "badge--indigo" };
  const S_LABEL = { activo: "Activo", por_vencer: "Próximo a vencer", ultimo_dia: "Último día", suspendido: "Suspendido", sin_iniciar_sesion: "Sin iniciar sesión" };
  const sBadge = (st) => S_BADGE[st] || "badge--pend";
  const sLabel = (st) => S_LABEL[st] || "Sin iniciar sesión";
  // #9 Estado automático por vencimiento del pago pendiente más próximo,
  // reconciliado con el estado de actividad. Si nunca inició sesión, esa señal
  // manda (sin_iniciar_sesion); si no, se deriva de los días al vencimiento:
  //   sin pago pendiente o faltan >7 días -> activo
  //   faltan 2-7 días  -> Próximo a vencer
  //   falta 0-1 día    -> Último día
  //   vencido          -> Suspendido
  function studentState(s) {
    if (s.display_state === "sin_iniciar_sesion") return "sin_iniciar_sesion";
    const now = new Date(new Date().toDateString());
    const pend = PAYMENTS
      .filter((p) => p.student_id === s.id && p.state !== "ok")
      .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))[0];
    if (!pend) return "activo";
    const days = Math.ceil((new Date(pend.due_date) - now) / 86400000);
    if (days < 0) return "suspendido";
    if (days <= 1) return "ultimo_dia";
    if (days <= 7) return "por_vencer";
    return "activo";
  }

  /* Máscara de moneda MXN en vivo: agrega comas de miles mientras se
     escribe y limita a 2 decimales tras un punto. Las comas que el usuario
     escriba se ignoran (las pone el formateador solo) para no chocar con el
     separador decimal; texto pegado se re-parsea con parseMoneyMXN. */
  function attachMoneyInput(el) {
    if (!el) return;
    el.setAttribute("inputmode", "decimal");
    function reformat() {
      const distFromEnd = el.value.length - el.selectionStart;
      const raw = el.value.replace(/[^\d.]/g, "");
      const dotIdx = raw.indexOf(".");
      let intDigits = dotIdx === -1 ? raw : raw.slice(0, dotIdx);
      const decDigits = dotIdx === -1 ? null : raw.slice(dotIdx + 1).replace(/\./g, "").slice(0, 2);
      intDigits = intDigits.replace(/^0+(?=\d)/, "");
      const intFormatted = intDigits ? Number(intDigits).toLocaleString("es-MX") : "";
      el.value = decDigits !== null ? `${intFormatted}.${decDigits}` : intFormatted;
      const pos = Math.max(0, el.value.length - distFromEnd);
      el.setSelectionRange(pos, pos);
    }
    el.addEventListener("input", reformat);
    el.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text");
      const n = api.parseMoneyMXN(text);
      el.value = n != null ? api.formatMoneyMXN(n) : "";
    });
  }

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
  /* Vistas que dependen del plan del coach (sistema central de permisos) */
  const VIEW_FEATURE = { rutinas: "routines", comunidad: "community", mensajes: "messages" };
  const FEATURE_NAME = {
    routines: "El constructor de rutinas personalizadas",
    community: "La comunidad para tus alumnos",
    messages: "La mensajería con tus alumnos",
    objectives: "El catálogo de objetivos y su seguimiento",
    photos: "La subida de fotos de progreso",
  };
  /* Qué plan desbloquea cada capability, con sus beneficios y precio real (Stripe live). */
  const FEATURE_PLAN_META = {
    messages: { plan: "Star", price: "$500 MXN/mes", benefits: ["Chat directo con tus alumnos", "Objetivos personalizados", "Fotos de progreso"] },
    objectives: { plan: "Star", price: "$500 MXN/mes", benefits: ["Objetivos personalizados ilimitados", "Seguimiento con progreso", "Mensajería incluida"] },
    photos: { plan: "Star", price: "$500 MXN/mes", benefits: ["Fotos de progreso de tus alumnos", "Comparativa de evolución", "Mensajería incluida"] },
    community: { plan: "Star Plus", price: "$1,000 MXN/mes", benefits: ["Muro de comunidad para tus alumnos", "Constructor de rutinas", "Todo lo de Star"] },
    routines: { plan: "Star Plus", price: "$1,000 MXN/mes", benefits: ["Constructor de rutinas personalizadas", "Comunidad para tus alumnos", "Todo lo de Star"] },
  };
  function viewLocked(view) {
    const feat = VIEW_FEATURE[view];
    return feat && FEATURES && !FEATURES[feat];
  }
  function showUpsell(feat) {
    const meta = FEATURE_PLAN_META[feat] || { plan: "Star", price: "", benefits: [] };
    // Planes en construcción (Star Plus/Kings): se muestra el beneficio pero sin
    // opción de compra — CTA deshabilitado con aviso de "muy pronto".
    const blocked = window.msfCheckout?.isPlanBlocked?.(meta.plan);
    $("#upsellTitle") && ($("#upsellTitle").textContent = blocked ? "Muy pronto 🚧" : `Disponible en Plan ${meta.plan}`);
    $("#upsellText") && ($("#upsellText").textContent = blocked
      ? `${FEATURE_NAME[feat] || "Esta función"} llegará con el Plan ${meta.plan}, que estamos mejorando. Muy pronto estará disponible.`
      : `${FEATURE_NAME[feat] || "Esta función"} está incluida a partir del Plan ${meta.plan}.`);
    const benefitsEl = $("#upsellBenefits");
    if (benefitsEl) benefitsEl.innerHTML = meta.benefits.slice(0, 3).map((b) => `<li>${api.esc(b)}</li>`).join("");
    $("#upsellPrice") && ($("#upsellPrice").textContent = blocked ? "" : meta.price);
    const cta = $("#upsellCta");
    if (cta) {
      cta.disabled = !!blocked;
      cta.textContent = blocked ? "En construcción" : (meta.plan === "Star Plus" ? "Mejorar a Star Plus" : "Actualizar a Star");
      cta.onclick = blocked ? null : () => { $("#modal-upsell")?.classList.remove("is-open"); startCheckout(meta.plan); };
    }
    $("#modal-upsell")?.classList.add("is-open");
  }
  function goTo(view) {
    if (viewLocked(view)) {
      showUpsell(VIEW_FEATURE[view]);
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
    if (view === "ajustes") loadInvoices();
  }
  document.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]");
    if (nav) { window.msfSound?.playSound?.("click"); goTo(nav.dataset.nav); }
  });

  $("#menuToggle")?.addEventListener("click", () => { window.msfSound?.playSound?.("click"); $("#sidebar").classList.toggle("is-open"); });
  $("#sidebarClose")?.addEventListener("click", () => { window.msfSound?.playSound?.("click"); $("#sidebar").classList.remove("is-open"); });
  // Cierra el menú al tocar fuera de él (fuera del sidebar y del botón que lo abre).
  document.addEventListener("click", (e) => {
    const sidebar = $("#sidebar");
    if (!sidebar?.classList.contains("is-open")) return;
    if (sidebar.contains(e.target) || e.target.closest("#menuToggle")) return;
    sidebar.classList.remove("is-open");
  });

  function toggleTheme() {
    const mode = window.msfTheme.toggleMode();
    toast(mode === "light" ? "Modo claro activado" : "Modo oscuro activado", "", "info");
  }
  $("#themeToggle")?.addEventListener("click", toggleTheme);
  $("#themeToggle2")?.addEventListener("click", toggleTheme);
  // #12 Persiste tema/acento en la cuenta cada vez que el usuario los cambia.
  window.msfTheme?.subscribe?.((mode, accent) => { api.saveThemePrefs({ mode, accent }).catch(() => {}); });

  /* ---------- #11 Foto / logo del coach ---------- */
  // Pinta la imagen (o las iniciales) en las tres superficies del avatar del
  // coach: tarjeta del sidebar, avatar de la topbar y la vista previa de Ajustes.
  function avatarImgHtml(url) {
    return `<img src="${api.esc(url)}" alt="Foto del coach" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`;
  }
  function applyCoachAvatar(url) {
    const targets = $$(".avatar.avatar--ring, .coach-card .avatar, #coachAvatarPreview");
    targets.forEach((el) => {
      if (url) el.innerHTML = avatarImgHtml(url);
      else if (PROFILE) el.textContent = api.initials(PROFILE.full_name);
    });
  }
  $("#coachAvatarBtn")?.addEventListener("click", () => $("#coachAvatarInput")?.click());
  $("#coachAvatarInput")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast("Archivo no válido", "Elige una imagen.", "err"); return; }
    if (file.size > 5 * 1024 * 1024) { toast("Imagen muy pesada", "Máximo 5 MB.", "err"); return; }
    const hint = $("#coachAvatarHint");
    if (hint) hint.textContent = "Subiendo…";
    try {
      const url = await api.uploadCoachAvatar(file);
      PROFILE.avatar_url = url;
      applyCoachAvatar(url);
      if (hint) hint.textContent = "Imagen actualizada ✓";
      toast("Foto actualizada", "Tus alumnos ya la verán", "ok");
    } catch (ex) {
      if (hint) hint.textContent = "No se pudo subir la imagen.";
      errToast(ex, "No se pudo subir la imagen");
    } finally { e.target.value = ""; }
  });

  /* ---------- Sonidos de interfaz ---------- */
  const soundToggleCoach = $("#soundToggleCoach");
  if (soundToggleCoach && window.msfSound) {
    soundToggleCoach.checked = window.msfSound.isEnabled();
    soundToggleCoach.addEventListener("change", (e) => {
      window.msfSound.setEnabled(e.target.checked);
      if (e.target.checked) window.msfSound.playSound("click");
    });
  }

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
      if (studentFilter.state !== "all") {
        const st = studentState(s);
        // "Por vencer" agrupa Próximo a vencer + Último día.
        if (studentFilter.state === "por_vencer") { if (st !== "por_vencer" && st !== "ultimo_dia") return false; }
        else if (st !== studentFilter.state) return false;
      }
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
  function studentCardHtml(s) {
    const due = dueLabel(s);
    return `
      <div class="card card--hover student-card" data-student="${s.id}" style="cursor:pointer">
        <div class="student-card__head"><div class="avatar avatar--md">${s.initials}</div><div><div class="student-card__name">${api.esc(s.full_name)}</div><div class="student-card__sub">${s.age ? s.age + " años · " : ""}${api.esc(s.training_type)}</div></div></div>
        <div style="margin-bottom:12px"><span class="badge ${sBadge(studentState(s))}">${sLabel(studentState(s))}</span></div>
        <div class="student-card__rows">
          <div class="kv"><span>Objetivo</span><span>${api.esc(s.goal || "—")}</span></div>
          <div class="kv"><span>Próximo pago</span><span style="color:var(--${due.tone === "t3" ? "text-2" : due.tone})">${due.text}</span></div>
        </div>
        <div class="student-card__foot"><button class="btn btn--ghost btn--sm js-msg-student" data-student="${s.id}" style="flex:1">Mensaje</button><button class="btn btn--primary btn--sm js-open-student" style="flex:1">Ver ficha</button></div>
      </div>`;
  }
  // Vista agrupada por objetivo: cambia SOLO la visualización dentro del filtro
  // "Objetivo". Agrupa a los alumnos por su objetivo, con buscador por nombre.
  function renderStudentsByGoal() {
    const wrap = $("#studentsByGoal");
    if (!wrap) return;
    const q = (studentFilter.goalText || "").trim().toLowerCase();
    const groups = {};
    filteredStudents().forEach((s) => {
      const goal = (s.goal || "").trim() || "Sin objetivo";
      if (q && !goal.toLowerCase().includes(q)) return;
      (groups[goal] = groups[goal] || []).push(s);
    });
    const names = Object.keys(groups).sort((a, b) => a.localeCompare(b, "es"));
    wrap.innerHTML = names.map((g) => `
      <div class="obj-group">
        <div class="section-title text-sm" style="margin:16px 0 8px">${api.esc(g)} <span class="t3">· ${groups[g].length}</span></div>
        <div class="grid-cards">${groups[g].map(studentCardHtml).join("")}</div>
      </div>`).join("") || `<p class="t3 text-sm" style="padding:20px;text-align:center">Sin alumnos que coincidan.</p>`;
  }
  function renderStudents() {
    // Modo agrupado por objetivo: oculta tabla/tarjetas normales y el toggle.
    const byGoal = $("#studentsByGoal");
    const grouped = studentFilter.groupBy;
    $("#studentsTable")?.classList.toggle("hidden", grouped);
    $("#studentsCards")?.classList.toggle("hidden", grouped);
    $("#viewToggle")?.classList.toggle("hidden", grouped);
    byGoal?.classList.toggle("hidden", !grouped);
    $("#objSearch")?.classList.toggle("hidden", !grouped);
    if (grouped) { renderStudentsByGoal(); return; }
    const list = filteredStudents();
    const tbody = $("#studentsTbody");
    const cards = $("#studentsCards");
    if (tbody) tbody.innerHTML = list.map((s) => {
      const due = dueLabel(s);
      return `
      <tr data-student="${s.id}" style="cursor:pointer">
        <td><div class="cell-user"><div class="avatar avatar--sm">${s.initials}</div><div><div class="cell-user__name">${api.esc(s.full_name)}</div><div class="cell-user__sub">${s.age ? s.age + " años" : "—"}</div></div></div></td>
        <td><span class="badge ${sBadge(studentState(s))}">${sLabel(studentState(s))}</span></td>
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
        <div style="margin-bottom:12px"><span class="badge ${sBadge(studentState(s))}">${sLabel(studentState(s))}</span></div>
        <div class="student-card__rows">
          <div class="kv"><span>Objetivo</span><span>${api.esc(s.goal || "—")}</span></div>
          <div class="kv"><span>Próximo pago</span><span style="color:var(--${due.tone === "t3" ? "text-2" : due.tone})">${due.text}</span></div>
        </div>
        <div class="student-card__foot"><button class="btn btn--ghost btn--sm js-msg-student" data-student="${s.id}" style="flex:1">Mensaje</button><button class="btn btn--primary btn--sm js-open-student" style="flex:1">Ver ficha</button></div>
      </div>`;
    }).join("");

    const headP = $("#view-alumnos .page-head p");
    if (headP) {
      const active = STUDENTS.filter((s) => !["suspendido", "sin_iniciar_sesion"].includes(studentState(s))).length;
      const pend = new Set(PAYMENTS.filter((p) => p.state !== "ok").map((p) => p.student_id)).size;
      headP.textContent = `${active} activos · ${pend} pendientes de pago · ${STUDENTS.length} total`;
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
        <td><span class="badge ${badgeClass[p.state]}">${p.state === "ok" ? "Pagado" : stateLabel[p.state]}</span>${p.notes ? ` <span class="t3" title="${api.esc(p.notes)}">📝</span>` : ""}</td>
        <td class="cell-actions">
          ${p.state === "ok" ? "" : '<button class="btn btn--lime btn--sm js-mark-paid" data-payment="' + p.id + '">Cobrar</button>'}
          <button class="icon-btn js-edit-payment" data-payment="${p.id}" style="width:32px;height:32px" title="Editar pago"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
        </td>
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
    // Las tareas completadas salen de la lista activa (quedan en la BD como historial).
    wrap.innerHTML = FOLLOW_UPS.filter((f) => !f.is_done).map((f) => `
      <div class="alert-item" data-followup="${f.id}">
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
  $$("#view-alumnos .row.gap-2.wrap.mb-4 .pill").forEach((pill, idx, arr) => {
    pill.addEventListener("click", () => {
      arr.forEach((p) => p.classList.remove("is-active"));
      pill.classList.add("is-active");
      const txt = pill.textContent.trim();
      studentFilter.groupBy = txt.includes("Objetivo");
      const map = { "Todos": ["all", "all"], "Online": ["Online", "all"], "Presencial": ["Presencial", "all"], "Activos": ["all", "activo"], "Sin iniciar sesión": ["all", "sin_iniciar_sesion"], "Por vencer": ["all", "por_vencer"], "Suspendidos": ["all", "suspendido"] };
      const key = Object.keys(map).find((k) => txt.includes(k)) || "Todos";
      studentFilter.type = map[key][0];
      studentFilter.state = map[key][1];
      renderStudents();
    });
  });

  $("#objSearch")?.addEventListener("input", (e) => {
    studentFilter.goalText = e.target.value;
    renderStudentsByGoal();
  });

  /* ---------- Drawer ficha alumno ---------- */
  // Pestañas de la ficha que requieren plan de pago (en Free solo Info/Pagos/Notas)
  const TAB_FEATURE = { rutina: "routines", progreso: "routines" };
  const drawer = $("#studentDrawer");
  const overlay = $("#drawerOverlay");
  async function openDrawer(id) {
    const s = STUDENTS.find((x) => x.id === id);
    if (!s) return;
    CURRENT_STUDENT_ID = id;
    $("#dwAvatar").textContent = s.initials;
    $("#dwName").textContent = s.full_name;
    const st = $("#dwState");
    st.className = "badge " + sBadge(studentState(s));
    st.textContent = sLabel(studentState(s));
    $("#dwAgeBadge") && ($("#dwAgeBadge").textContent = s.age ? s.age + " años" : "Edad —");
    $("#dwAge") && ($("#dwAge").textContent = s.age ?? "—");
    $("#dwSex") && ($("#dwSex").textContent = s.sex || "—");
    $("#dwGoal") && ($("#dwGoal").textContent = s.goal || "—");
    $("#dwType") && ($("#dwType").textContent = s.training_type);
    $("#dwWeight") && ($("#dwWeight").textContent = s.weight_current ?? "—");
    $("#dwHeight") && ($("#dwHeight").textContent = s.height ?? "—");
    $("#dwEmail") && ($("#dwEmail").textContent = s.email || "—");
    $("#dwPhone") && ($("#dwPhone").textContent = s.phone || "—");
    $("#dwSince") && ($("#dwSince").textContent = s.member_since ? new Date(s.member_since).toLocaleDateString("es-MX", { month: "long", year: "numeric" }) : "—");
    const dwMem = $("#dwMembership");
    if (dwMem) {
      if (s.membership_end) {
        const days = Math.ceil((new Date(s.membership_end) - new Date()) / 86400000);
        const fecha = new Date(s.membership_end).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
        dwMem.textContent = days < 0 ? `Vencida (${fecha})` : days <= 5 ? `Vence ${fecha} · ${days}d` : `Activa hasta ${fecha}`;
        dwMem.style.color = days < 0 ? "var(--coral)" : days <= 5 ? "var(--amber, #f0a020)" : "var(--lime)";
      } else { dwMem.textContent = "Sin fecha de renovación"; dwMem.style.color = ""; }
    }
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
    loadDrawerObjectives(id);
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
  async function openStudentEditor(id) {
    const s = STUDENTS.find((x) => x.id === id);
    if (!s) return;
    EDIT_STUDENT_ID = id;
    $("#nsName").value = s.full_name || "";
    $("#nsPhone").value = s.phone || "";
    $("#nsType").value = s.training_type || "Online";
    await fillGoalSelect($("#nsGoal"), s.goal);
    $("#nsWeight").value = s.weight_current ?? "";
    $("#nsWeightGoal").value = s.weight_goal ?? "";
    $("#nsStart").value = s.member_since || "";
    $("#nsEnd").value = s.membership_end || "";
    $("#nsNotes").value = s.private_notes || "";
    setStudentModalMode(true);
    $("#modal-newStudent").classList.add("is-open");
  }
  attachMoneyInput($("#nsAmount"));
  attachMoneyInput($("#npAmount"));
  $("#btnEditStudent")?.addEventListener("click", async () => { if (CURRENT_STUDENT_ID) await openStudentEditor(CURRENT_STUDENT_ID); });
  $("#btnDeleteStudent")?.addEventListener("click", () => {
    if (!CURRENT_STUDENT_ID) return;
    window.msfSound?.playSound?.("click");
    $("#modal-deleteStudent")?.classList.add("is-open");
  });
  $("#btnConfirmDeleteStudent")?.addEventListener("click", async () => {
    if (!CURRENT_STUDENT_ID) return;
    const btn = $("#btnConfirmDeleteStudent");
    btn.disabled = true;
    try {
      const id = CURRENT_STUDENT_ID;
      const student = STUDENTS.find((x) => x.id === id);
      await api.deleteStudent(id);
      STUDENTS = STUDENTS.filter((x) => x.id !== id);
      renderStudents();
      closeDrawer();
      $$(".modal-overlay").forEach((m) => m.classList.remove("is-open"));
      toast("Alumno eliminado", student?.full_name || "", "ok");
      window.msfSound?.playSound?.("delete");
    } catch (ex) { errToast(ex, "No se pudo eliminar al alumno"); }
    finally { btn.disabled = false; }
  });
  function closeDrawer() {
    drawer.classList.remove("is-open");
    overlay.classList.remove("is-open");
    document.body.style.overflow = "";
  }
  $("#drawerClose")?.addEventListener("click", closeDrawer);
  overlay?.addEventListener("click", closeDrawer);
  document.addEventListener("click", (e) => {
    const row = e.target.closest("[data-student]");
    // La ficha SOLO se abre desde la lista de alumnos o su botón dedicado;
    // nunca desde una conversación de Mensajes.
    if (row && !row.classList.contains("js-msg-student") && !row.closest(".js-conversation") && !row.closest("#view-mensajes")) {
      openDrawer(row.dataset.student);
    }
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
    if (t.dataset.locked === "1") {
      showUpsell(TAB_FEATURE[t.dataset.tab]);
      return;
    }
    window.msfSound?.playSound?.("click");
    $$("#dwTabs .tab").forEach((x) => x.classList.remove("is-active"));
    t.classList.add("is-active");
    $$(".drawer__body .tab-panel").forEach((p) => p.classList.toggle("is-active", p.dataset.panel === t.dataset.tab));
  });

  /* ---------- Modales ---------- */
  document.addEventListener("click", async (e) => {
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
        await fillGoalSelect($("#nsGoal"));
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
        window.msfSound?.playSound?.("save");
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
        payment_amount: api.parseMoneyMXN($("#nsAmount").value),
        pay_state: $("#nsPayState").value,
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
      window.msfSound?.playSound?.("save");
      applyPlanGating();
    } catch (ex) {
      if (ex._planLimit) {
        $$(".modal-overlay").forEach((m) => m.classList.remove("is-open"));
        $("#limitText") && ($("#limitText").textContent = ex.message);
        $("#modal-limit")?.classList.add("is-open");
      }
      else if (ex._authOnly) errToast(ex, "No se pudo crear la cuenta de acceso (¿correo ya usado?)");
      else errToast(ex, "No se pudo crear el alumno");
    } finally { btn.disabled = false; btn.textContent = btnLabel; }
  });

  /* ---------- Registrar pago (persistido) ---------- */
  $("#formNewPayment")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const studentId = $("#npStudent").value;
    const amount = api.parseMoneyMXN($("#npAmount").value);
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

  /* ---------- Editar pago individual (#8) ---------- */
  attachMoneyInput($("#epAmount"));
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".js-edit-payment");
    if (!btn) return;
    e.stopPropagation();
    const p = PAYMENTS.find((x) => x.id === btn.dataset.payment);
    if (!p) return;
    $("#epId").value = p.id;
    $("#epConcept").value = p.concept || "";
    $("#epAmount").value = api.formatMoneyMXN(Number(p.amount) || 0);
    $("#epDue").value = p.due_date || "";
    $("#epState").value = p.state === "ok" ? "ok" : "pend";
    $("#epNotes").value = p.notes || "";
    $("#modal-editPayment")?.classList.add("is-open");
  });
  $("#formEditPayment")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("#epId").value;
    const amount = api.parseMoneyMXN($("#epAmount").value);
    if (!id || !amount) return;
    try {
      await api.updatePayment(id, {
        concept: $("#epConcept").value.trim() || "Membresía",
        amount,
        due_date: $("#epDue").value,
        state: $("#epState").value,
        notes: $("#epNotes").value.trim() || null,
      });
      await refreshPayments();
      renderStudents();
      updateKpis();
      $$(".modal-overlay").forEach((m) => m.classList.remove("is-open"));
      toast("Pago actualizado", "Los cambios se aplicaron correctamente", "ok");
    } catch (ex) { errToast(ex, "No se pudo actualizar el pago"); }
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
  // Objetivo del alta manual: mismo catálogo que verá el alumno en su onboarding
  // (5 de sistema + personalizados del coach si es Star+), para que la
  // preselección funcione por coincidencia exacta de título.
  async function fillGoalSelect(selectEl, selectedTitle) {
    if (!selectEl) return;
    try {
      const catalog = await api.listCatalogAndCustom(PROFILE.id);
      selectEl.innerHTML = catalog.map((o) => `<option value="${api.esc(o.title)}">${api.esc(o.title)}</option>`).join("");
      if (selectedTitle && catalog.some((o) => o.title === selectedTitle)) selectEl.value = selectedTitle;
    } catch (ex) { console.error("No se pudo cargar el catálogo de objetivos:", ex); }
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
      // Al completarla desaparece de la lista activa (pequeña pausa para ver el check).
      if (nowDone) setTimeout(renderFollowUps, 260);
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
        phone: $("#profPhone").value.trim(),
        location: $("#profLocation").value.trim(),
        years_experience: $("#profYears").value || null,
        current_students_count: $("#profStudentCount").value ? parseInt($("#profStudentCount").value, 10) : null,
        business_goal: $("#profBusinessGoal").value || null,
        specialty: $("#profSpecialty").value.trim(),
        bio: $("#profBio").value.trim(),
      }).eq("id", PROFILE.id);
      toast("Cambios guardados", "Todo quedó actualizado", "ok");
    } catch (ex) { errToast(ex, "No se pudo guardar el perfil"); }
  });

  $("#btnLogout")?.addEventListener("click", () => window.msfAuth.signOut());
  $("#btnConfirmDelete")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const { data: { session } } = await window.msfSupabase.auth.getSession();
      const r = await fetch("/api/delete-account", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: session?.access_token }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "No se pudo eliminar la cuenta");
      await window.msfSupabase.auth.signOut();
      sessionStorage.setItem("msf_account_deleted", "1");
      window.location.href = "login.html";
    } catch (ex) { btn.disabled = false; errToast(ex, "No se pudo eliminar la cuenta"); }
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
    wrap.addEventListener("mousemove", (e) => {
      // Lee los valores en vivo del dataset: el gráfico de ingresos cambia de
      // serie al elegir otro periodo, así que el tooltip debe reflejarlo.
      const live = wrap.dataset.chartValues ? wrap.dataset.chartValues.split(",").map(Number) : values;
      if (!live.length) return;
      const min = Math.min(...live), max = Math.max(...live);
      const rect = wrap.getBoundingClientRect();
      const pct = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
      const idx = Math.round(pct * (live.length - 1));
      const val = live[idx];
      const xPct = live.length > 1 ? (idx / (live.length - 1)) * 100 : 50;
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
      board.innerHTML = days.map((d) => {
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
        const comments = (p.community_comments || []).slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        const commentsHtml = comments.map((c) => `<div class="row gap-3 mb-2"><div class="avatar avatar--sm">${api.initials(c.profiles?.full_name)}</div><div><div class="fw-600 text-sm">${api.esc(c.profiles?.full_name || "Alumno")}</div><div class="t3 text-sm">${api.esc(c.body)}</div></div></div>`).join("") || `<p class="t3 text-sm mb-2">Sin comentarios aún.</p>`;
        return `<div class="card mb-4" data-post="${p.id}">
          <div class="row gap-3 mb-4"><div class="avatar avatar--md">${api.initials(p.profiles?.full_name)}</div><div><div class="fw-600">${api.esc(p.profiles?.full_name || "Coach")}</div><div class="t3 text-sm">${new Date(p.created_at).toLocaleString("es-MX")}</div></div></div>
          <p style="margin-bottom:12px">${api.esc(p.body)}</p>
          <div class="row gap-4 mt-4">
            <button class="pill js-like ${liked ? "is-active" : ""}" data-post="${p.id}" data-liked="${liked}">❤ ${p.community_likes.length}</button>
            <button class="pill js-comments-toggle" data-post="${p.id}">💬 ${comments.length} comentarios</button>
          </div>
          <div class="js-comments hidden" data-post="${p.id}" style="margin-top:14px;border-top:1px solid var(--border);padding-top:14px">
            ${commentsHtml}
            <form class="js-comment-form row gap-3 mt-4" data-post="${p.id}"><input class="input js-comment-input" placeholder="Escribe un comentario…" style="flex:1" maxlength="500"><button class="btn btn--primary btn--sm" type="submit">Enviar</button></form>
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
    if (likeBtn) {
      const liked = likeBtn.dataset.liked === "true";
      try { await api.toggleLike(likeBtn.dataset.post, PROFILE.id, liked); renderCommunity(); }
      catch (ex) { errToast(ex, "No se pudo procesar el like"); }
      return;
    }
    const toggle = e.target.closest(".js-comments-toggle");
    if (toggle) {
      const box = document.querySelector(`.js-comments[data-post="${toggle.dataset.post}"]`);
      box?.classList.toggle("hidden");
      if (box && !box.classList.contains("hidden")) box.querySelector(".js-comment-input")?.focus();
    }
  });
  document.addEventListener("submit", async (e) => {
    const form = e.target.closest(".js-comment-form");
    if (!form || !PROFILE) return;
    e.preventDefault();
    const input = form.querySelector(".js-comment-input");
    const body = input.value.trim();
    if (!body) return;
    input.disabled = true;
    try { await api.addComment(form.dataset.post, PROFILE.id, body); input.value = ""; renderCommunity(); }
    catch (ex) { errToast(ex, "No se pudo enviar el comentario"); }
    finally { input.disabled = false; }
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
  // La ficha del alumno en Mensajes SOLO se abre con este botón dedicado.
  $("#btnThreadProfile")?.addEventListener("click", () => {
    if (activeConversationId) openDrawer(activeConversationId);
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

  /* ---------- Notificaciones (derivadas de datos reales + tabla notifications) ---------- */
  const NOTIF_READ_KEY = "msf_notif_read";
  let DB_NOTIFICATIONS = [];
  async function loadNotifications() {
    try { DB_NOTIFICATIONS = await api.listNotifications(PROFILE.id); renderNotifications(); }
    catch (ex) { console.error("No se pudieron cargar las notificaciones:", ex); }
  }
  function readNotifIds() { try { return new Set(JSON.parse(localStorage.getItem(NOTIF_READ_KEY) || "[]")); } catch { return new Set(); } }
  function buildNotifications() {
    const items = [];
    DB_NOTIFICATIONS.forEach((n) => {
      items.push({
        id: "db-" + n.id,
        dbId: n.id,
        dbRead: n.read,
        tone: "indigo",
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/></svg>',
        text: n.message,
        sub: new Date(n.created_at).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
        nav: "alumnos",
      });
    });
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
    const isUnread = (i) => (i.dbId ? !i.dbRead : !read.has(i.id));
    const unread = items.filter(isUnread).length;
    if (dot) { dot.textContent = unread; dot.classList.toggle("hidden", unread === 0); }
    list.innerHTML = items.map((i) => `
      <button class="notif-item ${isUnread(i) ? "is-unread" : ""}" data-notif-nav="${i.nav}" data-notif-db="${i.dbId || ""}">
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
    if (n) {
      goTo(n.dataset.notifNav);
      if (n.dataset.notifDb) {
        const item = DB_NOTIFICATIONS.find((x) => x.id === n.dataset.notifDb);
        if (item) item.read = true;
        api.markNotificationRead(n.dataset.notifDb).catch(() => {});
        renderNotifications();
      }
      $("#notifPanel")?.classList.remove("is-open");
    }
  });
  $("#notifMarkAll")?.addEventListener("click", async () => {
    const ids = buildNotifications().filter((i) => !i.dbId).map((i) => i.id);
    localStorage.setItem(NOTIF_READ_KEY, JSON.stringify(ids));
    const unreadDb = DB_NOTIFICATIONS.filter((n) => !n.read);
    DB_NOTIFICATIONS.forEach((n) => (n.read = true));
    renderNotifications();
    await Promise.all(unreadDb.map((n) => api.markNotificationRead(n.id).catch(() => {})));
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
    const active = STUDENTS.filter((s) => !["suspendido", "sin_iniciar_sesion"].includes(studentState(s))).length;
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

    // Gráfico de ingresos del dashboard según el periodo seleccionado.
    renderRevenueChart();
  }

  // Periodo activo del gráfico de ingresos (default = último año, como antes).
  let revenuePeriod = "1y";
  const PERIOD_SUBTITLE = {
    today: "Cobros de hoy", yesterday: "Cobros de ayer", "7d": "Cobros · últimos 7 días",
    "3m": "Cobros · últimos 3 meses", "6m": "Cobros · últimos 6 meses", "1y": "Cobros reales · últimos 12 meses",
  };
  function renderRevenueChart() {
    const wrap = $("#revenueChartWrap");
    if (!wrap) return;
    const data = api.financeByPeriod(PAYMENTS, revenuePeriod);
    const values = data.series.map((m) => m.total);
    wrap.dataset.chartValues = values.join(",");
    const card = wrap.closest(".chart-card");
    const totalEl = card?.querySelector(".chart-total");
    if (totalEl) totalEl.textContent = money(data.total);
    const avgEl = $("#revenueAvg");
    if (avgEl) avgEl.textContent = data.count
      ? `${data.count} cobro${data.count === 1 ? "" : "s"} · promedio ${money(data.avg)}`
      : "Sin cobros en este periodo";
    const max = Math.max(...values, 1);
    const denom = values.length > 1 ? values.length - 1 : 1;
    const pts = values.map((v, i) => [Math.round(i * (640 / denom)), Math.round(200 - (v / max) * 160)]);
    const line = "M" + pts.map((p) => p.join(",")).join(" L");
    const svg = wrap.querySelector(".chart-svg");
    if (svg) {
      const paths = svg.querySelectorAll("path");
      if (paths[0]) paths[0].setAttribute("d", line + " L640,240 L0,240 Z");
      if (paths[1]) paths[1].setAttribute("d", line);
      const dot = svg.querySelector("circle.chart-dot-indigo");
      if (dot && pts.length) { dot.setAttribute("cx", pts[pts.length - 1][0]); dot.setAttribute("cy", pts[pts.length - 1][1]); }
    }
    const legend = card?.querySelector(".chart-legend span:first-child");
    if (legend) legend.innerHTML = `<i style="background:var(--indigo)"></i>Ingresos`;
    const updated = card?.querySelector(".chart-legend .t3");
    if (updated) updated.textContent = PERIOD_SUBTITLE[revenuePeriod] || "";
  }
  $("#revenuePeriods")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-period]");
    if (!b) return;
    $$("#revenuePeriods .pill").forEach((p) => p.classList.remove("is-active"));
    b.classList.add("is-active");
    revenuePeriod = b.dataset.period;
    renderRevenueChart();
  });

  /* ---------- Gating por plan (sistema central de permisos) ---------- */
  const lockSvg = '<svg viewBox="0 0 24 24" width="13" fill="none" stroke="currentColor" stroke-width="2" style="margin-left:auto;opacity:.6"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

  function applyPlanGating() {
    const plan = PROFILE.plan || "Free";
    FEATURES = api.planFeatures(plan);
    // Badge del plan en el sidebar
    const planBadge = $(".coach-card__plan .badge");
    if (planBadge) planBadge.textContent = "★ " + plan;
    // Candados en la navegación: se añaden si la feature está bloqueada y se
    // quitan si el plan la desbloquea (sincroniza también en tiempo real).
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
      // Si el coach baja de plan estando dentro de una vista bloqueada, sale de ella.
      if (!FEATURES[feat] && $("#view-" + view)?.classList.contains("is-active")) goTo("dashboard");
    });
    // Objetivos: el catálogo de 5 (sistema) siempre está disponible; solo la
    // creación de objetivos personalizados requiere Star+.
    $("#objectivesCustomWrap")?.classList.toggle("hidden", !FEATURES.objectives);
    const objLocked = $("#objectivesCustomLocked");
    if (objLocked) objLocked.style.display = FEATURES.objectives ? "none" : "block";
    // Pestañas de la ficha del alumno: en Free solo Información, Pagos y Notas
    Object.entries(TAB_FEATURE).forEach(([tab, feat]) => {
      const t = $(`#dwTabs .tab[data-tab="${tab}"]`);
      if (!t) return;
      const locked = !FEATURES[feat];
      t.dataset.locked = locked ? "1" : "0";
      t.style.opacity = locked ? ".45" : "";
      const existing = t.querySelector("svg[data-lock]");
      if (locked && !existing) {
        const tmp = document.createElement("span");
        tmp.innerHTML = lockSvg.replace('style="margin-left:auto;opacity:.6"', 'style="margin-left:5px;opacity:.6;vertical-align:-2px"');
        tmp.firstChild.dataset.lock = "1";
        t.appendChild(tmp.firstChild);
      } else if (!locked && existing) existing.remove();
      // Si la pestaña activa quedó bloqueada, vuelve a Información
      if (locked && t.classList.contains("is-active")) $('#dwTabs .tab[data-tab="info"]')?.click();
    });
    // Tarjeta del plan en Ajustes: nombre, límite y uso
    const limit = api.planLimit(plan);
    $("#planName") && ($("#planName").textContent = plan);
    const desc = plan === "Free"
      ? `Hasta ${limit} alumnos · Dashboard, alumnos, pagos, referidos y ajustes`
      : FEATURES.routines
        ? `Hasta ${limit} alumnos · Acceso total: mensajes, objetivos, fotos, rutinas y comunidad`
        : `Hasta ${limit} alumnos · Mensajes, objetivos y fotos de progreso`;
    $("#planDesc") && ($("#planDesc").textContent = desc);
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
    const plan = PROFILE.plan || "Free";
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
      bStar.textContent = plan === "Star" && active ? "Star · plan actual" : `Star · ${api.planPrice("Star")}/mes`;
      // Star Plus en construcción: botón deshabilitado con aviso (salvo que el
      // coach ya lo tuviera activo, para no romperle su plan actual).
      const plusBlocked = window.msfCheckout?.isPlanBlocked?.("Star Plus") && !(active && plan === "Star Plus");
      bPlus.disabled = plusBlocked || (active && plan === "Star Plus");
      bPlus.textContent = plusBlocked
        ? "Star Plus · En construcción 🚧"
        : (plan === "Star Plus" && active ? "Star Plus · plan actual" : `Star Plus · ${api.planPrice("Star Plus")}/mes`);
    }
    if (manage) manage.classList.toggle("hidden", !PROFILE.stripe_customer_id);
    if (hint) {
      hint.textContent = active
        ? (PROFILE.current_period_end ? `Se renueva el ${new Date(PROFILE.current_period_end).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" })}` : "")
        : "Estás en el plan Free. Elige un plan para desbloquear más alumnos y funciones premium.";
    }
    // Regalo activo (mes de prueba Star Plus ganado con puntos de referidos).
    const giftRow = $("#giftStatusRow"), giftCountdown = $("#giftCountdown"), confirmBtn = $("#btnConfirmTrialUpgrade");
    if (PROFILE.gift_plan) {
      giftRow?.classList.remove("hidden");
      const days = Math.ceil((new Date(PROFILE.gift_ends_at) - new Date()) / 86400000);
      giftCountdown?.classList.remove("hidden");
      giftCountdown && (giftCountdown.textContent = days > 0
        ? `Vuelve a ${PROFILE.pre_gift_plan || "Star"} en ${days} día${days === 1 ? "" : "s"} (${new Date(PROFILE.gift_ends_at).toLocaleDateString("es-MX")}) si no confirmas el pago.`
        : `Vuelve a ${PROFILE.pre_gift_plan || "Star"} hoy si no confirmas el pago.`);
      confirmBtn?.classList.remove("hidden");
    } else {
      giftRow?.classList.add("hidden");
      giftCountdown?.classList.add("hidden");
      confirmBtn?.classList.add("hidden");
    }
    // Cancelar membresía / reactivar.
    const cancelBtn = $("#btnCancelMembership"), cancelHint = $("#cancelHint");
    cancelBtn?.classList.toggle("hidden", !active || !PROFILE.stripe_subscription_id);
    if (PROFILE.cancel_at_period_end) {
      cancelBtn && (cancelBtn.textContent = "Reactivar membresía");
      cancelHint && (cancelHint.textContent = PROFILE.current_period_end
        ? `Tu membresía termina el ${new Date(PROFILE.current_period_end).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" })}. No se te cobrará de nuevo.`
        : "Tu membresía se cancelará al final del periodo actual.");
    } else {
      cancelBtn && (cancelBtn.textContent = "Cancelar membresía");
      cancelHint && (cancelHint.textContent = "Tu membresía seguirá activa hasta el final del periodo actual; después no se te cobrará de nuevo.");
    }
  }
  $("#btnConfirmTrialUpgrade")?.addEventListener("click", async () => {
    const btn = $("#btnConfirmTrialUpgrade");
    btn.disabled = true;
    try {
      const { data: { session } } = await window.msfSupabase.auth.getSession();
      if (!session) return toast("Sesión expirada, vuelve a entrar", "", "err");
      const r = await fetch("/api/confirm-trial-upgrade", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: session.access_token }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "No se pudo confirmar el cambio de plan");
      window.msfSound?.playSound?.("confirm");
      toast("¡Listo! Star Plus es ahora tu plan de verdad.", "", "ok");
      const fresh = await window.msfAuth.getSessionProfile();
      if (fresh?.profile) { PROFILE = fresh.profile; applyPlanGating(); }
    } catch (ex) { errToast(ex, "No se pudo confirmar el cambio de plan"); }
    finally { btn.disabled = false; }
  });
  $("#btnCancelMembership")?.addEventListener("click", async () => {
    const btn = $("#btnCancelMembership");
    const cancelling = !PROFILE.cancel_at_period_end;
    if (cancelling && !confirm("¿Seguro que quieres cancelar tu membresía? Seguirá activa hasta el final del periodo actual.")) return;
    btn.disabled = true;
    try {
      const { data: { session } } = await window.msfSupabase.auth.getSession();
      if (!session) return toast("Sesión expirada, vuelve a entrar", "", "err");
      const r = await fetch("/api/cancel-subscription", {
        method: cancelling ? "POST" : "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: session.access_token }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "No se pudo actualizar la cancelación");
      toast(cancelling ? "Membresía programada para cancelarse" : "Cancelación deshecha", "", "ok");
      const fresh = await window.msfAuth.getSessionProfile();
      if (fresh?.profile) { PROFILE = fresh.profile; applyPlanGating(); }
    } catch (ex) { errToast(ex, "No se pudo actualizar la cancelación"); }
    finally { btn.disabled = false; }
  });

  // Pago embebido: flujo compartido con select-plan.html (assets/js/checkout-shared.js).
  const startCheckout = (plan) => window.msfCheckout.startCheckout(plan);
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

  /* ---------- Facturación (historial interno, sin salir a Stripe) ---------- */
  const STATUS_LABEL_INV = { paid: "Pagada", open: "Pendiente", void: "Anulada", uncollectible: "Impagable", draft: "Borrador" };
  async function loadInvoices() {
    const wrap = $("#invoicesList");
    if (!wrap) return;
    try {
      const { data: { session } } = await window.msfSupabase.auth.getSession();
      if (!session) return;
      const r = await fetch("/api/invoices", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: session.access_token }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "No se pudo cargar tu historial");
      if (!data.invoices?.length) { wrap.innerHTML = `<p class="t3 text-sm">Aún no tienes facturas.</p>`; return; }
      wrap.innerHTML = data.invoices.map((inv) => `
        <div class="due-row">
          <div class="due-row__meta">
            <div class="due-row__name">${api.esc(inv.number || "—")}</div>
            <div class="due-row__sub">${new Date(inv.date * 1000).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })} · ${api.esc(STATUS_LABEL_INV[inv.status] || inv.status)}${inv.payment_method ? " · " + api.esc(inv.payment_method) : ""}</div>
          </div>
          <div class="row gap-3" style="align-items:center">
            <span class="mono fw-600">$${(inv.amount / 100).toLocaleString("es-MX")}</span>
            ${inv.pdf ? `<a class="btn btn--ghost btn--sm" href="${inv.pdf}" target="_blank" rel="noopener">PDF</a>` : ""}
          </div>
        </div>`).join("");
    } catch (ex) { wrap.innerHTML = `<p class="t3 text-sm">No se pudo cargar tu historial de facturación.</p>`; console.error(ex); }
  }

  /* Al volver de Stripe: refresca el perfil (el webhook ya sincronizó el plan). */
  function handleCheckoutReturn() {
    return window.msfCheckout.handleCheckoutReturn({
      onSynced(profile) { PROFILE = profile; applyPlanGating(); },
    });
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
      renderReferralProgress();
    } catch (ex) { errToast(ex, "No se pudieron cargar los referidos"); }
  }
  $("#btnCopyRefCode")?.addEventListener("click", async () => {
    const code = $("#refCodeDisplay")?.textContent.trim();
    if (!code || code === "—") return;
    try { await navigator.clipboard.writeText(code); toast("Código copiado", code, "ok"); }
    catch { toast(code, "Cópialo manualmente", "info"); }
  });

  /* ---------- Progreso de puntos de referidos ----------
     Las recompensas dependen del plan ACTUAL del coach: Star tiene dos metas
     (4 pts → mes gratis de Star, manual; 5 pts → upgrade a Star Plus,
     automático); Star Plus tiene una sola meta (4 pts, automático). */
  function renderReferralProgress() {
    const plan = PROFILE.plan || "Free";
    const pts = PROFILE.referral_points || 0;
    const isStar = plan === "Star", isPlus = plan === "Star Plus";
    $("#refProgressStar")?.classList.toggle("hidden", !isStar);
    $("#refProgressPlus")?.classList.toggle("hidden", !isPlus);
    $("#refMotivFree") && ($("#refMotivFree").style.display = !isStar && !isPlus ? "" : "none");
    // Star Plus en construcción: las recompensas de referidos que dan acceso a
    // Star Plus quedan congeladas (los puntos se conservan). El mes gratis de
    // Star (canje manual, 4 pts) NO se toca — ese plan sí está disponible.
    const plusBlocked = !!window.msfCheckout?.isPlanBlocked?.("Star Plus");
    if (isStar) {
      $("#refPtsTo4") && ($("#refPtsTo4").textContent = `${Math.min(pts, 4)}/4`);
      $("#refBar4") && ($("#refBar4").style.width = Math.min(100, (pts / 4) * 100) + "%");
      $("#btnRedeemStarMonth")?.classList.toggle("hidden", pts < 4);
      // Meta de 5 pts (upgrade a Star Plus): oculta mientras Star Plus esté en construcción.
      const to5Row = $("#refPtsTo5")?.closest(".row");
      const to5Bar = $("#refBar5")?.parentElement;
      to5Row?.classList.toggle("hidden", plusBlocked);
      to5Bar?.classList.toggle("hidden", plusBlocked);
      if (!plusBlocked) {
        $("#refPtsTo5") && ($("#refPtsTo5").textContent = `${Math.min(pts, 5)}/5`);
        $("#refBar5") && ($("#refBar5").style.width = Math.min(100, (pts / 5) * 100) + "%");
      }
      $("#refMotivStar") && ($("#refMotivStar").textContent = plusBlocked
        ? (pts >= 4
            ? "¡Ya puedes canjear tu mes gratis de Star! Sigue sumando puntos: pronto habrá más recompensas."
            : `Te faltan ${4 - pts} punto${4 - pts === 1 ? "" : "s"} para tu primer mes gratis de Star.`)
        : (pts >= 4
            ? "¡Ya puedes canjear tu mes gratis de Star, o sigue sumando: a los 5 puntos subes gratis a Star Plus por un mes!"
            : `Te faltan ${4 - pts} punto${4 - pts === 1 ? "" : "s"} para tu primer mes gratis de Star.`));
    } else if (isPlus) {
      const rem = pts % 4;
      $("#refPtsPlus") && ($("#refPtsPlus").textContent = `${rem}/4`);
      $("#refBarPlus") && ($("#refBarPlus").style.width = Math.min(100, (rem / 4) * 100) + "%");
      $("#refMotivPlus") && ($("#refMotivPlus").textContent = plusBlocked
        ? "Sigues acumulando puntos por tus referidos. Las recompensas de Star Plus están en construcción; se activarán muy pronto."
        : `Te faltan ${4 - rem} punto${4 - rem === 1 ? "" : "s"} para tu próximo mes gratis de Star Plus (automático).`);
    } else if (pts > 0) {
      $("#refMotivFree") && ($("#refMotivFree").textContent = `Ya tienes ${pts} punto${pts === 1 ? "" : "s"} de referidos. Mejora a Star o Star Plus para empezar a canjearlos por meses gratis.`);
    }
  }
  $("#btnRedeemStarMonth")?.addEventListener("click", async () => {
    const btn = $("#btnRedeemStarMonth");
    btn.disabled = true;
    try {
      const { data: { session } } = await window.msfSupabase.auth.getSession();
      if (!session) return toast("Sesión expirada, vuelve a entrar", "", "err");
      const r = await fetch("/api/redeem-referral", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: session.access_token }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "No se pudo canjear la recompensa");
      window.msfSound?.playSound?.("confirm");
      toast("¡Listo! Tu próximo mes de Star es gratis 🎉", "", "ok");
      const fresh = await window.msfAuth.getSessionProfile();
      if (fresh?.profile) { PROFILE = fresh.profile; renderReferralProgress(); applyPlanGating(); }
    } catch (ex) { errToast(ex, "No se pudo canjear la recompensa"); }
    finally { btn.disabled = false; }
  });

  /* ---------- Asistencia Programada (lista del ciclo actual) ----------
     Muestra a quién asistirá mañana (presencial) y quién entrenó hoy (online)
     en dos bloques fijos, con horario elegido o motivo de ausencia.
     Persiste hasta "Reiniciar Día". */
  let ATTENDANCE_ROWS = [];
  let attFilter = { text: "", resp: "all", sort: "time" };
  function renderAttendanceRows(wrap, rows) {
    if (!wrap) return;
    if (!rows.length) { wrap.innerHTML = `<p class="t3 text-sm">Sin resultados.</p>`; return; }
    wrap.innerHTML = rows.map((r) => {
      const s = r.students || {};
      const isPresencial = s.training_type === "Presencial";
      const day = new Date(r.attend_date + "T00:00:00").toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });
      const sub = r.response === "yes"
        ? `${isPresencial ? "Asistirá" : "Entrenó"} · ${r.scheduled_time ? r.scheduled_time.slice(0, 5) : "—"} · ${api.esc(day)}`
        : `${isPresencial ? "No asistirá" : "No entrenó"} · ${api.esc(r.reason || "sin motivo")}`;
      return `<div class="due-row">
        <div class="avatar avatar--sm">${api.initials(s.full_name)}</div>
        <div class="due-row__meta"><div class="due-row__name">${api.esc(s.full_name || "Alumno")}</div><div class="due-row__sub">${sub}</div></div>
        <span class="badge ${r.response === "yes" ? "badge--ok" : "badge--late"}">${r.response === "yes" ? "Sí" : "No"}</span>
      </div>`;
    }).join("");
  }
  function renderAttendanceList() {
    const presWrap = $("#attendanceTodayPresencial");
    const onlineWrap = $("#attendanceTodayOnline");
    const statsWrap = $("#attStats");
    if (!presWrap || !onlineWrap) return;
    if (!ATTENDANCE_ROWS.length) {
      const empty = `<p class="t3 text-sm">Aún nadie ha respondido hoy.</p>`;
      presWrap.innerHTML = empty; onlineWrap.innerHTML = empty;
      $("#attendanceSummary") && ($("#attendanceSummary").textContent = "");
      if (statsWrap) statsWrap.innerHTML = "";
      return;
    }
    const yes = ATTENDANCE_ROWS.filter((r) => r.response === "yes").length;
    const no = ATTENDANCE_ROWS.length - yes;
    $("#attendanceSummary") && ($("#attendanceSummary").textContent = `${ATTENDANCE_ROWS.length} respuesta${ATTENDANCE_ROWS.length === 1 ? "" : "s"}`);
    if (statsWrap) statsWrap.innerHTML = `
      <span class="badge badge--ok">✓ ${yes} sí</span>
      <span class="badge badge--late">✕ ${no} no</span>`;

    let list = ATTENDANCE_ROWS.filter((r) => {
      const s = r.students || {};
      if (attFilter.text && !s.full_name?.toLowerCase().includes(attFilter.text.toLowerCase())) return false;
      if (attFilter.resp !== "all" && r.response !== attFilter.resp) return false;
      return true;
    });
    list = list.slice().sort((a, b) => {
      if (attFilter.sort === "name") return (a.students?.full_name || "").localeCompare(b.students?.full_name || "");
      return (a.scheduled_time || "99:99").localeCompare(b.scheduled_time || "99:99");
    });

    renderAttendanceRows(presWrap, list.filter((r) => r.students?.training_type === "Presencial"));
    renderAttendanceRows(onlineWrap, list.filter((r) => r.students?.training_type !== "Presencial"));
  }
  async function renderAttendanceToday() {
    const wrap = $("#attendanceTodayPresencial");
    if (!wrap) return;
    try {
      ATTENDANCE_ROWS = await api.listCoachAttendance();
      renderAttendanceList();
    } catch (ex) {
      const msg = `<p class="t3 text-sm">No se pudo cargar la asistencia.</p>`;
      $("#attendanceTodayPresencial").innerHTML = msg;
      $("#attendanceTodayOnline").innerHTML = msg;
    }
  }
  $("#attSearch")?.addEventListener("input", (e) => { attFilter.text = e.target.value; renderAttendanceList(); });
  $("#attFilterResp")?.addEventListener("change", (e) => { attFilter.resp = e.target.value; renderAttendanceList(); });
  $("#attSort")?.addEventListener("change", (e) => { attFilter.sort = e.target.value; renderAttendanceList(); });
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
      // Asistencia: un alumno confirma/cancela → refresca la lista del día
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance", filter: `coach_id=eq.${PROFILE.id}` }, () => {
        renderAttendanceToday();
      })
      // #1 Alumno cambia su objetivo/datos (students.goal, etc.) → refresca
      // tarjetas, dashboard y estadísticas del coach al instante.
      .on("postgres_changes", { event: "*", schema: "public", table: "students", filter: `coach_id=eq.${PROFILE.id}` }, async () => {
        try { STUDENTS = await api.listStudents(PROFILE.id); renderStudents(); updateKpis(); } catch (_) {}
      })
      // Notificaciones (ej. alumno cambió su objetivo) — llegan sin recargar
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `coach_id=eq.${PROFILE.id}` }, (payload) => {
        // Solo notificaciones dirigidas al coach (las del alumno comparten coach_id).
        if (payload.new?.recipient && payload.new.recipient !== "coach") return;
        DB_NOTIFICATIONS = [payload.new, ...DB_NOTIFICATIONS];
        renderNotifications();
        window.msfSound?.playSound?.("notify");
      })
      // Comunidad: comentarios/likes de alumnos en vivo
      .on("postgres_changes", { event: "*", schema: "public", table: "community_posts", filter: `coach_id=eq.${PROFILE.id}` }, () => {
        if ($("#view-comunidad")?.classList.contains("is-active")) renderCommunity();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "community_comments" }, () => {
        if ($("#view-comunidad")?.classList.contains("is-active")) renderCommunity();
      })
      .subscribe();
    // Plan del coach en canal dedicado: si cambia (upgrade/downgrade vía
    // webhook), el gating de toda la app se resincroniza al instante.
    window.msfSupabase
      .channel("coach-plan-" + PROFILE.id)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${PROFILE.id}` }, (payload) => {
        PROFILE = { ...PROFILE, ...payload.new };
        applyPlanGating();
      })
      .subscribe();
    // Objetivos personalizados: canal dedicado (si el coach los edita desde
    // otra sesión/dispositivo, la vista de Objetivos se refresca sola).
    window.msfSupabase
      .channel("coach-objectives-" + PROFILE.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "coach_objectives", filter: `coach_id=eq.${PROFILE.id}` }, () => {
        renderObjectives();
      })
      .subscribe();
  }

  /* ---------- Init ---------- */
  /* ---------- Catálogo de objetivos del coach ---------- */
  let OBJECTIVES = [];
  function objectiveRow(o, deletable) {
    return `<div class="due-row">
      <div class="due-row__meta">
        <div class="due-row__name">${api.esc(o.title)}</div>
        <div class="due-row__sub">${o.goal_type ? api.esc(o.goal_type) : "Cualquier objetivo"}${o.description ? " · " + api.esc(o.description) : ""}</div>
      </div>
      ${deletable ? `<button class="icon-btn js-del-objective" data-id="${o.id}" title="Eliminar">
        <svg viewBox="0 0 24 24" width="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>` : ""}
    </div>`;
  }
  async function renderObjectives() {
    const list = $("#objectivesList");
    if (!list) return;
    try {
      OBJECTIVES = await api.listCatalogAndCustom(PROFILE.id);
      const system = OBJECTIVES.filter((o) => o.is_system);
      const custom = OBJECTIVES.filter((o) => !o.is_system);
      const parts = [];
      parts.push(`<div class="t3 text-sm fw-600 mb-4">Catálogo del sistema</div>`);
      parts.push(system.map((o) => objectiveRow(o, false)).join(""));
      if (custom.length) {
        parts.push(`<div class="t3 text-sm fw-600 mt-6 mb-4">Tus objetivos personalizados</div>`);
        parts.push(custom.map((o) => objectiveRow(o, true)).join(""));
      }
      list.innerHTML = parts.join("");
    } catch (ex) { errToast(ex, "No se pudo cargar el catálogo de objetivos"); }
  }

  function wireObjectives() {
    $("#formObjective")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!FEATURES?.objectives) { toast("Función premium", "Actualiza a Star para crear objetivos personalizados", "info"); return; }
      const title = $("#objTitle").value.trim();
      if (!title) return;
      try {
        await api.createObjective(PROFILE.id, title, $("#objDesc").value.trim(), $("#objGoalType").value);
        $("#objTitle").value = ""; $("#objDesc").value = ""; $("#objGoalType").value = "";
        await renderObjectives();
        toast("Objetivo añadido", "Se asignará automáticamente a los alumnos que coincidan", "ok");
        window.msfSound?.playSound?.("save");
      } catch (ex) { errToast(ex, "No se pudo crear el objetivo"); }
    });
    $("#objectivesList")?.addEventListener("click", async (e) => {
      const btn = e.target.closest(".js-del-objective");
      if (!btn) return;
      try { await api.deleteObjective(btn.dataset.id); await renderObjectives(); }
      catch (ex) { errToast(ex, "No se pudo eliminar"); }
    });
    // Asignar / quitar objetivos desde la ficha del alumno (delegado)
    $("#dwObjectives")?.addEventListener("click", async (e) => {
      const assign = e.target.closest(".js-assign");
      const unassign = e.target.closest(".js-unassign");
      try {
        if (assign) {
          const sel = $("#dwAssignSelect");
          if (!sel?.value) return;
          await api.assignObjective(assign.dataset.student, sel.value, PROFILE.id);
          await loadDrawerObjectives(assign.dataset.student);
        } else if (unassign) {
          await api.unassignObjective(unassign.dataset.student, unassign.dataset.obj);
          await loadDrawerObjectives(unassign.dataset.student);
        }
      } catch (ex) { errToast(ex, "No se pudo actualizar el objetivo"); }
    });
  }

  /* Objetivos asignados al alumno del drawer + asignación manual */
  async function loadDrawerObjectives(studentId) {
    const box = $("#dwObjectives");
    if (!box) return;
    try {
      const [assigned, catalog] = await Promise.all([
        api.listStudentObjectives(studentId),
        OBJECTIVES.length ? Promise.resolve(OBJECTIVES) : api.listCatalogAndCustom(PROFILE.id),
      ]);
      OBJECTIVES = catalog;
      const assignedIds = new Set(assigned.map((a) => a.objective_id));
      const chips = assigned.map((a) => {
        const o = a.coach_objectives || {};
        return `<div class="due-row">
          <div class="due-row__meta"><div class="due-row__name">${api.esc(o.title || "Objetivo")}</div><div class="due-row__sub">${a.auto ? "Asignado automáticamente" : "Asignado por ti"}${a.status === "done" ? " · ✅ Completado" : ""}</div></div>
          <button class="icon-btn js-unassign" data-obj="${a.objective_id}" data-student="${studentId}" title="Quitar"><svg viewBox="0 0 24 24" width="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>`;
      }).join("") || `<p class="t3 text-sm">Sin objetivos asignados.</p>`;
      const available = catalog.filter((o) => !assignedIds.has(o.id));
      const select = available.length
        ? `<div class="row gap-3 mt-4"><select class="select" id="dwAssignSelect" style="flex:1"><option value="">Asignar objetivo…</option>${available.map((o) => `<option value="${o.id}">${api.esc(o.title)}</option>`).join("")}</select><button class="btn btn--ghost btn--sm js-assign" data-student="${studentId}">Asignar</button></div>`
        : (catalog.length ? "" : `<p class="t3 text-sm mt-4">Crea objetivos en Ajustes para asignarlos.</p>`);
      box.innerHTML = chips + select;
    } catch (ex) { console.error("No se pudieron cargar los objetivos del alumno:", ex); }
  }

  async function init() {
    const auth = await window.msfAuth.requireCoachReady();
    if (!auth) return;
    PROFILE = auth.profile;
    // #12 Aplica las preferencias visuales guardadas en la cuenta (siguen al
    // coach entre dispositivos) y persiste cualquier cambio posterior.
    window.msfTheme?.applyRemote?.({ mode: PROFILE.theme_mode, accent: PROFILE.accent_color });
    renderAccentSwatches();
    $("#pageSub") && ($("#pageSub").textContent = `Buenas, ${PROFILE.full_name.split(" ")[0]} 👋`);
    $$(".coach-card__name").forEach((el) => (el.textContent = PROFILE.full_name));
    $$(".avatar.avatar--ring, .coach-card .avatar").forEach((el) => (el.textContent = api.initials(PROFILE.full_name)));
    applyCoachAvatar(PROFILE.avatar_url);
    $("#profName") && ($("#profName").value = PROFILE.full_name);
    $("#profEmail") && ($("#profEmail").value = PROFILE.email);
    $("#profPhone") && ($("#profPhone").value = PROFILE.phone || "");
    $("#profLocation") && ($("#profLocation").value = PROFILE.location || "");
    $("#profYears") && ($("#profYears").value = PROFILE.years_experience || "");
    $("#profStudentCount") && ($("#profStudentCount").value = PROFILE.current_students_count ?? "");
    $("#profBusinessGoal") && ($("#profBusinessGoal").value = PROFILE.business_goal || "");
    $("#profSpecialty") && ($("#profSpecialty").value = PROFILE.specialty || "");
    $("#profBio") && ($("#profBio").value = PROFILE.bio || "");
    // Enlace de invitación permanente del coach (login?coach=<id>)
    const inviteUrl = `${location.origin}/login?coach=${PROFILE.id}`;
    $("#inviteLinkDisplay") && ($("#inviteLinkDisplay").textContent = inviteUrl);
    const copyInvite = async () => {
      try { await navigator.clipboard.writeText(inviteUrl); toast("Enlace copiado", "Compártelo con tus alumnos", "ok"); }
      catch { toast("Cópialo manualmente", inviteUrl, "info"); }
    };
    $("#btnCopyInvite")?.addEventListener("click", copyInvite);
    $("#btnCopyInvite2")?.addEventListener("click", copyInvite);
    // Código corto del coach (para la pantalla de "código de tu coach")
    if (PROFILE.referral_code) {
      $("#coachCodeDisplay") && ($("#coachCodeDisplay").textContent = PROFILE.referral_code);
      $("#btnCopyCode")?.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(PROFILE.referral_code); toast("Código copiado", PROFILE.referral_code, "ok"); }
        catch { toast("Cópialo manualmente", PROFILE.referral_code, "info"); }
      });
    }

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
    loadNotifications();
    fillRoutineSelect();
    renderAccentSwatches();
    renderAttendanceToday();
    renderObjectives();
    wireObjectives();
    subscribeRealtime();
    handleCheckoutReturn();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
