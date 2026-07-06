/* Checkout compartido (Stripe Embedded Checkout) — usado por index.html
   (Ajustes > Plan y suscripción) y select-plan.html. Único punto de verdad
   del flujo de pago para que ninguna página duplique precios ni lógica de
   reintentos al volver de Stripe. */
window.msfCheckout = (function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const api = window.msfApi;

  const icons = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    err: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  };
  // Usa el toast global de app.js si ya existe (dashboard); si no, pinta el
  // suyo propio con el mismo markup (páginas standalone como select-plan.html).
  function toast(txt, sub = "", type = "ok") {
    if (window.msfToast) return window.msfToast(txt, sub, type);
    const stack = $("#toastStack");
    if (!stack) return;
    const el = document.createElement("div");
    el.className = "toast toast--" + type;
    el.innerHTML = `<span class="toast__ico">${icons[type]}</span><div><div class="toast__txt">${api.esc(txt)}</div>${sub ? `<div class="toast__sub">${api.esc(sub)}</div>` : ""}</div>`;
    stack.appendChild(el);
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 220); }, 2800);
  }
  function errToast(e, fallback) {
    console.error(fallback + ":", e); // detalle técnico solo a consola, nunca al usuario
    toast(fallback, api.friendlyError(e), "err");
  }

  let EMBEDDED_CHECKOUT = null;
  function destroyEmbeddedCheckout() {
    if (EMBEDDED_CHECKOUT) { try { EMBEDDED_CHECKOUT.destroy(); } catch (_) {} EMBEDDED_CHECKOUT = null; }
  }
  function loadStripeJs() {
    if (window.Stripe) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://js.stripe.com/v3/";
      s.onload = resolve;
      s.onerror = () => reject(new Error("No se pudo cargar el módulo de pago"));
      document.head.appendChild(s);
    });
  }
  async function startCheckout(plan) {
    try {
      const { data: { session } } = await window.msfSupabase.auth.getSession();
      if (!session) return toast("Sesión expirada, vuelve a entrar", "", "err");
      $("#checkoutPlanName") && ($("#checkoutPlanName").textContent = plan);
      $("#checkoutPlanPrice") && ($("#checkoutPlanPrice").textContent = api.planPrice(plan) || "");
      toast("Preparando pago seguro…", "", "info");
      const r = await fetch("/api/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: session.access_token, plan }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "No se pudo iniciar el pago");
      if (data.client_secret && data.publishable_key) {
        await loadStripeJs();
        destroyEmbeddedCheckout();
        const stripeClient = window.Stripe(data.publishable_key);
        EMBEDDED_CHECKOUT = await stripeClient.initEmbeddedCheckout({ clientSecret: data.client_secret });
        $("#checkoutMount").innerHTML = "";
        EMBEDDED_CHECKOUT.mount("#checkoutMount");
        $("#modal-checkout").classList.add("is-open");
        return;
      }
      if (data.url) { window.location.href = data.url; return; }
      throw new Error("No se pudo iniciar el pago");
    } catch (ex) { errToast(ex, "No se pudo iniciar el pago"); }
  }
  // Al cerrar el modal de pago (o cualquier modal), limpia el checkout embebido.
  document.addEventListener("click", (e) => {
    if ((e.target.classList.contains("modal-overlay") || e.target.closest(".js-modal-close")) &&
        $("#modal-checkout")?.classList.contains("is-open") === false) {
      destroyEmbeddedCheckout();
    }
  });

  /* Al volver de Stripe: refresca el perfil (el webhook ya sincronizó el plan).
     callbacks: { onSynced(profile), onTimeout() } — cada página decide qué
     hacer tras confirmar el pago (el dashboard refresca su gating; select-plan
     redirige a index.html). */
  async function handleCheckoutReturn(callbacks) {
    callbacks = callbacks || {};
    const params = new URLSearchParams(location.search);
    const state = params.get("checkout");
    if (!state) return;
    history.replaceState({}, "", location.pathname);
    if (state === "cancel") { toast("Pago cancelado", "", "info"); return; }
    toast("Confirmando tu suscripción…", "", "info");
    // El webhook puede tardar un par de segundos; reintenta leyendo el perfil.
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const fresh = await window.msfAuth.getSessionProfile();
      if (fresh?.profile && fresh.profile.subscription_status === "active") {
        toast("¡Suscripción activa! 🎉", `Plan ${fresh.profile.plan}`, "ok");
        window.msfSound?.playSound?.("payment");
        callbacks.onSynced?.(fresh.profile);
        return;
      }
    }
    toast("Pago recibido. Si el plan no cambió, recarga en un momento.", "", "info");
    callbacks.onTimeout?.();
  }

  // Recomendación de plan a partir de las respuestas del onboarding — misma
  // función usada en la pantalla de recomendación (onboarding.html) y para
  // resaltar la tarjeta correspondiente en select-plan.html.
  const AUTOMATION_GOALS = ["Automatizar mi negocio"];
  const STAR_GOALS = ["Dar seguimiento profesional", "Organizar mejor mis alumnos", "Conseguir más clientes"];
  function recommendPlan({ students, goal }) {
    const n = students || 0;
    if (n >= 15 || AUTOMATION_GOALS.includes(goal)) return "Star Plus";
    if (n >= 5 || STAR_GOALS.includes(goal)) return "Star";
    return "Free";
  }
  function recommendationText(plan, { students, goal }) {
    const n = students || 0;
    const alumnosTxt = n > 0 ? `trabajas con ${n} alumno${n === 1 ? "" : "s"}` : "estás comenzando";
    const goalTxt = goal ? `tu objetivo principal es "${goal.toLowerCase()}"` : "quieres hacer crecer tu negocio";
    if (plan === "Star Plus") {
      return `Te recomendamos el Plan Star Plus porque ${alumnosTxt} y ${goalTxt}: este plan incluye automatización, estadísticas avanzadas y todas las herramientas para escalar sin límites.`;
    }
    if (plan === "Star") {
      return `Te recomendamos el Plan Star porque ${alumnosTxt} y ${goalTxt}: incluye gestión de rutinas, objetivos y pagos para ayudarte a crecer sin pagar por funciones que aún no necesitas.`;
    }
    return `Te recomendamos el Plan Gratuito porque ${alumnosTxt}: es ideal para conocer la plataforma sin costo. Podrás actualizar de plan cuando lo necesites.`;
  }

  return { loadStripeJs, destroyEmbeddedCheckout, startCheckout, handleCheckoutReturn, toast, errToast, recommendPlan, recommendationText };
})();
