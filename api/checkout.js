// POST /api/checkout — crea una sesión de Stripe Checkout (suscripción) para el coach.
// Body: { access_token, plan: "Star" | "Star Plus" }
const { stripe, coachFromToken, readJson, siteUrl, PRICE_BY_PLAN } = require("./_lib");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  try {
    const { access_token, plan } = await readJson(req);
    const price = PRICE_BY_PLAN[plan];
    if (!price) return res.status(400).json({ error: "Plan inválido" });

    const { db, user, profile } = await coachFromToken(access_token);
    const sk = stripe();

    // Reutiliza el customer del coach o crea uno nuevo la primera vez.
    let customerId = profile.stripe_customer_id;
    if (!customerId) {
      const customer = await sk.customers.create({
        email: user.email,
        name: profile.full_name,
        metadata: { coach_id: user.id },
      });
      customerId = customer.id;
      await db.from("profiles").update({ stripe_customer_id: customerId }).eq("id", user.id);
    }

    const base = siteUrl(req);
    const session = await sk.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      client_reference_id: user.id,
      subscription_data: { metadata: { coach_id: user.id, plan } },
      allow_promotion_codes: true,
      locale: "es",
      success_url: `${base}/index.html?checkout=success`,
      cancel_url: `${base}/index.html?checkout=cancel`,
    });
    return res.status(200).json({ url: session.url });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || "Error al crear el checkout" });
  }
};
