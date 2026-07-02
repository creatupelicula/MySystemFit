/* Guardas de sesión + helpers de login/signup/logout.
   Se carga después de supabaseClient.js en cada página protegida. */
window.msfAuth = (function () {
  "use strict";
  const sb = () => window.msfSupabase;

  async function getSessionProfile() {
    const { data: { session } } = await sb().auth.getSession();
    if (!session) return null;
    const { data: profile, error } = await sb()
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single();
    if (error) return null;
    return { session, profile };
  }

  /* Redirige si no hay sesión, o si el rol no coincide con el requerido.
     Devuelve { session, profile } cuando todo está OK. */
  async function requireRole(role) {
    const result = await getSessionProfile();
    if (!result) {
      window.location.href = "login.html";
      return null;
    }
    if (result.profile.role !== role) {
      window.location.href = result.profile.role === "coach" ? "index.html" : "alumno.html";
      return null;
    }
    return result;
  }

  async function signIn(email, password) {
    const { error } = await sb().auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signUpCoach(email, password, fullName) {
    const { error } = await sb().auth.signUp({
      email,
      password,
      options: { data: { role: "coach", full_name: fullName } },
    });
    if (error) throw error;
  }

  async function signUpStudent(email, password, fullName, coachId) {
    const { data, error } = await sb().auth.signUp({
      email,
      password,
      options: { data: { role: "alumno", full_name: fullName, coach_id: coachId } },
    });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    await sb().auth.signOut();
    window.location.href = "login.html";
  }

  return { getSessionProfile, requireRole, signIn, signUpCoach, signUpStudent, signOut };
})();
