/* Capa de acceso a datos — todas las lecturas/escrituras a Supabase
   pasan por aquí. app.js (coach) y alumno.js (alumno) consumen esto. */
window.msfApi = (function () {
  "use strict";
  const sb = () => window.msfSupabase;
  const initials = (name) => (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("");

  /* ---------- Planes ---------- */
  const PLAN_LIMITS = { "Star": 30, "Star Plus": 100, "Kings": 500 };
  // Qué features incluye cada plan; la UI se bloquea con esto y la BD
  // respalda el límite de alumnos con su propio trigger.
  const PLAN_FEATURES = {
    "Star": { routines: false, community: false, ai: false },
    "Star Plus": { routines: true, community: true, ai: false },
    "Kings": { routines: true, community: true, ai: true },
  };
  function planLimit(plan) { return PLAN_LIMITS[plan] ?? PLAN_LIMITS["Star"]; }
  function planFeatures(plan) { return PLAN_FEATURES[plan] ?? PLAN_FEATURES["Star"]; }
  async function countStudents(coachId) {
    const { count, error } = await sb().from("students").select("id", { count: "exact", head: true }).eq("coach_id", coachId);
    if (error) throw error;
    return count ?? 0;
  }

  /* ---------- Students ---------- */
  async function listStudents(coachId) {
    const { data, error } = await sb().from("students").select("*").eq("coach_id", coachId).order("full_name");
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
      const err = new Error(`Tu plan ${prof?.plan || "Star"} permite máximo ${limit} alumnos. Mejora tu plan para agregar más.`);
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
      state: data.state || "pend",
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
        state: data.state === "ok" ? "ok" : "pend",
        paid_at: data.state === "ok" ? new Date().toISOString() : null,
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
    const { error } = await sb().from("students").delete().eq("id", id);
    if (error) throw error;
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

  /* ---------- Asistencia (alumnos presenciales) ---------- */
  async function setAttendance(studentId, date, attending, reason) {
    const { data, error } = await sb()
      .from("attendance")
      .upsert({ student_id: studentId, date, attending, reason: reason || null }, { onConflict: "student_id,date" })
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  async function listAttendance(studentId, fromDate, toDate) {
    let q = sb().from("attendance").select("*").eq("student_id", studentId).order("date", { ascending: false });
    if (fromDate) q = q.gte("date", fromDate);
    if (toDate) q = q.lte("date", toDate);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }
  async function listCoachAttendance(coachId, date) {
    const { data, error } = await sb()
      .from("attendance")
      .select("*, students!inner(id, full_name, coach_id, training_type)")
      .eq("students.coach_id", coachId)
      .eq("date", date);
    if (error) throw error;
    return data;
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

  return {
    initials,
    planLimit, planFeatures, countStudents,
    getReferralInfo,
    setAttendance, listAttendance, listCoachAttendance,
    financeKpis,
    listStudents, createStudent, createStudentFull, updateStudent, deleteStudent,
    listPayments, markPaymentPaid, createPayment,
    getStudentRoutine, createRoutine, saveRoutineDay,
    listFollowUps, toggleFollowUp, createFollowUp,
    listWeightLogs, addWeightLog,
    uploadProgressPhoto, listProgressPhotos,
    listCommunityPosts, createCommunityPost, toggleLike, addComment,
    listConversations, listMessages, sendMessage,
  };
})();
