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
  function errToast(e, fallback) { toast(fallback + (e?.message ? ": " + e.message : ""), "info"); }

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
        btn.textContent = `Pago pendiente · $${Number(data[0].amount).toLocaleString("es-MX")} — Hablar con tu coach`;
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
        const rows = await api.listAttendance(STUDENT.id, new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10), todayStr());
        const attended = rows.filter((r) => r.attending);
        const thisWeek = attended.filter((r) => r.date >= weekAgo).length;
        $("#wkTrainings") && ($("#wkTrainings").textContent = thisWeek);
        // Racha: días consecutivos con asistencia, contando hacia atrás desde hoy/ayer
        const days = new Set(attended.map((r) => r.date));
        let streak = 0;
        let cursor = new Date();
        if (!days.has(todayStr())) cursor = new Date(Date.now() - 86400000);
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

  /* ---------- Asistencia diaria (solo alumnos presenciales) ---------- */
  const todayStr = () => new Date().toISOString().slice(0, 10);
  async function loadAttendance() {
    const card = $("#attendanceCard");
    if (!card || !STUDENT || STUDENT.training_type !== "Presencial") return;
    card.classList.remove("hidden");
    try {
      const rows = await api.listAttendance(STUDENT.id, todayStr(), todayStr());
      if (rows.length) paintAttendanceDone(rows[0]);
    } catch (ex) { console.error("No se pudo consultar la asistencia de hoy:", ex); }
  }
  function paintAttendanceDone(row) {
    $("#attendanceBtns")?.classList.add("hidden");
    $("#attendanceReasonBox")?.classList.add("hidden");
    const st = $("#attendanceStatus");
    if (st) {
      st.innerHTML = row.attending
        ? `<span class="badge badge--ok">Confirmado · Sí vas hoy 💪</span>`
        : `<span class="badge badge--late">Hoy no vas</span> <span class="t3">${row.reason ? "· " + api.esc(row.reason) : ""}</span>`;
    }
  }
  async function saveAttendance(attending, reason) {
    try {
      const row = await api.setAttendance(STUDENT.id, todayStr(), attending, reason);
      paintAttendanceDone(row);
      toast(attending ? "¡Tu coach ya sabe que vas! 🔥" : "Avisamos a tu coach", "ok");
    } catch (ex) { errToast(ex, "No se pudo guardar tu respuesta"); }
  }
  $("#btnAttendYes")?.addEventListener("click", () => saveAttendance(true, null));
  $("#btnAttendNo")?.addEventListener("click", () => {
    $("#attendanceReasonBox")?.classList.remove("hidden");
  });
  $("#btnAttendSendNo")?.addEventListener("click", () => {
    const reason = $("#attendanceReason")?.value.trim();
    saveAttendance(false, reason || null);
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
        card.innerHTML = `<div class="row gap-3 mb-4"><div class="avatar avatar--md">${api.initials(p.profiles?.full_name)}</div><div><div class="fw-600">${api.esc(p.profiles?.full_name || "Coach")}</div><div class="t3 text-sm">${new Date(p.created_at).toLocaleString("es-MX")}</div></div></div>
          <p style="margin-bottom:12px">${api.esc(p.body)}</p>
          <div class="row gap-3 mt-4"><button class="pill js-react ${liked ? "is-active" : ""}" data-post="${p.id}" data-liked="${liked}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1a5.5 5.5 0 0 0-7.8 7.8l9 9 9-9a5.5 5.5 0 0 0 0-7.8z"/></svg><span>${p.community_likes.length}</span></button><button class="pill">💬 ${p.community_comments.length}</button></div>`;
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
    if (!r || !PROFILE) return;
    const liked = r.dataset.liked === "true";
    try {
      await api.toggleLike(r.dataset.post, PROFILE.id, liked);
      renderCommunity();
    } catch (ex) { errToast(ex, "No se pudo procesar el like"); }
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

  /* Realtime: nuevos mensajes del coach llegan sin recargar */
  function subscribeRealtime() {
    if (!STUDENT || !window.msfSupabase) return;
    window.msfSupabase
      .channel("alumno-msgs-" + STUDENT.id)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `student_id=eq.${STUDENT.id}` },
        (payload) => {
          if ($("#a-chat")?.classList.contains("is-active")) loadChat();
          else if (payload.new.sender_id !== PROFILE.id) toast("Nuevo mensaje de tu coach 💬", "info");
        })
      .subscribe();
  }

  /* ---------- Init ---------- */
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

    // Perfil del coach: nombre real en el chat + gating de comunidad según su plan
    try {
      const { data: coach } = await window.msfSupabase
        .from("profiles").select("full_name, plan").eq("id", PROFILE.coach_id).maybeSingle();
      if (coach) {
        $("#chatCoachName") && ($("#chatCoachName").textContent = coach.full_name);
        if (!api.planFeatures(coach.plan).community) {
          $$('[data-anav="comunidad"]').forEach((b) => b.remove());
        }
      }
    } catch (ex) { console.error("No se pudo cargar el perfil del coach:", ex); }

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
