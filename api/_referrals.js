// Mecánica de Stripe para las recompensas del sistema de referidos por puntos.
// Usado tanto por webhook.js (casos automáticos: Star Plus @4, Star @5) como
// por redeem-referral.js (caso manual: Star @4) y confirm-trial-upgrade.js.
const { PRICE_BY_PLAN } = require("./_lib");

// Cada canje crea su propio cupón fresco — no se reutiliza uno guardado, así
// que no hace falta ninguna env var nueva.
async function freshFreeMonthCoupon(sk) {
  return sk.coupons.create({ percent_off: 100, duration: "once", max_redemptions: 1 });
}

// "Mes gratis del mismo plan" — Star Plus @4 automático, o Star @4 manual.
// No cambia el plan ni el precio, solo deja la siguiente factura en $0.
async function grantSamePlanFreeMonth(db, sk, coachId, plan) {
  const { data: profile } = await db.from("profiles").select("stripe_subscription_id").eq("id", coachId).single();
  if (!profile?.stripe_subscription_id) throw new Error("El coach no tiene una suscripción activa en Stripe");
  const coupon = await freshFreeMonthCoupon(sk);
  await sk.subscriptions.update(profile.stripe_subscription_id, { discounts: [{ coupon: coupon.id }] });
  await db.from("membership_events").insert({
    coach_id: coachId, event_type: "redeem_same_plan_month",
    stripe_subscription_id: profile.stripe_subscription_id,
    plan_before: plan, plan_after: plan, points_spent: 4,
    metadata: { coupon_id: coupon.id },
  });
}

// "Mes de prueba Star -> Star Plus" — automático @5 puntos. Sube de verdad a
// Star Plus por 1 ciclo de facturación (gratis) y luego Stripe solo revierte
// a Star y retoma el cobro normal (subscription schedule de 2 fases).
async function grantUpgradeTrialMonth(db, sk, coachId) {
  const { data: profile } = await db.from("profiles").select("stripe_subscription_id, plan").eq("id", coachId).single();
  if (!profile?.stripe_subscription_id) throw new Error("El coach no tiene una suscripción activa en Stripe");
  const coupon = await freshFreeMonthCoupon(sk);
  const schedule = await sk.subscriptionSchedules.create({ from_subscription: profile.stripe_subscription_id });
  const updated = await sk.subscriptionSchedules.update(schedule.id, {
    end_behavior: "release",
    phases: [
      { items: [{ price: PRICE_BY_PLAN["Star Plus"] }], discounts: [{ coupon: coupon.id }], iterations: 1 },
      { items: [{ price: PRICE_BY_PLAN["Star"] }] },
    ],
  });
  const phase1End = updated.phases?.[0]?.end_date
    ? new Date(updated.phases[0].end_date * 1000).toISOString()
    : new Date(Date.now() + 30 * 86400000).toISOString();
  await db.from("profiles").update({
    gift_plan: "Star Plus", pre_gift_plan: "Star",
    gift_started_at: new Date().toISOString(), gift_ends_at: phase1End,
    gift_warned_at: null, stripe_schedule_id: schedule.id,
  }).eq("id", coachId);
  await db.from("membership_events").insert({
    coach_id: coachId, event_type: "gift_started",
    stripe_subscription_id: profile.stripe_subscription_id, stripe_schedule_id: schedule.id,
    plan_before: "Star", plan_after: "Star Plus", points_spent: 5,
    metadata: { coupon_id: coupon.id, gift_ends_at: phase1End },
  });
}

// El coach decide quedarse con Star Plus de verdad antes de que acabe el mes
// de regalo: libera el schedule (cancela la reversión programada) y deja
// Star Plus fijo, facturación normal desde ya.
async function confirmTrialUpgrade(db, sk, coachId) {
  const { data: profile } = await db.from("profiles")
    .select("stripe_subscription_id, stripe_schedule_id, gift_plan").eq("id", coachId).single();
  if (!profile?.gift_plan) throw new Error("No tienes un regalo de plan activo");
  if (profile.stripe_schedule_id) {
    await sk.subscriptionSchedules.release(profile.stripe_schedule_id);
  }
  await sk.subscriptions.update(profile.stripe_subscription_id, {
    items: [{ price: PRICE_BY_PLAN["Star Plus"] }],
  });
  await db.from("profiles").update({
    gift_plan: null, pre_gift_plan: null, gift_started_at: null,
    gift_ends_at: null, gift_warned_at: null, stripe_schedule_id: null,
  }).eq("id", coachId);
  await db.from("membership_events").insert({
    coach_id: coachId, event_type: "gift_converted_to_paid",
    stripe_subscription_id: profile.stripe_subscription_id,
    plan_before: "Star Plus", plan_after: "Star Plus",
  });
}

module.exports = { grantSamePlanFreeMonth, grantUpgradeTrialMonth, confirmTrialUpgrade };
