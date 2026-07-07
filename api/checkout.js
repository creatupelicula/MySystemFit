// POST /api/checkout — crea una sesión de Stripe Checkout (suscripción) para el coach.
// Body: { access_token, plan: "Star" | "Star Plus" }
const { stripe, coachFromToken, readJson, siteUrl, PRICE_BY_PLAN } = require("./_lib");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  try {
    const { access_token, plan } = await readJson(req);
    // Planes en construcción: bloqueados también en el backend, para que nadie
    // pueda suscribirse llamando al endpoint directamente. Reactivar = vaciar el Set.
    const BLOCKED_PLANS = new Set(["Star Plus", "Kings"]);
    if (BLOCKED_PLANS.has(plan)) {
      return res.status(403).json({ error: "Este plan está en construcción y no está disponible por ahora." });
    }
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
    const common = {
      mode: "subscription",
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      client_reference_id: user.id,
      subscription_data: { metadata: { coach_id: user.id, plan } },
      allow_promotion_codes: true,
      locale: "es",
    };

    // Checkout embebido: el pago ocurre dentro de la app (modal), sin
    // abandonar la experiencia. Requiere STRIPE_PUBLISHABLE_KEY configurada.
    const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
    if (publishableKey) {
      const session = await sk.checkout.sessions.create({
        ...common,
        ui_mode: "embedded",
        return_url: `${base}/index.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      });
      return res.status(200).json({ client_secret: session.client_secret, publishable_key: publishableKey });
    }

    // Respaldo: checkout alojado (redirección) si aún no hay clave publicable.
    const session = await sk.checkout.sessions.create({
      ...common,
      success_url: `${base}/index.html?checkout=success`,
      cancel_url: `${base}/index.html?checkout=cancel`,
    });
    return res.status(200).json({ url: session.url });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || "Error al crear el checkout" });
  }
};
