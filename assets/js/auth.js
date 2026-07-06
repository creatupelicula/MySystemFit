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
    if (error || !profile) {
      // El perfil ya no existe (cuenta eliminada) pero el navegador conservaba
      // una sesión vieja: limpia la sesión local y avisa en el próximo login
      // en vez de dejar la pestaña "logueada" contra una cuenta borrada.
      await sb().auth.signOut();
      try { sessionStorage.setItem("msf_account_deleted", "1"); } catch (_) { /* noop */ }
      return null;
    }
    // Aviso perezoso de "tu mes de cortesía termina pronto" (sin cron): se
    // revisa en cada sesión; la RPC es idempotente (gift_warned_at) y no
    // bloquea el login si falla.
    if (profile.role === "coach" && profile.gift_ends_at && !profile.gift_warned_at) {
      Promise.resolve(sb().rpc("check_gift_warning")).catch(() => {});
    }
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
      window.location.href = result.profile.role === "coach" ? coachLandingPage(result.profile) : "alumno.html";
      return null;
    }
    return result;
  }

  /* Única fuente de verdad de a dónde debe ir un coach después de autenticarse:
     primero completa los datos básicos (pasos 1-3 del onboarding), luego
     elige plan, luego termina el onboarding (objetivos + modo, pasos 4-5),
     y solo entonces entra al dashboard. La usan login.html y requireCoachReady(). */
  function coachLandingPage(profile) {
    if (!profile.basic_info_completed) return "onboarding.html";
    if (!profile.plan_selected) return "select-plan.html";
    if (!profile.onboarding_completed) return "onboarding.html";
    return "index.html";
  }

  /* Como requireRole("coach") pero además exige haber pasado por las 4 etapas
     de coachLandingPage() antes de dejar pasar al dashboard. */
  async function requireCoachReady() {
    const result = await requireRole("coach");
    if (!result) return null;
    const params = new URLSearchParams(location.search);
    if (!result.profile.basic_info_completed) { window.location.href = "onboarding.html"; return null; }
    if (!result.profile.plan_selected && params.get("checkout") !== "success") {
      window.location.href = "select-plan.html";
      return null;
    }
    if (!result.profile.onboarding_completed) { window.location.href = "onboarding.html"; return null; }
    return result;
  }

  async function signIn(email, password) {
    const { error } = await sb().auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signUpCoach(email, password, fullName, referralCode) {
    const { error } = await sb().auth.signUp({
      email,
      password,
      options: { data: { role: "coach", full_name: fullName, referral_code: referralCode || "" } },
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

  /* Crea la cuenta de auth de un alumno DESDE el panel del coach, sin tocar
     la sesión activa del coach. Usa un cliente Supabase efímero
     (persistSession:false) para que el signUp no reemplace la sesión actual.
     El trigger handle_new_user crea el profile (role 'alumno' + coach_id).
     Devuelve el id del nuevo usuario, o null si el proyecto exige confirmar
     email y no regresa user. */
  async function createStudentAccount(email, password, fullName, coachId) {
    const cfg = window.MSF_CONFIG;
    const tempClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: "msf-temp-signup" },
    });
    const { data, error } = await tempClient.auth.signUp({
      email,
      password,
      // created_by_coach: el trigger NO crea la ficha students (el panel la crea él mismo)
      options: { data: { role: "alumno", full_name: fullName, coach_id: coachId, created_by_coach: "1" } },
    });
    if (error) throw error;
    // Cerrar cualquier sesión que el cliente temporal pudiera haber abierto.
    try { await tempClient.auth.signOut(); } catch (_) { /* noop */ }
    return data?.user?.id || null;
  }

  /* Envía el correo de recuperación; el enlace regresa a login.html donde
     supabase-js emite PASSWORD_RECOVERY y se muestra el formulario de nueva clave. */
  async function requestPasswordReset(email) {
    const { error } = await sb().auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname.replace(/[^/]*$/, "") + "login.html",
    });
    if (error) throw error;
  }

  async function updatePassword(newPassword) {
    const { error } = await sb().auth.updateUser({ password: newPassword });
    if (error) throw error;
  }

  return { getSessionProfile, requireRole, requireCoachReady, coachLandingPage, signIn, signUpCoach, signUpStudent, createStudentAccount, signOut, requestPasswordReset, updatePassword };
})();
