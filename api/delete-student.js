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

    // 1) Archivos de progreso en Storage: NO tienen FK, así que el cascade de la
    //    BD no los borra. Se listan por carpeta (<student_id>/...) y se eliminan
    //    para no dejar imágenes huérfanas en el bucket privado `progress`.
    try {
      const { data: files } = await db.storage.from("progress").list(student.id, { limit: 1000 });
      if (files && files.length) {
        await db.storage.from("progress").remove(files.map((f) => `${student.id}/${f.name}`));
      }
    } catch (_) { /* si falla la limpieza de storage no se aborta el borrado de datos */ }

    // 2) Cuenta del alumno: borrar auth.users elimina en cascada el perfil y todo
    //    lo que cuelga de él (mensajes enviados, comunidad, referidos) + sus
    //    sesiones/refresh tokens, así que ya no podrá iniciar sesión. Se hace
    //    antes que students para que un reintento (si el paso 3 fallara) siga
    //    encontrando la fila y pueda completarse.
    if (student.profile_id) {
      const { error } = await db.auth.admin.deleteUser(student.profile_id);
      if (error) throw error;
    }
    // 3) Ficha del alumno: students.profile_id es SET NULL (no CASCADE), así que
    //    hay que borrarla aparte; su cascade elimina pagos, rutinas, objetivos,
    //    fotos, asistencia y notificaciones ligados a student_id.
    const { error: delErr } = await db.from("students").delete().eq("id", student.id);
    if (delErr) throw delErr;
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || "No se pudo eliminar al alumno" });
  }
};
