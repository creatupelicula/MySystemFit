// POST /api/delete-student — el coach elimina a un alumno de verdad: si el
// alumno ya tiene cuenta (profile_id), borra auth.users primero (cascada real
// a todo lo que cuelga del perfil: mensajes enviados, posts de comunidad,
// etc.). El FK students.profile_id es ON DELETE SET NULL (no CASCADE), así
// que la fila de `students` NO desaparece sola — hay que borrarla aparte para
// que el resto de los datos ligados a student_id (pagos, rutinas, objetivos,
// fotos, asistencia, notificaciones) también caigan por su propio cascade.
const { admin, coachFromToken, readJson } = require("./_lib");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  try {
    const { access_token, student_id } = await readJson(req);
    const { profile } = await coachFromToken(access_token);
    const db = admin();
    const { data: student, error: sErr } = await db
      .from("students").select("id, profile_id").eq("id", student_id).eq("coach_id", profile.id).maybeSingle();
    if (sErr) throw sErr;
    if (!student) { const e = new Error("Alumno no encontrado"); e.status = 404; throw e; }
    if (student.profile_id) {
      const { error } = await db.auth.admin.deleteUser(student.profile_id);
      if (error) throw error;
    }
    const { error: delErr } = await db.from("students").delete().eq("id", student.id);
    if (delErr) throw delErr;
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || "No se pudo eliminar al alumno" });
  }
};
