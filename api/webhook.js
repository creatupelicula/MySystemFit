// POST /api/webhook — recibe eventos de Stripe y sincroniza profiles con la suscripción.
// bodyParser desactivado: Stripe firma el body crudo y hay que verificarlo tal cual.
const { stripe, admin, readRaw, PLAN_BY_PRICE } = require("./_lib");
const { grantSamePlanFreeMonth, grantUpgradeTrialMonth } = require("./_referrals");

// Otorga puntos de referido al REFERENTE cuando el REFERIDO activa un plan de
// pago por primera vez de verdad (nunca en renovaciones posteriores: el
// unique(referral_id) de referral_rewards hace que un segundo intento sea un
// no-op silencioso). Si el umbral automático se cumple, dispara la recompensa
// correspondiente (Stripe) en el mismo evento.
async function maybeAwardReferralPoints(db, sk, coachId, newPlan) {
  if (newPlan !== "Star" && newPlan !== "Star Plus") return;
  const { data: referral } = await db.from("referrals").select("id, referrer_id, referred_id")
    .eq("referred_id", coachId).maybeSingle();
  if (!referral || referral.referrer_id === referral.referred_id) return;
  const points = newPlan === "Star Plus" ? 2 : 1;
  const { error: insErr } = await db.from("referral_rewards").insert({
    referral_id: referral.id, referrer_id: referral.referrer_id,
    referred_id: referral.referred_id, plan_awarded: newPlan, points,
  });
  if (insErr) {
    if (insErr.code === "23505") return; // ya otorgado antes para este referral — no-op
    throw insErr;
  }
  const { data: rows } = await db.rpc("apply_referral_points", { p_referrer_id: referral.referrer_id, p_points: points });
  const action = rows?.[0]?.action;
  if (action === "none") return;
  try {
    if (action === "auto_star_plus_month") {
      await grantSamePlanFreeMonth(db, sk, referral.referrer_id, "Star Plus");
      await db.from("profiles").update({ referral_points: rows[0].new_points - 4 }).eq("id", referral.referrer_id);
    } else if (action === "auto_upgrade_star_plus_month") {
      await grantUpgradeTrialMonth(db, sk, referral.referrer_id);
      await db.from("profiles").update({ referral_points: rows[0].new_points - 5 }).eq("id", referral.referrer_id);
    }
  } catch (ex) {
    // Los puntos ya quedaron sumados (correcto); si Stripe falla aquí no debe
    // tumbar el procesamiento del webhook del REFERIDO — se puede reintentar
    // o canjear manualmente después. Log técnico solo a consola.
    console.error("Error otorgando recompensa automática de referido:", ex);
  }
}

// Aplica el estado de una suscripción de Stripe sobre el perfil del coach.
async function syncSubscription(db, sk, sub) {
  const coachId = sub.metadata?.coach_id || null;
  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id;
  const plan = PLAN_BY_PRICE[priceId];
  // current_period_end vive en el subscription_item (no en la suscripción) desde la API 2025+.
  const periodEnd = item?.current_period_end ?? sub.current_period_end;
  const patch = {
    stripe_subscription_id: sub.id,
    subscription_status: sub.status, // active, trialing, past_due, canceled, unpaid...
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
  };
  // Solo un estado que da acceso mueve el plan efectivo del coach.
  if (plan && (sub.status === "active" || sub.status === "trialing" || sub.status === "past_due")) {
    patch.plan = plan;
    patch.plan_selected = true; // pago confirmado: no debe volver a ver el gate de selección
  }
  // Cancelación total → vuelve al piso real (Free), conservando el registro de la suscripción.
  if (sub.status === "canceled") patch.plan = "Free";

  // Se necesita el estado ANTERIOR para detectar (a) una activación nueva de
  // verdad (puntos de referido) y (b) la salida de un regalo de puntos
  // (limpiar gift_*) — así que se lee antes de escribir el patch.
  const selectQ = coachId
    ? db.from("profiles").select("id, subscription_status, gift_plan, plan").eq("id", coachId)
    : db.from("profiles").select("id, subscription_status, gift_plan, plan").eq("stripe_customer_id", sub.customer);
  const { data: before } = await selectQ.maybeSingle();
  if (!before) return; // aún no hay coach vinculado a este customer/subscription

  const ACTIVE_STATES = ["active", "trialing", "past_due"];
  const wasActive = ACTIVE_STATES.includes(before.subscription_status);
  const isActiveNow = ACTIVE_STATES.includes(patch.subscription_status);

  // La fase 2 del subscription_schedule ya se activó (o el coach canceló):
  // el regalo terminó de verdad, Stripe ya cobró el plan real.
  const giftEnded = before.gift_plan && patch.plan && patch.plan !== before.gift_plan;
  if (giftEnded) {
    patch.gift_plan = null; patch.pre_gift_plan = null; patch.gift_started_at = null;
    patch.gift_ends_at = null; patch.gift_warned_at = null; patch.stripe_schedule_id = null;
  }
  if (sub.status === "canceled") patch.cancel_at_period_end = false;

  const { error } = await db.from("profiles").update(patch).eq("id", before.id);
  if (error) throw error;

  if (giftEnded) {
    await db.from("membership_events").insert({
      coach_id: before.id, event_type: "gift_reverted",
      stripe_subscription_id: sub.id, plan_before: before.gift_plan, plan_after: patch.plan,
    });
  }
  if (sub.status === "canceled") {
    await db.from("membership_events").insert({
      coach_id: before.id, event_type: "subscription_canceled",
      stripe_subscription_id: sub.id, plan_before: before.plan, plan_after: "Free",
    });
  }
  if (!wasActive && isActiveNow && patch.plan) {
    await maybeAwardReferralPoints(db, sk, before.id, patch.plan);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  let sk, whsec;
  try {
    sk = stripe();
    whsec = process.env.STRIPE_WEBHOOK_SECRET;
    if (!whsec) throw new Error("Falta STRIPE_WEBHOOK_SECRET");
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
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
          await syncSubscription(db, sk, sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription(db, sk, event.data.object);
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
