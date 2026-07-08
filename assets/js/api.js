/* Capa de acceso a datos — todas las lecturas/escrituras a Supabase
   pasan por aquí. app.js (coach) y alumno.js (alumno) consumen esto. */
window.msfApi = (function () {
  "use strict";
  const sb = () => window.msfSupabase;
  const initials = (name) => (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("");
  // Escapa texto de usuario antes de interpolarlo en innerHTML (previene XSS almacenado).
  const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (str) => String(str ?? "").replace(/[&<>"']/g, (c) => ESC_MAP[c]);

  /* Parsea montos en MXN aceptando cualquier formato razonable: "1000",
     "1,000", "1 000", "1000.00", "1000,00". Regla para desambiguar el
     último separador: si le siguen exactamente 3 dígitos es de miles
     (se descarta), si le siguen 1-2 dígitos es el decimal. */
  function parseMoneyMXN(raw) {
    if (raw == null) return null;
    let s = String(raw).trim().replace(/[^\d.,]/g, "");
    if (s === "") return null;
    const lastSep = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
    let n;
    if (lastSep === -1) {
      n = Number(s);
    } else {
      const intPart = s.slice(0, lastSep).replace(/[.,]/g, "");
      const fracPart = s.slice(lastSep + 1).replace(/[.,]/g, "");
      n = fracPart.length === 3 ? Number(intPart + fracPart) : Number((intPart || "0") + "." + fracPart);
    }
    return Number.isFinite(n) ? n : null;
  }
  const formatMoneyMXN = (n) => (n == null || !Number.isFinite(n) ? "" : n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  /* Traduce errores técnicos (Auth/BD/red) a mensajes de marca en español.
     El detalle técnico NUNCA se muestra al usuario: va solo a console.error. */
  function friendlyError(ex) {
    const m = ex?.message || "";
    if (ex?._planLimit || /PLAN_LIMIT/.test(m)) return "Alcanzaste el límite de alumnos de tu plan. Mejora tu plan para agregar más.";
    if (/invalid login credentials/i.test(m)) return "Email o contraseña incorrectos.";
    if (/email not confirmed/i.test(m)) return "Confirma tu correo antes de iniciar sesión.";
    if (/rate limit|too many requests/i.test(m)) return "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.";
    if (/already registered|already been registered|duplicate key/i.test(m)) return "Ese registro ya existe.";
    if (/at least 6 characters|password/i.test(m) && /weak|short|characters/i.test(m)) return "La contraseña debe tener al menos 6 caracteres.";
    if (/jwt|token|session|expired/i.test(m)) return "Tu sesión expiró. Vuelve a iniciar sesión.";
    if (/failed to fetch|networkerror|network request failed|load failed/i.test(m)) return "Sin conexión. Revisa tu internet e inténtalo de nuevo.";
    if (/violates row-level security|permission denied|not authorized/i.test(m)) return "No tienes permiso para hacer eso.";
    if (/violates foreign key|violates check constraint|invalid input syntax/i.test(m)) return "Los datos no son válidos. Revisa el formulario.";
    if (/payload too large|exceeded the maximum allowed size/i.test(m)) return "El archivo es demasiado grande.";
    return ""; // sin traducción conocida: el llamador muestra solo su mensaje base
  }

  /* ---------- Sistema central de capacidades por plan ----------
     ÚNICA fuente de verdad en el frontend. Ningún módulo debe escribir su
     propio "if (plan === ...)" — todos preguntan aquí (api.can(feature, plan)).
     Debe coincidir exactamente con la función `plan_features()` en la BD:
     esa es la que de verdad protege (RLS); esto solo evita parpadeos de UI.
     El coach contrata el plan; el alumno SIEMPRE hereda el de su coach
     (nunca tiene plan propio, nunca ve precios ni Stripe). */
  const PLAN_LIMITS = { "Free": 30, "Star": 100, "Star Plus": 300, "Kings": 500 };
  const PLAN_FEATURES = {
    "Free":      { messages: false, objectives: false, photos: false, community: false, routines: false },
    "Star":      { messages: true,  objectives: true,  photos: true,  community: false, routines: false },
    "Star Plus": { messages: true,  objectives: true,  photos: true,  community: true,  routines: true },
    "Kings":     { messages: true,  objectives: true,  photos: true,  community: true,  routines: true },
  };
  const PLAN_PRICES = { "Free": "$0", "Star": "$500 MXN", "Star Plus": "$1,000 MXN" };
  function planLimit(plan) { return PLAN_LIMITS[plan] ?? PLAN_LIMITS["Free"]; }
  function planFeatures(plan) { return PLAN_FEATURES[plan] ?? PLAN_FEATURES["Free"]; }
  function planPrice(plan) { return PLAN_PRICES[plan] ?? ""; }
  // Único punto de consulta de una capacidad puntual: api.can("messages", plan).
  function can(feature, plan) { return !!planFeatures(plan)[feature]; }
  // Plan efectivo del usuario actual: el suyo si es coach, el de su coach si es alumno.
  async function myCoachPlan() {
    const { data, error } = await sb().rpc("my_coach_plan");
    if (error) throw error;
    return data || "Free";
  }
  async function countStudents(coachId) {
    const { count, error } = await sb().from("students").select("id", { count: "exact", head: true }).eq("coach_id", coachId);
    if (error) throw error;
    return count ?? 0;
  }

  /* ---------- Students ---------- */
  async function listStudents(coachId) {
    // students_with_state agrega display_state (activo/suspendido/sin_iniciar_sesion),
    // calculado en la BD a partir del último login y la última actividad real.
    const { data, error } = await sb().from("students_with_state").select("*").eq("coach_id", coachId).order("full_name");
    if (error) throw error;
    return data.map((s) => ({ ...s, initials: initials(s.full_name) }));
  }
  async function createStudent(coachId, payload) {
    const { data, error } = await sb().from("students").insert({ coach_id: coachId, ...payload }).select().single();
    if (error) throw error;
    return data;
  }
  /* Alta completa de alumno: (1) crea su cuenta de auth si viene email+password,
     (2) inserta la fila de negocio con TODOS los datos, (3) genera el pago de
     membresía si hay monto+fecha fin. Todo enlazado y sincronizado.
     `data` acepta: full_name, email, password, phone, goal, training_type,
     weight_current, weight_goal, private_notes, member_since, membership_end,
     payment_amount, state. */
  async function createStudentFull(coachId, data) {
    // Límite del plan: se valida aquí para avisar antes de crear la cuenta
    // de auth; la BD tiene un trigger que lo respalda de todas formas.
    const [{ data: prof }, current] = await Promise.all([
      sb().from("profiles").select("plan").eq("id", coachId).single(),
      countStudents(coachId),
    ]);
    const limit = planLimit(prof?.plan);
    if (current >= limit) {
      const err = new Error(`Tu plan ${prof?.plan || "Free"} permite máximo ${limit} alumnos. Actualiza tu plan para seguir creciendo.`);
      err._planLimit = true;
      throw err;
    }
    let profileId = null;
    if (data.email && data.password) {
      try {
        profileId = await window.msfAuth.createStudentAccount(data.email, data.password, data.full_name, coachId);
      } catch (e) {
        // Si el email ya existe u otro fallo de auth, seguimos creando la ficha
        // de negocio sin cuenta vinculada, avisando al llamador.
        e._authOnly = true;
        throw e;
      }
    }
    const payload = {
      coach_id: coachId,
      profile_id: profileId,
      full_name: data.full_name,
      email: data.email || null,
      phone: data.phone || null,
      goal: data.goal || null,
      training_type: data.training_type || "Online",
      weight_current: data.weight_current ?? null,
      weight_goal: data.weight_goal ?? null,
      private_notes: data.private_notes || null,
      member_since: data.member_since || null,
      membership_end: data.membership_end || null,
      state: data.state || "pendiente",
    };
    const { data: student, error } = await sb().from("students").insert(payload).select().single();
    if (error) throw error;

    // Pago de membresía sincronizado con la sección de Pagos
    if (data.payment_amount && Number(data.payment_amount) > 0) {
      await sb().from("payments").insert({
        coach_id: coachId,
        student_id: student.id,
        concept: "Membresía",
        amount: Number(data.payment_amount),
        due_date: data.membership_end || new Date().toISOString().slice(0, 10),
        state: data.pay_state === "ok" ? "ok" : "pend",
        paid_at: data.pay_state === "ok" ? new Date().toISOString() : null,
      });
    }
    return { ...student, initials: initials(student.full_name) };
  }

  async function updateStudent(id, patch) {
    const { data, error } = await sb().from("students").update(patch).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }
  async function deleteStudent(id) {
    const { data: { session } } = await sb().auth.getSession();
    const r = await fetch("/api/delete-student", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: session?.access_token, student_id: id }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "No se pudo eliminar al alumno");
  }

  /* ---------- Payments ---------- */
  async function listPayments(coachId) {
    const { data, error } = await sb()
      .from("payments")
      .select("*, students(full_name)")
      .eq("coach_id", coachId)
      .order("due_date");
    if (error) throw error;
    return data.map((p) => ({ ...p, student_name: p.students?.full_name, initials: initials(p.students?.full_name) }));
  }
  async function markPaymentPaid(id) {
    const { data, error } = await sb()
      .from("payments")
      .update({ state: "ok", paid_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  async function createPayment(coachId, payload) {
    const { data, error } = await sb().from("payments").insert({ coach_id: coachId, ...payload }).select().single();
    if (error) throw error;
    return data;
  }
  // Edición individual de un pago (monto/fecha/concepto/vencimiento/estado/notas).
  // Si se marca como pagado y no traía paid_at, se sella con la fecha actual;
  // si se saca de "ok", se limpia paid_at para que deje de contar como cobrado.
  async function updatePayment(id, patch) {
    const clean = { ...patch };
    if (clean.state === "ok" && !clean.paid_at) clean.paid_at = new Date().toISOString();
    if (clean.state && clean.state !== "ok") clean.paid_at = null;
    const { data, error } = await sb().from("payments").update(clean).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }

  // #6 El alumno registra en su onboarding cuánto le pagó al coach → crea el
  // primer pago (ya cobrado) y notifica al coach. Vía RPC porque el alumno no
  // puede insertar en payments directamente (RLS).
  async function recordOnboardingPayment(amount) {
    const { error } = await sb().rpc("record_onboarding_payment", { p_amount: amount });
    if (error) throw error;
  }

  // #11 Sube la foto/logo del coach al bucket público 'avatars' y guarda su URL
  // en profiles.avatar_url (visible para sus alumnos). Devuelve la URL pública.
  async function uploadCoachAvatar(file) {
    const { data: { session } } = await sb().auth.getSession();
    const uid = session?.user?.id;
    if (!uid) throw new Error("Sesión no válida");
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${uid}/avatar_${Date.now()}.${ext}`;
    const { error: upErr } = await sb().storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) throw upErr;
    const { data: pub } = sb().storage.from("avatars").getPublicUrl(path);
    const url = pub?.publicUrl;
    const { error } = await sb().from("profiles").update({ avatar_url: url }).eq("id", uid);
    if (error) throw error;
    return url;
  }

  // #12 Preferencias visuales guardadas en la cuenta (no solo en el
  // dispositivo): se sincronizan al iniciar sesión en cualquier dispositivo.
  async function saveThemePrefs(prefs) {
    const { data: { session } } = await sb().auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return;
    const patch = {};
    if (prefs && prefs.mode) patch.theme_mode = prefs.mode;
    if (prefs && prefs.accent) patch.accent_color = prefs.accent;
    if (!Object.keys(patch).length) return;
    const { error } = await sb().from("profiles").update(patch).eq("id", uid);
    if (error) throw error;
  }

  /* ---------- Routines ---------- */
  async function getStudentRoutine(studentId) {
    const { data: routine, error } = await sb()
      .from("routines")
      .select("*")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!routine) return null;
    const { data: days, error: e2 } = await sb()
      .from("routine_days")
      .select("*, routine_exercises(*)")
      .eq("routine_id", routine.id)
      .order("sort_order");
    if (e2) throw e2;
    return { ...routine, days: (days || []).map((d) => ({ ...d, exercises: (d.routine_exercises || []).sort((a, b) => a.sort_order - b.sort_order) })) };
  }
  async function createRoutine(coachId, studentId, payload) {
    const { data, error } = await sb().from("routines").insert({ coach_id: coachId, student_id: studentId, ...payload }).select().single();
    if (error) throw error;
    return data;
  }
  async function saveRoutineDay(routineId, dayName, label, exercises, sortOrder) {
    let { data: day, error } = await sb()
      .from("routine_days")
      .upsert({ routine_id: routineId, day_name: dayName, label, sort_order: sortOrder }, { onConflict: "routine_id,day_name" })
      .select()
      .single();
    if (error) throw error;
    await sb().from("routine_exercises").delete().eq("routine_day_id", day.id);
    if (exercises.length) {
      const rows = exercises.map((ex, i) => ({ routine_day_id: day.id, ...ex, sort_order: i }));
      const { error: e2 } = await sb().from("routine_exercises").insert(rows);
      if (e2) throw e2;
    }
    return day;
  }

  /* ---------- Follow-ups ---------- */
  async function listFollowUps(coachId) {
    const { data, error } = await sb().from("follow_ups").select("*, students(full_name)").eq("coach_id", coachId).order("due_at");
    if (error) throw error;
    return data;
  }
  async function toggleFollowUp(id, isDone) {
    const { error } = await sb().from("follow_ups").update({ is_done: isDone }).eq("id", id);
    if (error) throw error;
  }
  async function createFollowUp(coachId, studentId, payload) {
    const { error } = await sb().from("follow_ups").insert({ coach_id: coachId, student_id: studentId, ...payload });
    if (error) throw error;
  }

  /* ---------- Weight logs ---------- */
  async function listWeightLogs(studentId) {
    const { data, error } = await sb().from("weight_logs").select("*").eq("student_id", studentId).order("logged_at");
    if (error) throw error;
    return data;
  }
  async function addWeightLog(studentId, weight) {
    const { error } = await sb().from("weight_logs").insert({ student_id: studentId, weight });
    if (error) throw error;
    await sb().from("students").update({ weight_current: weight }).eq("id", studentId);
  }

  /* ---------- Progress photos (Supabase Storage, bucket privado) ---------- */
  const SIGNED_TTL = 3600; // 1h de validez para las URLs firmadas

  /* Comprime una imagen en el navegador antes de subirla: la reescala a
     máx. `maxDim` px por lado y la reencoda como JPEG. Devuelve un Blob.
     Si algo falla, cae de vuelta al archivo original. */
  async function compressImage(file, maxDim = 1280, quality = 0.8) {
    if (!file.type.startsWith("image/")) return file;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
      const w = Math.round(bitmap.width * scale);
      const h = Math.round(bitmap.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
      const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
      return blob && blob.size < file.size ? blob : file;
    } catch (_) { return file; }
  }

  async function uploadProgressPhoto(studentId, file) {
    const blob = await compressImage(file);
    const path = `${studentId}/${Date.now()}.jpg`;
    const { error: upErr } = await sb().storage.from("progress").upload(path, blob, {
      cacheControl: "3600", upsert: false, contentType: "image/jpeg",
    });
    if (upErr) throw upErr;
    const { data, error } = await sb().from("progress_photos")
      .insert({ student_id: studentId, path })
      .select().single();
    if (error) throw error;
    const { data: signed } = await sb().storage.from("progress").createSignedUrl(path, SIGNED_TTL);
    return { ...data, url: signed?.signedUrl || null };
  }

  async function listProgressPhotos(studentId) {
    const { data, error } = await sb().from("progress_photos")
      .select("*").eq("student_id", studentId).order("taken_at", { ascending: true });
    if (error) throw error;
    if (!data.length) return [];
    const paths = data.map((p) => p.path).filter(Boolean);
    const { data: signed } = await sb().storage.from("progress").createSignedUrls(paths, SIGNED_TTL);
    const urlByPath = {};
    (signed || []).forEach((s) => { if (s.path) urlByPath[s.path] = s.signedUrl; });
    return data.map((p) => ({ ...p, url: urlByPath[p.path] || null }));
  }

  /* ---------- Referidos ---------- */
  async function getReferralInfo(coachId) {
    const { data: prof, error } = await sb().from("profiles").select("referral_code").eq("id", coachId).single();
    if (error) throw error;
    const { data: refs, error: e2 } = await sb()
      .from("referrals")
      .select("*, referred:profiles!referrals_referred_id_fkey(full_name, email, created_at)")
      .eq("referrer_id", coachId)
      .order("created_at", { ascending: false });
    if (e2) throw e2;
    return { code: prof?.referral_code || null, referrals: refs || [] };
  }

  /* ---------- Encuesta diaria ----------
     Presencial: responde para MAÑANA (¿asistirás?) con horario si es sí, o
     motivo si es no. Online: responde para HOY (¿entrenaste?) mismo esquema.
     Sin fila = sin responder. El coach ve la lista hasta "Reiniciar Día". */
  async function saveDailySurvey(studentId, coachId, attendDate, { response, scheduled_time, reason }) {
    await sb().from("attendance").delete().eq("student_id", studentId).eq("attend_date", attendDate);
    const { data, error } = await sb().from("attendance").insert({
      student_id: studentId, coach_id: coachId, attend_date: attendDate, archived: false,
      response, scheduled_time: scheduled_time || null, reason: reason || null,
    }).select().single();
    if (error) throw error;
    return data;
  }
  async function cancelAttendance(studentId, attendDate) {
    const { error } = await sb()
      .from("attendance").delete()
      .eq("student_id", studentId).eq("attend_date", attendDate);
    if (error) throw error;
  }
  // ¿El alumno ya respondió (activo) para esa fecha?
  async function myAttendance(studentId, attendDate) {
    const { data, error } = await sb()
      .from("attendance").select("*")
      .eq("student_id", studentId).eq("attend_date", attendDate).eq("archived", false)
      .maybeSingle();
    if (error) throw error;
    return data;
  }
  // Respuestas activas de los alumnos del coach (lista del ciclo actual).
  async function listCoachAttendance() {
    const { data, error } = await sb()
      .from("attendance")
      .select("attend_date, created_at, response, scheduled_time, reason, students!inner(id, full_name, training_type)")
      .eq("archived", false)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data || [];
  }
  async function resetAttendanceDay() {
    const { error } = await sb().rpc("reset_attendance_day");
    if (error) throw error;
  }
  /* ---------- Catálogo de objetivos del coach ---------- */
  async function listObjectives(coachId) {
    const { data, error } = await sb().from("coach_objectives")
      .select("*").eq("coach_id", coachId).order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }
  // Catálogo de sistema (5 fijos, todos los planes) + objetivos personalizados del coach (Star+).
  async function listCatalogAndCustom(coachId) {
    const { data, error } = await sb().from("coach_objectives")
      .select("*").or(`is_system.eq.true,coach_id.eq.${coachId}`)
      .order("is_system", { ascending: false }).order("title");
    if (error) throw error;
    return data || [];
  }
  async function listSystemObjectives() {
    const { data, error } = await sb().from("coach_objectives")
      .select("*").eq("is_system", true).order("title");
    if (error) throw error;
    return data || [];
  }
  async function createObjective(coachId, title, description, goalType) {
    const { data, error } = await sb().from("coach_objectives")
      .insert({ coach_id: coachId, title, description: description || null, goal_type: goalType || null })
      .select().single();
    if (error) throw error;
    return data;
  }
  async function deleteObjective(id) {
    const { error } = await sb().from("coach_objectives").delete().eq("id", id);
    if (error) throw error;
  }
  // Asignaciones de un alumno (con el objetivo embebido).
  async function listStudentObjectives(studentId) {
    const { data, error } = await sb().from("student_objectives")
      .select("*, coach_objectives(title, description, goal_type, is_system)")
      .eq("student_id", studentId).order("assigned_at", { ascending: true });
    if (error) throw error;
    return data || [];
  }
  // Objetivo de catálogo (Free) actualmente activo del alumno, si existe.
  async function getCatalogObjective(studentId) {
    const rows = await listStudentObjectives(studentId);
    const catalogRows = rows.filter((r) => r.coach_objectives?.is_system);
    return catalogRows.length ? catalogRows[catalogRows.length - 1] : null;
  }
  async function assignObjective(studentId, objectiveId, coachId) {
    const { error } = await sb().from("student_objectives")
      .upsert({ student_id: studentId, objective_id: objectiveId, coach_id: coachId },
              { onConflict: "student_id,objective_id" });
    if (error) throw error;
  }
  async function unassignObjective(studentId, objectiveId) {
    const { error } = await sb().from("student_objectives")
      .delete().eq("student_id", studentId).eq("objective_id", objectiveId);
    if (error) throw error;
  }
  async function setObjectiveStatus(id, status) {
    const { error } = await sb().from("student_objectives").update({ status }).eq("id", id);
    if (error) throw error;
  }
  // Alumno autoservicio: cambia entre los 5 objetivos de catálogo (disponible en todos los planes).
  async function setCatalogObjective(objectiveId) {
    const { data, error } = await sb().rpc("set_catalog_objective", { p_objective_id: objectiveId });
    if (error) throw error;
    return data;
  }

  // Guarda el onboarding del alumno (una sola vez) vía RPC segura.
  // La BD valida los campos obligatorios (edad, sexo, altura, peso, objetivo…).
  async function saveOnboarding(a) {
    const { error } = await sb().rpc("save_onboarding", {
      p_goal: a.goal,
      p_age: a.age ?? null,
      p_sex: a.sex ?? null,
      p_height: a.height ?? null,
      p_weight_current: a.weight_current ?? null,
      p_weight_goal: a.weight_goal ?? null,
      p_experience: a.experience ?? null,
      p_frequency: a.frequency ?? null,
      p_injuries: a.injuries ?? null,
      p_target_date: a.target_date ?? null,
      p_motivation: a.motivation ?? null,
    });
    if (error) throw error;
  }
  // Fechas confirmadas por el alumno (para racha/entrenos), desde `fromDate`.
  async function listMyAttendance(studentId, fromDate) {
    let q = sb().from("attendance").select("attend_date")
      .eq("student_id", studentId).order("attend_date", { ascending: false });
    if (fromDate) q = q.gte("attend_date", fromDate);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  /* ---------- Finanzas (KPIs reales a partir de pagos) ---------- */
  function financeKpis(payments) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const paid = payments.filter((p) => p.state === "ok");
    const paidThisMonth = paid.filter((p) => p.paid_at && new Date(p.paid_at) >= monthStart);
    const pending = payments.filter((p) => p.state !== "ok");
    const overdue = pending.filter((p) => new Date(p.due_date) < new Date(now.toDateString()));
    const sum = (arr) => arr.reduce((s, p) => s + Number(p.amount), 0);
    return {
      collectedMonth: sum(paidThisMonth),
      collectedTotal: sum(paid),
      pendingAmount: sum(pending),
      overdueAmount: sum(overdue),
      pendingCount: pending.length,
      overdueCount: overdue.length,
      avgTicket: paid.length ? Math.round(sum(paid) / paid.length) : 0,
      /* Ingresos cobrados por mes (últimos 12) para el gráfico */
      monthly: (() => {
        const buckets = [];
        for (let i = 11; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
          buckets.push({
            label: d.toLocaleDateString("es-MX", { month: "short" }),
            total: sum(paid.filter((p) => p.paid_at && new Date(p.paid_at) >= d && new Date(p.paid_at) < end)),
          });
        }
        return buckets;
      })(),
    };
  }

  /* Ingresos cobrados agregados por periodo, para el dashboard con filtros
     rápidos (hoy/ayer/7d/3m/6m/1año). Devuelve total, nº de cobros, promedio
     por cobro y una serie de buckets para dibujar la gráfica. "1y" equivale a
     los últimos 12 meses (comportamiento por defecto histórico). */
  function financeByPeriod(payments, period) {
    const paid = (payments || []).filter((p) => p.state === "ok" && p.paid_at);
    const now = new Date();
    const sum = (arr) => arr.reduce((s, p) => s + Number(p.amount), 0);
    const inRange = (a, b) => paid.filter((p) => { const t = new Date(p.paid_at); return t >= a && t < b; });
    const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const buckets = [];
    if (period === "today" || period === "yesterday") {
      const base = new Date(d0); if (period === "yesterday") base.setDate(base.getDate() - 1);
      for (let h = 0; h < 24; h++) {
        const a = new Date(base); a.setHours(h, 0, 0, 0);
        const b = new Date(base); b.setHours(h + 1, 0, 0, 0);
        buckets.push({ label: h % 6 === 0 ? h + "h" : "", items: inRange(a, b) });
      }
    } else if (period === "7d") {
      for (let i = 6; i >= 0; i--) {
        const a = new Date(d0); a.setDate(a.getDate() - i);
        const b = new Date(a); b.setDate(b.getDate() + 1);
        buckets.push({ label: a.toLocaleDateString("es-MX", { weekday: "short" }), items: inRange(a, b) });
      }
    } else if (period === "3m") {
      const startW = new Date(d0); startW.setDate(startW.getDate() - 12 * 7);
      for (let i = 0; i < 13; i++) {
        const a = new Date(startW); a.setDate(a.getDate() + i * 7);
        const b = new Date(a); b.setDate(b.getDate() + 7);
        buckets.push({ label: i % 3 === 0 ? a.toLocaleDateString("es-MX", { day: "2-digit", month: "short" }) : "", items: inRange(a, b) });
      }
    } else {
      const n = period === "6m" ? 6 : 12;
      for (let i = n - 1; i >= 0; i--) {
        const a = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const b = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        buckets.push({ label: a.toLocaleDateString("es-MX", { month: "short" }), items: inRange(a, b) });
      }
    }
    const all = buckets.reduce((acc, x) => acc.concat(x.items), []);
    const total = sum(all);
    return {
      total, count: all.length,
      avg: all.length ? Math.round(total / all.length) : 0,
      series: buckets.map((x) => ({ label: x.label, total: sum(x.items) })),
    };
  }

  /* ---------- Community ---------- */
  async function listCommunityPosts(coachId) {
    const { data, error } = await sb()
      .from("community_posts")
      .select("*, profiles!community_posts_author_id_fkey(full_name, avatar_initials), community_likes(profile_id), community_comments(id, body, author_id, created_at, profiles(full_name))")
      .eq("coach_id", coachId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }
  async function createCommunityPost(coachId, authorId, body) {
    const { error } = await sb().from("community_posts").insert({ coach_id: coachId, author_id: authorId, body });
    if (error) throw error;
  }
  async function toggleLike(postId, profileId, liked) {
    if (liked) {
      const { error } = await sb().from("community_likes").delete().eq("post_id", postId).eq("profile_id", profileId);
      if (error) throw error;
    } else {
      const { error } = await sb().from("community_likes").insert({ post_id: postId, profile_id: profileId });
      if (error) throw error;
    }
  }
  async function addComment(postId, authorId, body) {
    const { error } = await sb().from("community_comments").insert({ post_id: postId, author_id: authorId, body });
    if (error) throw error;
  }

  /* ---------- Messages ---------- */
  async function listConversations(coachId) {
    const { data, error } = await sb().from("students").select("id, full_name").eq("coach_id", coachId).order("full_name");
    if (error) throw error;
    return data;
  }
  async function listMessages(coachId, studentId) {
    const { data, error } = await sb()
      .from("messages")
      .select("*")
      .eq("coach_id", coachId)
      .eq("student_id", studentId)
      .order("created_at");
    if (error) throw error;
    return data;
  }
  async function sendMessage(coachId, studentId, senderId, body) {
    const { error } = await sb().from("messages").insert({ coach_id: coachId, student_id: studentId, sender_id: senderId, body });
    if (error) throw error;
  }

  /* ---------- Notificaciones ---------- */
  async function listNotifications(coachId) {
    const { data, error } = await sb().from("notifications")
      .select("*").eq("coach_id", coachId).eq("recipient", "coach").order("created_at", { ascending: false }).limit(30);
    if (error) throw error;
    return data || [];
  }
  async function listStudentNotifications(studentId) {
    const { data, error } = await sb().from("notifications")
      .select("*").eq("student_id", studentId).eq("recipient", "student").order("created_at", { ascending: false }).limit(30);
    if (error) throw error;
    return data || [];
  }
  async function markNotificationRead(id) {
    const { error } = await sb().from("notifications").update({ read: true }).eq("id", id);
    if (error) throw error;
  }

  return {
    initials, esc, friendlyError,
    parseMoneyMXN, formatMoneyMXN,
    planLimit, planFeatures, planPrice, can, myCoachPlan, countStudents,
    getReferralInfo,
    saveDailySurvey, cancelAttendance, myAttendance, listCoachAttendance, resetAttendanceDay, listMyAttendance,
    saveOnboarding,
    listObjectives, createObjective, deleteObjective,
    listCatalogAndCustom, listSystemObjectives, getCatalogObjective, setCatalogObjective,
    listStudentObjectives, assignObjective, unassignObjective, setObjectiveStatus,
    financeKpis,
    financeByPeriod,
    listStudents, createStudent, createStudentFull, updateStudent, deleteStudent,
    listStudentNotifications,
    listPayments, markPaymentPaid, createPayment, updatePayment,
    saveThemePrefs, recordOnboardingPayment, uploadCoachAvatar,
    getStudentRoutine, createRoutine, saveRoutineDay,
    listFollowUps, toggleFollowUp, createFollowUp,
    listWeightLogs, addWeightLog,
    uploadProgressPhoto, listProgressPhotos,
    listCommunityPosts, createCommunityPost, toggleLike, addComment,
    listConversations, listMessages, sendMessage,
    listNotifications, markNotificationRead,
  };
})();
