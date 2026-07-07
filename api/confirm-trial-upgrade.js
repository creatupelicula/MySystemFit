// POST /api/confirm-trial-upgrade — el coach decide quedarse con Star Plus de
// verdad antes de que termine su mes de regalo (ganado con puntos de
// referidos): libera el subscription_schedule y deja Star Plus fijo,
// facturación normal desde ya.
const { stripe, coachFromToken, readJson, isPlanBlocked } = require("./_lib");
const { confirmTrialUpgrade } = require("./_referrals");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  try {
    const { access_token } = await readJson(req);
    const { db, user, profile } = await coachFromToken(access_token);
    // Star Plus en construcción: no se puede fijar como plan de pago todavía.
    if (isPlanBlocked("Star Plus")) {
      return res.status(403).json({ error: "El plan Star Plus está en construcción por ahora." });
    }
    if (!profile.gift_plan) {
      return res.status(400).json({ error: "No tienes un regalo de plan activo." });
    }
    const sk = stripe();
    await confirmTrialUpgrade(db, sk, user.id);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || "No se pudo confirmar el cambio de plan" });
  }
};
