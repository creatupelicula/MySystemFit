// POST /api/portal — abre el Portal de Cliente de Stripe para gestionar la suscripción.
// Body: { access_token }
const { stripe, coachFromToken, readJson, siteUrl } = require("./_lib");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  try {
    const { access_token } = await readJson(req);
    const { profile } = await coachFromToken(access_token);
    if (!profile.stripe_customer_id) {
      return res.status(400).json({ error: "Todavía no tienes una suscripción activa." });
    }
    const session = await stripe().billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${siteUrl(req)}/index.html`,
    });
    return res.status(200).json({ url: session.url });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || "No se pudo abrir el portal" });
  }
};
