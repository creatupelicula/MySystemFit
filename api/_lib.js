// Helpers compartidos por las funciones serverless de Stripe.
// Archivos que empiezan con "_" NO son endpoints (Vercel los ignora como rutas).
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const PLAN_BY_PRICE = {
  [process.env.STRIPE_PRICE_STAR]: "Star",
  [process.env.STRIPE_PRICE_STAR_PLUS]: "Star Plus",
};
const PRICE_BY_PLAN = {
  Star: process.env.STRIPE_PRICE_STAR,
  "Star Plus": process.env.STRIPE_PRICE_STAR_PLUS,
};

// Planes temporalmente EN CONSTRUCCIÓN: no se pueden contratar por checkout ni
// recibir como premio de referidos hasta terminar sus mejoras. Reactivar =
// vaciar este Set (debe coincidir con BLOCKED_PLANS de assets/js/checkout-shared.js).
const BLOCKED_PLANS = new Set(["Star Plus", "Kings"]);
function isPlanBlocked(plan) { return BLOCKED_PLANS.has(plan); }

function stripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Falta STRIPE_SECRET_KEY");
  return new Stripe(key, { apiVersion: "2024-06-20" });
}

// Cliente admin (service_role) — SOLO servidor, nunca se expone al navegador.
function admin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

// Valida el JWT y devuelve el perfil, sin importar el rol (coach o alumno).
async function userFromToken(accessToken) {
  if (!accessToken) { const e = new Error("No autenticado"); e.status = 401; throw e; }
  const db = admin();
  const { data: { user }, error } = await db.auth.getUser(accessToken);
  if (error || !user) { const e = new Error("Sesión inválida"); e.status = 401; throw e; }
  const { data: profile, error: pErr } = await db
    .from("profiles").select("*").eq("id", user.id).single();
  if (pErr || !profile) { const e = new Error("Perfil no encontrado"); e.status = 404; throw e; }
  return { db, user, profile };
}

// Como userFromToken, pero exige que el perfil sea de un coach (asegura que solo actúe sobre sí mismo).
async function coachFromToken(accessToken) {
  const result = await userFromToken(accessToken);
  if (result.profile.role !== "coach") { const e = new Error("Solo los coaches gestionan suscripción"); e.status = 403; throw e; }
  return result;
}

// Lee el body JSON de una request de Vercel (Node).
async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

// Body sin parsear (para verificar la firma del webhook de Stripe).
async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}

function siteUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

module.exports = { stripe, admin, userFromToken, coachFromToken, readJson, readRaw, siteUrl, PLAN_BY_PRICE, PRICE_BY_PLAN, BLOCKED_PLANS, isPlanBlocked };
