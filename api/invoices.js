// POST /api/invoices — historial de facturación del coach, sin salir a Stripe.
// Body: { access_token }
const { stripe, coachFromToken, readJson } = require("./_lib");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  try {
    const { access_token } = await readJson(req);
    const { profile } = await coachFromToken(access_token);
    if (!profile.stripe_customer_id) return res.status(200).json({ invoices: [] });

    const list = await stripe().invoices.list({
      customer: profile.stripe_customer_id,
      limit: 24,
      expand: ["data.charge.payment_method_details"],
    });

    const invoices = list.data.map((inv) => ({
      id: inv.id,
      number: inv.number,
      date: inv.created,
      status: inv.status,
      amount: inv.total,
      currency: inv.currency,
      payment_method: inv.charge?.payment_method_details?.card?.brand || null,
      pdf: inv.invoice_pdf,
      hosted_url: inv.hosted_invoice_url,
    }));

    return res.status(200).json({ invoices });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || "No se pudo cargar tu historial de facturación" });
  }
};
