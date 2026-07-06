// POST /api/delete-account — elimina la cuenta del usuario (coach o alumno)
// de verdad: cancela cualquier suscripción de Stripe activa de inmediato (no
// al final del periodo, para no seguir cobrando a una cuenta borrada), borra
// auth.users (profiles y todo lo que cuelga de él cascadea, ver migración
// cascade_delete_profile_dependents) y revoca sus sesiones.
const { stripe, admin, userFromToken, readJson } = require("./_lib");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  try {
    const { access_token } = await readJson(req);
    const { db, user, profile } = await userFromToken(access_token);
    if (profile.role === "coach" && profile.stripe_subscription_id) {
      try {
        const sk = stripe();
        await sk.subscriptions.cancel(profile.stripe_subscription_id);
      } catch (ex) {
        console.error("No se pudo cancelar la suscripción antes de eliminar la cuenta:", ex);
      }
    }
    const { error } = await admin().auth.admin.deleteUser(user.id);
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || "No se pudo eliminar la cuenta" });
  }
};
