/* ============================================================
   MySystemFit — App del alumno, conectada a Supabase (datos reales)
   ============================================================ */
(function () {
  "use strict";
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const api = window.msfApi;

  let PROFILE = null;
  let STUDENT = null;

  function toast(txt, type = "ok") {
    const stack = $("#toastStack");
    const ico = { ok: '<polyline points="20 6 9 17 4 12"/>', info: '<line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>' }[type];
    const el = document.createElement("div");
    el.className = "toast toast--" + type;
    el.innerHTML = `<span class="toast__ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">${ico}</svg></span><div class="toast__txt">${api.esc(txt)}</div>`;
    stack.appendChild(el);
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 220); }, 2600);
  }
  function errToast(e, fallback) {
    console.error(fallback + ":", e); // detalle técnico solo a consola, nunca al usuario
    const extra = api.friendlyError(e);
    toast(fallback + (extra ? ": " + extra : ""), "info");
  }

  /* Cerrar sesión (a nivel superior: funciona aunque init termine antes) */
  async function doLogout() {
    try { await window.msfSupabase?.auth.signOut(); } catch (_) {}
    try {
      localStorage.removeItem("msf_pending_coach");
      localStorage.removeItem("msf_oauth_role");
    } catch (_) {}
    window.location.href = "login.html";
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest("#aLogout")) { e.preventDefault(); doLogout(); }
  });

  /* Navegación bottom nav */
  function anav(view) {
    $$(".a-view").forEach((v) => v.classList.remove("is-active"));
    $("#a-" + view)?.classList.add("is-active");
    $$(".a-nav button").forEach((b) => b.classList.toggle("is-active", b.dataset.anav === view));
    window.scrollTo(0, 0);
    if (view === "home") animateRing();
    if (view === "comunidad") renderCommunity();
    if (view === "chat") loadChat();
    if (view === "progreso") renderPhotoTimeline();
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-anav]");
    if (b) anav(b.dataset.anav);
  });

  /* Anillo de progreso animado, basado en peso real vs meta */
  function animateRing() {
    let pct = 0;
    if (STUDENT?.weight_current && STUDENT?.weight_goal) {
      const startWeight = STUDENT.weight_current > STUDENT.weight_goal
        ? STUDENT.weight_current + (STUDENT.weight_current - STUDENT.weight_goal)
        : STUDENT.weight_goal - (STUDENT.weight_goal - STUDENT.weight_current);
      const total = Math.abs(startWeight - STUDENT.weight_goal) || 1;
      const done = Math.abs(startWeight - STUDENT.weight_current);
      pct = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
    }
    const circ = 565;
    const ring = $("#ringProg");
    const val = $("#ringVal");
    if (!ring || !val) return;
    let start;
    function tick(now) {
      if (!start) start = now;
      const p = Math.min((now - start) / 1100, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const cur = pct * eased;
      ring.style.strokeDashoffset = circ - (circ * cur) / 100;
      val.textContent = Math.round(cur) + "%";
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* Checklist rutina + progreso (sesión del día, en memoria) */
  function updateSession() {
    const total = $$(".ex-row").length;
    const done = $$(".ex-row.done").length;
    $("#sessCount") && ($("#sessCount").textContent = done + "/" + total);
    $("#sessFill") && ($("#sessFill").style.width = (total ? (done / total) * 100 : 0) + "%");
  }
  document.addEventListener("click", (e) => {
    const c = e.target.closest("[data-check]");
    if (!c) return;
    const row = c.closest(".ex-row");
    c.classList.toggle("done");
    row.classList.toggle("done", c.classList.contains("done"));
    updateSession();
  });

  function celebrate() {
    const colors = ["#FF2E4D", "#2E6BFF", "#39D0FF", "#5B8BFF"];
    const burst = document.createElement("div");
    burst.className = "confetti-burst";
    for (let i = 0; i < 26; i++) {
      const p = document.createElement("span");
      p.className = "confetti-piece";
      const angle = Math.random() * Math.PI * 2;
      const dist = 90 + Math.random() * 140;
      p.style.setProperty("--confetti-end", `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px)`);
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (Math.random() * 120) + "ms";
      burst.appendChild(p);
    }
    document.body.appendChild(burst);
    setTimeout(() => burst.remove(), 1200);
    $(".ring-wrap")?.classList.add("is-celebrating");
    setTimeout(() => $(".ring-wrap")?.classList.remove("is-celebrating"), 1900);
  }
  $("#finishSession")?.addEventListener("click", async () => {
    celebrate();
    toast("¡Sesión completada! 🔥 +1 a tu racha", "ok");
    if (STUDENT?.weight_current) {
      try { await api.addWeightLog(STUDENT.id, STUDENT.weight_current); }
      catch (ex) { console.error("No se registró el peso de la sesión:", ex); toast("Sesión completada, pero no se pudo registrar tu peso", "info"); }
    }
  });

  /* Rest timer */
  let timerInt = null;
  function startRest() {
    clearInterval(timerInt);
    let left = 60;
    const t = $("#restTimer"), v = $("#timerVal");
    t.classList.add("show");
    const fmt = (s) => "0" + Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    v.textContent = fmt(left);
    timerInt = setInterval(() => {
      left--; v.textContent = fmt(left);
      if (left <= 0) { clearInterval(timerInt); t.classList.remove("show"); toast("¡Descanso terminado! 💪", "info"); }
    }, 1000);
  }
  document.addEventListener("click", (e) => { if (e.target.closest(".js-rest")) startRest(); });
  $("#timerSkip")?.addEventListener("click", () => { clearInterval(timerInt); $("#restTimer").classList.remove("show"); });

  /* Dropzone fotos → subida real a Supabase Storage */
  const dz = $("#dropzone"), fi = $("#fileInput"), prev = $("#dropPreview");
  let pendingFile = null;
  dz?.addEventListener("click", () => fi.click());
  ["dragover", "dragenter"].forEach((ev) => dz?.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => dz?.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
  function showPreview(file) {
    if (!file) return;
    pendingFile = file;
    const url = URL.createObjectURL(file);
    prev.innerHTML = `<div class="card" style="display:flex;gap:12px;align-items:center"><img src="${url}" style="width:60px;height:80px;object-fit:cover;border-radius:8px"><div><div class="fw-600">Foto lista</div><div class="t3 text-sm">${api.esc(file.name)}</div></div><button class="btn btn--lime btn--sm" id="uploadPhotoBtn" style="margin-left:auto">Subir</button></div>`;
  }
  dz?.addEventListener("drop", (e) => showPreview(e.dataTransfer.files[0]));
  fi?.addEventListener("change", (e) => showPreview(e.target.files[0]));
  document.addEventListener("click", async (e) => {
    if (!e.target.closest("#uploadPhotoBtn") || !pendingFile || !STUDENT) return;
    const btn = e.target.closest("#uploadPhotoBtn");
    btn.disabled = true; btn.textContent = "Subiendo…";
    try {
      await api.uploadProgressPhoto(STUDENT.id, pendingFile);
      pendingFile = null;
      prev.innerHTML = "";
      await renderPhotoTimeline();
      toast("Foto subida 📸", "ok");
    } catch (ex) { btn.disabled = false; btn.textContent = "Subir"; errToast(ex, "No se pudo subir la foto"); }
  });

  async function renderPhotoTimeline() {
    const grid = $(".photo-grid");
    if (!grid || !STUDENT) return;
    try {
      const photos = await api.listProgressPhotos(STUDENT.id);
      if (!photos.length) return; // deja los placeholders de ejemplo
      grid.innerHTML = photos.map((p, i) => `<div class="photo-cell photo-cell--real"><span>${new Date(p.taken_at).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}</span><img src="${p.url}" alt="Progreso ${i + 1}"></div>`).join("");
    } catch (ex) { console.error("No se pudieron cargar las fotos de progreso:", ex); }
  }

  /* Tooltip interactivo en gráfico de peso */
  function attachChartTooltip(wrap, values, suffix) {
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
      dot.style.left = xPct + "%"; dot.style.top = yPct + "%";
      tip.style.left = xPct + "%"; tip.style.top = yPct + "%";
      tip.textContent = val.toLocaleString("es-MX", { maximumFractionDigits: 1 }) + suffix;
      dot.classList.add("show"); tip.classList.add("show");
    });
    wrap.addEventListener("mouseleave", () => { dot.classList.remove("show"); tip.classList.remove("show"); });
  }

  /* ---------- Home: datos reales del alumno ---------- */
  function paintHome() {
    if (!STUDENT) return;
    $("#homeWeightCurrent") && ($("#homeWeightCurrent").textContent = STUDENT.weight_current ?? "—");
    $("#homeWeightGoal") && ($("#homeWeightGoal").textContent = STUDENT.weight_goal ?? "—");
    const nameEl = $(".a-top__name");
    if (nameEl) nameEl.textContent = (PROFILE.full_name.split(" ")[0] || PROFILE.full_name) + " 👋";
    $(".avatar.avatar--ring") && ($(".avatar.avatar--ring").textContent = api.initials(PROFILE.full_name));

    // Membresía real (sincronizada con lo que definió el coach)
    const memBadge = $(".member-card .badge");
    if (memBadge) {
      if (STUDENT.membership_end) {
        const days = Math.ceil((new Date(STUDENT.membership_end) - new Date()) / 86400000);
        if (days < 0) { memBadge.className = "badge badge--late"; memBadge.textContent = `Vencida hace ${-days}d`; }
        else if (days <= 5) { memBadge.className = "badge badge--pend"; memBadge.textContent = days === 0 ? "Vence hoy" : `Vence en ${days} días`; }
        else { memBadge.className = "badge badge--ok"; memBadge.textContent = `Activa · ${days} días`; }
      } else { memBadge.className = "badge badge--ok"; memBadge.textContent = "Activa"; }
    }
    const memType = $(".member-card .t3");
    if (memType) memType.textContent = `Plan ${STUDENT.training_type === "Presencial" ? "presencial" : "online"}`;
  }

  /* ---------- Renovación: pago pendiente real (si existe) ---------- */
  async function loadPendingPayment() {
    const btn = $("#renewBtn");
    if (!btn || !STUDENT) return;
    try {
      const { data, error } = await window.msfSupabase
        .from("payments").select("amount, due_date")
        .eq("student_id", STUDENT.id).neq("state", "ok")
        .order("due_date").limit(1);
      if (error) throw error;
      if (data?.length) {
        btn.textContent = `Pago pendiente: $${Number(data[0].amount).toLocaleString("es-MX")}`;
        btn.classList.remove("hidden");
        btn.onclick = () => anav("chat");
      }
    } catch (ex) { console.error("No se pudo consultar el pago pendiente:", ex); }
  }

  /* ---------- Estadísticas reales de la semana ---------- */
  async function loadWeekStats() {
    if (!STUDENT) return;
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    // Entrenos y racha: solo hay registro de asistencia para presenciales
    if (STUDENT.training_type === "Presencial") {
      try {
        const from = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
        const today = todayStr();
        // Solo cuentan asistencias cuya fecha ya llegó (confirmadas y transcurridas)
        const days = new Set(
          (await api.listMyAttendance(STUDENT.id, from)).map((r) => r.attend_date).filter((d) => d <= today)
        );
        $("#wkTrainings") && ($("#wkTrainings").textContent = [...days].filter((d) => d >= weekAgo).length);
        // Racha: días consecutivos con asistencia hacia atrás desde hoy/ayer
        let streak = 0;
        let cursor = new Date();
        if (!days.has(today)) cursor = new Date(Date.now() - 86400000);
        while (days.has(cursor.toISOString().slice(0, 10))) { streak++; cursor = new Date(cursor.getTime() - 86400000); }
        $("#wkStreak") && ($("#wkStreak").textContent = streak > 0 ? `🔥 ${streak}` : "0");
      } catch (ex) { console.error("No se pudieron cargar las estadísticas de asistencia:", ex); }
    }
    // Delta de peso de los últimos 7 días (con lo que haya registrado)
    try {
      const logs = await api.listWeightLogs(STUDENT.id);
      const recent = logs.filter((l) => l.logged_at >= weekAgo);
      if (recent.length >= 2) {
        const delta = (Number(recent[recent.length - 1].weight) - Number(recent[0].weight)).toFixed(1);
        $("#wkWeight") && ($("#wkWeight").textContent = `${delta > 0 ? "+" : ""}${delta}`);
      } else if (logs.length) {
        $("#wkWeight") && ($("#wkWeight").textContent = "0");
      }
    } catch (ex) { console.error("No se pudo calcular el delta de peso semanal:", ex); }
  }

  /* ---------- Asistencia para mañana (solo alumnos presenciales) ----------
     La fecha se calcula en la hora LOCAL del alumno para evitar desfases de
     zona horaria: "mañana" es el día siguiente a su fecha local actual. */
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const tomorrowStr = () => {
    const d = new Date(Date.now() + 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  async function loadAttendance() {
    const card = $("#attendanceCard");
    if (!card || !STUDENT || STUDENT.training_type !== "Presencial") return;
    if (!COACH_FEATURES.attendance) { card.classList.add("hidden"); return; }
    card.classList.remove("hidden");
    const label = $("#attendanceDayLabel");
    if (label) {
      const d = new Date(Date.now() + 86400000);
      label.textContent = d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
    }
    try {
      const row = await api.myAttendance(STUDENT.id, tomorrowStr());
      paintAttendance(!!row);
    } catch (ex) { console.error("No se pudo consultar la asistencia:", ex); }
  }
  function paintAttendance(confirmed) {
    $("#attendanceBtns")?.classList.toggle("hidden", confirmed);
    $("#attendanceConfirmed")?.classList.toggle("hidden", !confirmed);
  }
  $("#btnAttendYes")?.addEventListener("click", async () => {
    if (!STUDENT?.coach_id) return;
    const btn = $("#btnAttendYes"); btn.disabled = true;
    try {
      await api.confirmAttendance(STUDENT.id, STUDENT.coach_id, tomorrowStr());
      paintAttendance(true);
      toast("¡Tu coach ya sabe que vas mañana! 🔥", "ok");
    } catch (ex) { errToast(ex, "No se pudo confirmar tu asistencia"); }
    finally { btn.disabled = false; }
  });
  $("#btnAttendCancel")?.addEventListener("click", async () => {
    const btn = $("#btnAttendCancel"); btn.disabled = true;
    try {
      await api.cancelAttendance(STUDENT.id, tomorrowStr());
      paintAttendance(false);
      toast("Cancelaste tu asistencia de mañana", "info");
    } catch (ex) { errToast(ex, "No se pudo cancelar"); }
    finally { btn.disabled = false; }
  });

  /* ---------- Rutina real ---------- */
  async function loadRoutine() {
    if (!STUDENT) return;
    try {
      const routine = await api.getStudentRoutine(STUDENT.id);
      const wrap = $("#a-rutina");
      const list = wrap?.querySelectorAll(".ex-row");
      list?.forEach((el) => el.remove());
      $("#a-rutina .page-head p") && ($("#a-rutina .page-head p").textContent = routine ? `${routine.phase || "Rutina"} · Semana ${routine.week || 1}` : "Tu coach aún no asignó una rutina");
      if (!routine || !routine.days.length) return;
      const today = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"][new Date().getDay()];
      const day = routine.days.find((d) => d.day_name === today) || routine.days[0];
      // CTA del home sincronizado con la rutina real del día
      const cta = $('#a-home [data-anav="rutina"] .t3');
      if (cta) cta.textContent = `${day.label || "Entreno"} · ${(day.exercises || []).length} ejercicios`;
      const anchor = $("#finishSession");
      (day.exercises || []).forEach((ex) => {
        const row = document.createElement("div");
        row.className = "ex-row";
        row.dataset.ex = "";
        row.innerHTML = `<div class="ex-check" data-check><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg></div><div class="ex-row__body"><div class="ex-row__name">${api.esc(ex.name)}${ex.muscle_group ? ` <span class="badge badge--plan" style="font-size:10px;height:18px;padding:0 8px">${api.esc(ex.muscle_group)}</span>` : ""}</div><div class="ex-row__meta">${ex.sets ?? "-"} × ${ex.reps ?? "-"} · ${ex.kg ?? "-"} kg · desc ${ex.rest_seconds ?? "-"}s</div></div><button class="btn btn--ghost btn--sm js-rest">Descanso</button>`;
        anchor?.parentElement.insertBefore(row, anchor);
      });
      updateSession();
    } catch (ex) { errToast(ex, "No se pudo cargar la rutina"); }
  }

  /* ---------- Progreso: peso real ---------- */
  async function loadWeightHistory() {
    if (!STUDENT) return;
    try {
      const logs = await api.listWeightLogs(STUDENT.id);
      const wrap = $("#aWeightChartWrap");
      if (!wrap) return;
      const empty = $("#aWeightEmpty");
      if (!logs.length) { if (empty) empty.style.display = "flex"; return; }
      if (empty) empty.style.display = "none";
      const values = logs.map((l) => Number(l.weight));
      wrap.dataset.chartValues = values.join(",");
      // Dibuja la curva con los registros reales
      const min = Math.min(...values), max = Math.max(...values);
      const pts = values.map((v, i) => {
        const x = values.length === 1 ? 200 : Math.round((i / (values.length - 1)) * 400);
        const y = Math.round(110 - ((v - min) / (max - min || 1)) * 80);
        return [x, y];
      });
      const line = "M" + pts.map((p) => p.join(",")).join(" L");
      const svg = wrap.querySelector(".chart-svg");
      const paths = svg?.querySelectorAll("path");
      if (paths?.[0]) paths[0].setAttribute("d", line + " L400,140 L0,140 Z");
      if (paths?.[1]) paths[1].setAttribute("d", line);
      attachChartTooltip(wrap, values, " kg");
      const first = values[0], last = values[values.length - 1];
      const delta = (last - first).toFixed(1);
      const deltaEl = $("#aWeightDelta");
      if (deltaEl) {
        deltaEl.textContent = `${delta > 0 ? "+" : ""}${delta} kg`;
        deltaEl.className = "badge " + (delta <= 0 ? "badge--ok" : "badge--pend");
      }
      const rangeEl = $("#aWeightRange");
      if (rangeEl) rangeEl.textContent = `${logs.length} registro${logs.length === 1 ? "" : "s"} de peso`;
    } catch (ex) { console.error("No se pudo cargar el historial de peso:", ex); }
  }

  /* ---------- Comunidad real ---------- */
  async function renderCommunity() {
    const view = $("#a-comunidad");
    if (!view || !PROFILE) return;
    try {
      const posts = await api.listCommunityPosts(PROFILE.coach_id);
      const cards = view.querySelectorAll(".card");
      cards.forEach((c) => c.remove());
      const headP = view.querySelector(".page-head");
      posts.forEach((p) => {
        const liked = p.community_likes.some((l) => l.profile_id === PROFILE.id);
        const card = document.createElement("div");
        card.className = "card mb-4";
        const comments = (p.community_comments || []).slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        const commentsHtml = comments.map((c) => `<div class="row gap-3 mb-2"><div class="avatar avatar--sm">${api.initials(c.profiles?.full_name)}</div><div><div class="fw-600 text-sm">${api.esc(c.profiles?.full_name || "Alumno")}</div><div class="t3 text-sm">${api.esc(c.body)}</div></div></div>`).join("") || `<p class="t3 text-sm mb-2">Sé el primero en comentar.</p>`;
        card.innerHTML = `<div class="row gap-3 mb-4"><div class="avatar avatar--md">${api.initials(p.profiles?.full_name)}</div><div><div class="fw-600">${api.esc(p.profiles?.full_name || "Coach")}</div><div class="t3 text-sm">${new Date(p.created_at).toLocaleString("es-MX")}</div></div></div>
          <p style="margin-bottom:12px">${api.esc(p.body)}</p>
          <div class="row gap-3 mt-4"><button class="pill js-react ${liked ? "is-active" : ""}" data-post="${p.id}" data-liked="${liked}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1a5.5 5.5 0 0 0-7.8 7.8l9 9 9-9a5.5 5.5 0 0 0 0-7.8z"/></svg><span>${p.community_likes.length}</span></button><button class="pill js-comments-toggle" data-post="${p.id}">💬 ${comments.length}</button></div>
          <div class="js-comments hidden" data-post="${p.id}" style="margin-top:14px;border-top:1px solid var(--border);padding-top:14px">
            ${commentsHtml}
            <form class="js-comment-form row gap-3 mt-4" data-post="${p.id}"><input class="input js-comment-input" placeholder="Escribe un comentario…" style="flex:1" maxlength="500"><button class="btn btn--primary btn--sm" type="submit">Enviar</button></form>
          </div>`;
        headP.after(card);
      });
      if (!posts.length) {
        const empty = document.createElement("p");
        empty.className = "t3 text-sm";
        empty.textContent = "Tu coach aún no publicó nada.";
        headP.after(empty);
      }
    } catch (ex) { errToast(ex, "No se pudo cargar la comunidad"); }
  }
  document.addEventListener("click", async (e) => {
    const r = e.target.closest(".js-react");
    if (r && PROFILE) {
      const liked = r.dataset.liked === "true";
      try { await api.toggleLike(r.dataset.post, PROFILE.id, liked); renderCommunity(); }
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
    try {
      await api.addComment(form.dataset.post, PROFILE.id, body);
      input.value = "";
      renderCommunity(); // el realtime también refrescará
    } catch (ex) { errToast(ex, "No se pudo enviar el comentario"); }
    finally { input.disabled = false; }
  });

  /* ---------- Chat real con el coach ---------- */
  async function loadChat() {
    if (!STUDENT) return;
    const box = $("#a-chat > div[style*='flex-direction:column']");
    if (!box) return;
    try {
      const msgs = await api.listMessages(PROFILE.coach_id, STUDENT.id);
      box.innerHTML = msgs.map((m) => `<div style="align-self:${m.sender_id === PROFILE.id ? "flex-end" : "flex-start"};max-width:80%;background:${m.sender_id === PROFILE.id ? "var(--indigo)" : "var(--surface-3)"};color:${m.sender_id === PROFILE.id ? "#fff" : "inherit"};padding:10px 14px;border-radius:14px 14px ${m.sender_id === PROFILE.id ? "4px 14px" : "14px 4px"}">${api.esc(m.body)}</div>`).join("") || `<p class="t3 text-sm">Aún no hay mensajes con tu coach.</p>`;
      box.scrollTop = box.scrollHeight;
    } catch (ex) { errToast(ex, "No se pudieron cargar los mensajes"); }
  }
  $("#chatSend")?.addEventListener("click", async () => {
    const inp = $("#chatInput");
    if (!inp.value.trim() || !STUDENT) return;
    try {
      await api.sendMessage(PROFILE.coach_id, STUDENT.id, PROFILE.id, inp.value.trim());
      inp.value = "";
      loadChat();
    } catch (ex) { errToast(ex, "No se pudo enviar el mensaje"); }
  });

  /* ---------- Herencia del plan del coach ----------
     El alumno NUNCA tiene plan propio: hereda las capacidades del plan de su
     coach. Nunca ve precios, upgrades ni pagos del sistema. Si el coach sube
     o baja de plan, esto se resincroniza en tiempo real. */
  let COACH_FEATURES = api.planFeatures("Free");
  function applyCoachPlan(plan) {
    COACH_FEATURES = api.planFeatures(plan || "Free");
    $$('[data-anav="comunidad"]').forEach((b) => { b.style.display = COACH_FEATURES.community ? "" : "none"; });
    $$('[data-anav="chat"]').forEach((b) => { b.style.display = COACH_FEATURES.messages ? "" : "none"; });
    if (!COACH_FEATURES.community && $("#a-comunidad")?.classList.contains("is-active")) anav("home");
    if (!COACH_FEATURES.messages && $("#a-chat")?.classList.contains("is-active")) anav("home");
    if (!COACH_FEATURES.attendance) $("#attendanceCard")?.classList.add("hidden");
    else loadAttendance();
  }

  /* Realtime: nuevos mensajes del coach llegan sin recargar */
  function subscribeRealtime() {
    if (!STUDENT || !window.msfSupabase) return;
    window.msfSupabase
      .channel("alumno-rt-" + STUDENT.id)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `student_id=eq.${STUDENT.id}` },
        (payload) => {
          if ($("#a-chat")?.classList.contains("is-active")) loadChat();
          else if (payload.new.sender_id !== PROFILE.id) toast("Nuevo mensaje de tu coach 💬", "info");
        })
      // Cambios en su ficha (membresía, datos) → refresca en vivo
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "students", filter: `id=eq.${STUDENT.id}` },
        (payload) => { STUDENT = { ...STUDENT, ...payload.new }; paintHome(); loadPendingPayment(); })
      // Pagos (nuevo cargo o marcado como pagado por el coach)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "payments", filter: `student_id=eq.${STUDENT.id}` },
        () => loadPendingPayment())
      // Objetivos asignados/quitados por el coach
      .on("postgres_changes",
        { event: "*", schema: "public", table: "student_objectives", filter: `student_id=eq.${STUDENT.id}` },
        () => loadMyObjectives())
      // Comunidad de su coach: publicaciones/comentarios/likes en vivo
      .on("postgres_changes",
        { event: "*", schema: "public", table: "community_posts", filter: `coach_id=eq.${PROFILE.coach_id}` },
        () => { if ($("#a-comunidad")?.classList.contains("is-active")) renderCommunity(); })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "community_comments" },
        () => { if ($("#a-comunidad")?.classList.contains("is-active")) renderCommunity(); })
      .subscribe();
    // Si el coach cambia de plan, los permisos heredados cambian al instante
    // (canal dedicado: los filtros de profiles son más fiables aislados).
    window.msfSupabase
      .channel("alumno-plan-" + STUDENT.id)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${PROFILE.coach_id}` },
        (payload) => { if (payload.new?.plan) applyCoachPlan(payload.new.plan); })
      .subscribe();
  }

  /* ---------- Init ---------- */
  /* ---------- Objetivos asignados por el coach ---------- */
  async function loadMyObjectives() {
    const card = $("#objectivesCard"), box = $("#myObjectives");
    if (!card || !box || !STUDENT) return;
    try {
      const rows = await api.listStudentObjectives(STUDENT.id);
      if (!rows.length) { card.classList.add("hidden"); return; }
      card.classList.remove("hidden");
      box.innerHTML = rows.map((a) => {
        const o = a.coach_objectives || {};
        const done = a.status === "done";
        return `<div class="due-row">
          <div class="due-row__meta"><div class="due-row__name">${api.esc(o.title || "Objetivo")}</div><div class="due-row__sub">${o.description ? api.esc(o.description) : (o.goal_type ? api.esc(o.goal_type) : "")}</div></div>
          <button class="btn btn--sm ${done ? "btn--ghost" : "btn--lime"} js-toggle-objective" data-id="${a.id}" data-status="${done ? "active" : "done"}">${done ? "✅ Hecho" : "Marcar hecho"}</button>
        </div>`;
      }).join("");
    } catch (ex) { console.error("No se pudieron cargar tus objetivos:", ex); }
  }
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".js-toggle-objective");
    if (!btn) return;
    btn.disabled = true;
    try { await api.setObjectiveStatus(btn.dataset.id, btn.dataset.status); await loadMyObjectives(); }
    catch (ex) { btn.disabled = false; errToast(ex, "No se pudo actualizar"); }
  });

  /* ---------- Onboarding inicial (una sola vez) ----------
     Campos obligatorios: objetivo, edad, sexo, peso, altura, peso meta,
     experiencia y frecuencia. La BD los vuelve a validar (backend). */
  async function maybeShowOnboarding() {
    if (!STUDENT || STUDENT.onboarding_completed_at) return;
    const overlay = $("#onboarding");
    if (!overlay) return;

    const answers = {};
    let step = 1;
    const TOTAL = 9;
    const stepEl = (n) => overlay.querySelector(`.ob-step[data-step="${n}"]`);
    const bar = $("#obBar"), stepNum = $("#obStepNum"),
          backBtn = $("#obBack"), nextBtn = $("#obNext"), errEl = $("#obError");

    // Paso 1: objetivos del catálogo del coach, o pregunta abierta si no hay.
    let goalIsFree = false;
    const choicesBox = $("#obGoalChoices");
    try {
      const catalog = (await api.listObjectives(PROFILE.coach_id)).filter((o) => o.active !== false);
      if (catalog.length) {
        choicesBox.innerHTML = catalog.map((o) =>
          `<div class="ob-choice" data-value="${api.esc(o.title)}"><span class="ob-choice__emoji">🎯</span><div><div class="ob-choice__t">${api.esc(o.title)}</div>${o.description ? `<div class="ob-choice__s">${api.esc(o.description)}</div>` : ""}</div></div>`
        ).join("");
      } else { goalIsFree = true; }
    } catch (_) { goalIsFree = true; }
    if (goalIsFree) {
      choicesBox.classList.add("hidden");
      $("#obGoalFreeWrap").classList.remove("hidden");
      $("#obGoalHint").textContent = "Tu coach aún no ha configurado objetivos personalizados. Cuéntanos con tus palabras: ¿cuál es tu objetivo?";
    }

    // Prellena con lo que el coach ya tenga cargado
    if (STUDENT.weight_current != null) $("#obWeightCurrent").value = STUDENT.weight_current;
    if (STUDENT.weight_goal != null) $("#obWeightGoal").value = STUDENT.weight_goal;
    if (STUDENT.height != null) $("#obHeight").value = STUDENT.height;
    if (STUDENT.age != null) $("#obAge").value = STUDENT.age;

    // Selección en tarjetas / botones de opción única (delegado: soporta
    // también las opciones del catálogo renderizadas arriba)
    overlay.querySelectorAll("[data-single]").forEach((group) => {
      const field = group.getAttribute("data-field");
      group.addEventListener("click", (e) => {
        const opt = e.target.closest("[data-value]");
        if (!opt || !group.contains(opt)) return;
        group.querySelectorAll("[data-value]").forEach((o) => o.classList.remove("sel"));
        opt.classList.add("sel");
        answers[field] = opt.getAttribute("data-value");
        errEl.style.display = "none";
      });
    });

    function render() {
      overlay.querySelectorAll(".ob-step").forEach((s) => s.classList.remove("active"));
      stepEl(step).classList.add("active");
      bar.style.width = Math.round((step / TOTAL) * 100) + "%";
      stepNum.textContent = step;
      backBtn.style.display = step === 1 ? "none" : "";
      nextBtn.textContent = step === TOTAL ? "Terminar 🚀" : "Siguiente";
      errEl.style.display = "none";
    }
    function fail(msg) { errEl.textContent = msg; errEl.style.display = "block"; return false; }
    function goalValue() {
      return goalIsFree ? $("#obGoalText").value.trim() : (answers.goal || "");
    }
    function validate() {
      if (step === 1 && !goalValue()) return fail(goalIsFree ? "Escribe cuál es tu objetivo." : "Elige tu objetivo.");
      if (step === 2) {
        const v = parseInt($("#obAge").value, 10);
        if (!(v >= 10 && v <= 100)) return fail("Escribe tu edad (entre 10 y 100 años).");
      }
      if (step === 3 && !answers.sex) return fail("Elige una opción.");
      if (step === 4) {
        const v = parseFloat($("#obWeightCurrent").value);
        if (!(v >= 25 && v <= 350)) return fail("Escribe un peso válido (kg).");
      }
      if (step === 5) {
        const v = parseFloat($("#obHeight").value);
        if (!(v >= 100 && v <= 250)) return fail("Escribe tu altura en centímetros (100-250).");
      }
      if (step === 6) {
        const v = parseFloat($("#obWeightGoal").value);
        if (!(v >= 25 && v <= 350)) return fail("Escribe tu peso objetivo (kg).");
      }
      if (step === 7 && !answers.experience_level) return fail("Elige tu nivel de experiencia.");
      if (step === 8 && !answers.training_frequency) return fail("Elige cuántos días quieres entrenar.");
      // paso 9 es opcional
      return true;
    }
    async function finish() {
      nextBtn.disabled = true; nextBtn.textContent = "Guardando…";
      try {
        await api.saveOnboarding({
          goal: goalValue(),
          age: parseInt($("#obAge").value, 10),
          sex: answers.sex,
          height: parseFloat($("#obHeight").value),
          weight_current: parseFloat($("#obWeightCurrent").value),
          weight_goal: parseFloat($("#obWeightGoal").value),
          experience: answers.experience_level,
          frequency: parseInt(answers.training_frequency, 10),
          injuries: $("#obInjuries").value.trim(),
          target_date: $("#obTargetDate").value || null,
          motivation: $("#obMotivation").value.trim(),
        });
        STUDENT.onboarding_completed_at = new Date().toISOString();
        STUDENT.goal = goalValue();
        STUDENT.age = parseInt($("#obAge").value, 10);
        STUDENT.sex = answers.sex;
        STUDENT.height = parseFloat($("#obHeight").value);
        STUDENT.weight_current = parseFloat($("#obWeightCurrent").value);
        STUDENT.weight_goal = parseFloat($("#obWeightGoal").value);
        overlay.classList.add("hidden");
        paintHome();
        loadMyObjectives();
        toast("¡Listo! Tu coach ya tiene tus objetivos 🎯", "ok");
      } catch (ex) {
        nextBtn.disabled = false; nextBtn.textContent = "Terminar 🚀";
        errToast(ex, "No se pudo guardar. Inténtalo de nuevo.");
      }
    }

    nextBtn.addEventListener("click", () => {
      if (!validate()) return;
      if (step === TOTAL) { finish(); return; }
      step++; render();
    });
    backBtn.addEventListener("click", () => { if (step > 1) { step--; render(); } });

    overlay.classList.remove("hidden");
    render();
  }

  async function init() {
    const auth = await window.msfAuth.requireRole("alumno");
    if (!auth) return;
    PROFILE = auth.profile;
    if (!PROFILE.coach_id) {
      toast("Tu cuenta no está vinculada a ningún coach todavía", "info");
      return;
    }
    const { data: student, error } = await window.msfSupabase
      .from("students")
      .select("*")
      .eq("profile_id", PROFILE.id)
      .maybeSingle();
    if (!error && student) STUDENT = student;

    // Perfil del coach: nombre real en el chat + herencia de su plan
    try {
      const { data: coach } = await window.msfSupabase
        .from("profiles").select("full_name, plan").eq("id", PROFILE.coach_id).maybeSingle();
      if (coach) {
        $("#chatCoachName") && ($("#chatCoachName").textContent = coach.full_name);
        applyCoachPlan(coach.plan);
      } else {
        applyCoachPlan(await api.myCoachPlan());
      }
    } catch (ex) {
      console.error("No se pudo cargar el perfil del coach:", ex);
      try { applyCoachPlan(await api.myCoachPlan()); } catch (_) {}
    }

    maybeShowOnboarding();
    loadMyObjectives();
    paintHome();
    animateRing();
    loadAttendance();
    loadRoutine();
    loadWeightHistory();
    loadPendingPayment();
    loadWeekStats();
    renderPhotoTimeline();
    subscribeRealtime();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
