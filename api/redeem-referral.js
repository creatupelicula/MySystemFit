// POST /api/redeem-referral — único caso MANUAL del sistema de puntos: un
// coach en plan Star con 4+ puntos elige canjearlos ahora por 1 mes gratis
// de Star (en vez de seguir acumulando hasta 5 para el upgrade automático).
// Los casos automáticos (Star Plus @4, Star @5) los dispara el webhook.
const { stripe, coachFromToken, readJson } = require("./_lib");
const { grantSamePlanFreeMonth } = require("./_referrals");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  try {
    const { access_token } = await readJson(req);
    const { db, user, profile } = await coachFromToken(access_token);
    if (profile.plan !== "Star") {
      return res.status(400).json({ error: "Esta recompensa solo está disponible para el plan Star." });
    }
    if ((profile.referral_points || 0) < 4) {
      return res.status(400).json({ error: `Necesitas 4 puntos, tienes ${profile.referral_points || 0}.` });
    }
    const sk = stripe();
    // Se reserva el canje restando los puntos SOLO si Stripe confirma el
    // cupón — si Stripe falla, el coach no pierde puntos por un error transitorio.
    await grantSamePlanFreeMonth(db, sk, user.id, "Star");
    const { error } = await db.from("profiles")
      .update({ referral_points: profile.referral_points - 4 }).eq("id", user.id);
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || "No se pudo canjear la recompensa" });
  }
};
