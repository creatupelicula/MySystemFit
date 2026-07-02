/* Capa de acceso a datos — todas las lecturas/escrituras a Supabase
   pasan por aquí. app.js (coach) y alumno.js (alumno) consumen esto. */
window.msfApi = (function () {
  "use strict";
  const sb = () => window.msfSupabase;
  const initials = (name) => (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("");

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
    listStudents, createStudent, updateStudent, deleteStudent,
    listPayments, markPaymentPaid, createPayment,
    getStudentRoutine, createRoutine, saveRoutineDay,
    listFollowUps, toggleFollowUp, createFollowUp,
    listWeightLogs, addWeightLog,
    listCommunityPosts, createCommunityPost, toggleLike, addComment,
    listConversations, listMessages, sendMessage,
  };
})();
