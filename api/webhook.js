// POST /api/webhook — recibe eventos de Stripe y sincroniza profiles con la suscripción.
// bodyParser desactivado: Stripe firma el body crudo y hay que verificarlo tal cual.
const { stripe, admin, readRaw, PLAN_BY_PRICE } = require("./_lib");

// Aplica el estado de una suscripción de Stripe sobre el perfil del coach.
async function syncSubscription(db, sub) {
  const coachId = sub.metadata?.coach_id || null;
  const priceId = sub.items?.data?.[0]?.price?.id;
  const plan = PLAN_BY_PRICE[priceId];
  const patch = {
    stripe_subscription_id: sub.id,
    subscription_status: sub.status, // active, trialing, past_due, canceled, unpaid...
    current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
  };
  // Solo un estado que da acceso mueve el plan efectivo del coach.
  if (plan && (sub.status === "active" || sub.status === "trialing" || sub.status === "past_due")) {
    patch.plan = plan;
  }
  // Cancelación total → vuelve al piso (Star), conservando el registro de la suscripción.
  if (sub.status === "canceled") patch.plan = "Star";

  const q = coachId
    ? db.from("profiles").update(patch).eq("id", coachId)
    : db.from("profiles").update(patch).eq("stripe_customer_id", sub.customer);
  const { error } = await q;
  if (error) throw error;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  const whsec = process.env.STRIPE_WEBHOOK_SECRET;
  const sk = stripe();
  let event;
  try {
    const raw = await readRaw(req);
    event = sk.webhooks.constructEvent(raw, req.headers["stripe-signature"], whsec);
  } catch (e) {
    return res.status(400).json({ error: `Firma inválida: ${e.message}` });
  }

  try {
    const db = admin();
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        if (s.subscription) {
          const sub = await sk.subscriptions.retrieve(s.subscription);
          if (!sub.metadata?.coach_id && s.client_reference_id) sub.metadata = { ...sub.metadata, coach_id: s.client_reference_id };
          await syncSubscription(db, sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription(db, event.data.object);
        break;
      default:
        break; // otros eventos: ack sin hacer nada
    }
    return res.status(200).json({ received: true });
  } catch (e) {
    // 500 → Stripe reintenta el evento más tarde.
    return res.status(500).json({ error: e.message || "Error procesando el evento" });
  }
};

module.exports.config = { api: { bodyParser: false } };
