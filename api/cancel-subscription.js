// POST /api/cancel-subscription — cancela al final del periodo actual (no de
// inmediato) y deja un registro permanente en membership_events, aunque la
// suscripción real desaparezca de Stripe después.
// DELETE /api/cancel-subscription — deshace la cancelación antes de que el
// periodo termine ("Reactivar").
const { stripe, coachFromToken, readJson } = require("./_lib");

module.exports = async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "DELETE") {
    return res.status(405).json({ error: "Método no permitido" });
  }
  try {
    const { access_token } = await readJson(req);
    const { db, user, profile } = await coachFromToken(access_token);
    if (!profile.stripe_subscription_id) {
      return res.status(400).json({ error: "No tienes una suscripción activa que cancelar." });
    }
    const sk = stripe();
    const cancel = req.method === "POST";
    await sk.subscriptions.update(profile.stripe_subscription_id, { cancel_at_period_end: cancel });
    await db.from("profiles").update({ cancel_at_period_end: cancel }).eq("id", user.id);
    await db.from("membership_events").insert({
      coach_id: user.id, event_type: cancel ? "cancel_requested" : "cancel_undone",
      stripe_subscription_id: profile.stripe_subscription_id, plan_before: profile.plan, plan_after: profile.plan,
    });
    return res.status(200).json({ ok: true, cancel_at_period_end: cancel });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || "No se pudo actualizar la cancelación" });
  }
};
