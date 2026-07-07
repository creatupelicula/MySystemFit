---
name: crm-coaches-builder
description: "Diseña desde cero un CRM/SaaS para coaches, entrenadores, nutriólogos, mentores o tutores que gestionan clientes por planes de suscripción — sistema de permisos por plan, onboarding con recomendación de plan, referidos por puntos, chat, objetivos, pagos y más. Hace preguntas de descubrimiento sobre el negocio del usuario y genera una arquitectura + plan de construcción a medida (sin referencias a ningún proyecto existente). Úsala cuando el usuario diga 'quiero construir un CRM para coaches', 'quiero un sistema de gestión de alumnos/clientes', 'ayúdame a armar un SaaS para entrenadores', 'necesito una plataforma para mi negocio de coaching', 'quiero replicar un sistema como este para mi propio negocio', 'diseña un CRM con planes de suscripción'."
---

# Constructor de CRM para negocios de coaching — Descubrimiento y diseño

Esta skill diseña, a la medida de CADA usuario, un CRM/SaaS genérico para negocios donde un profesional (coach, entrenador, nutriólogo, mentor, tutor, consultor) gestiona clientes/alumnos bajo un modelo de planes de suscripción. No asume un negocio específico ni un branding fijo: todo el resultado depende de las respuestas del usuario.

**Regla fundamental: nunca construyas ni generes el plan final sin haber hecho primero las preguntas de descubrimiento. Un CRM genérico sin adaptar al negocio real del usuario es poco útil — la personalización es el valor de esta skill.**

---

## Paso 0 — Presentación breve

Cuando se active la skill, explica en 3-4 líneas qué puede construirse, sin tecnicismos todavía:

> "Puedo ayudarte a diseñar y construir un CRM para tu negocio de coaching/entrenamiento/mentoría: un panel donde gestionas a tus clientes, planes de suscripción con funciones que se desbloquean según lo que paguen, pagos, comunicación con tus clientes, seguimiento de objetivos/progreso, y hasta un sistema de referidos para que tus propios clientes o colegas te traigan más negocio. Antes de proponerte nada, quiero entender tu negocio — son unas 6-8 preguntas rápidas."

---

## Paso 1 — Preguntas de descubrimiento

Usa `AskUserQuestion` (agrupa en tandas de hasta 4 preguntas) para cubrir estos bloques. Adapta el lenguaje al usuario, pero no te saltes ningún bloque salvo que ya lo haya contestado espontáneamente.

**Bloque A — El negocio**
- ¿A qué tipo de profesional sirve? (entrenador personal, nutriólogo, mentor de negocios, tutor académico, consultor, terapeuta, coach de vida, otro)
- ¿Cómo se llama el proyecto/marca? (o si aún no tiene nombre)
- ¿Quién es el usuario final además del profesional — tiene alumnos/clientes individuales, o también equipos/empresas?

**Bloque B — Monetización**
- ¿Quién paga la suscripción: el profesional le paga a la plataforma (SaaS B2B), o los clientes finales pagan directamente al profesional a través de la plataforma, o ambos?
- ¿Cuántos niveles/planes quiere? (ej. gratis + 2 de pago, o solo 1 plan de pago, o freemium con límite de clientes)
- ¿Qué debería diferenciar cada plan? (límite de clientes, funciones premium, ambos)
- Método de cobro preferido (Stripe, Mercado Pago, PayPal, otro, o "lo que recomiendes")

**Bloque C — Funciones deseadas** (multiSelect)
Presenta como opciones a elegir (el usuario puede pedir más de una, o decir "todas"):
- Gestión de clientes/alumnos (fichas, estados, historial)
- Chat directo profesional-cliente
- Seguimiento de objetivos/metas con progreso
- Pagos y facturación interna
- Asistencia / check-in diario o semanal
- Rutinas/planes de trabajo asignables (entrenamiento, dietas, tareas)
- Comunidad / feed social entre clientes
- Sistema de referidos con recompensas
- Notificaciones/centro de avisos
- Onboarding guiado con recomendación automática de plan

**Bloque D — Preferencias técnicas**
- ¿Ya tiene preferencia de stack (framework, hosting, base de datos), o prefiere una recomendación?
- ¿Necesita apps móviles nativas o basta con web responsive?
- ¿Va a manejar múltiples profesionales bajo una sola instancia (multi-tenant real) o es para un solo negocio?

No sigas a la siguiente sección hasta tener respuestas razonables de los 4 bloques (asunciones marcadas `[SUPUESTO: ...]` están bien si el usuario dice "decide tú" en algún punto puntual, pero no para el bloque completo).

---

## Paso 2 — Recomendación de arquitectura

Con las respuestas, propone una arquitectura concreta. Si el usuario no tiene preferencia técnica fuerte, recomienda por defecto esta **arquitectura de referencia** (probada en sistemas de este tipo, económica y rápida de operar para un equipo pequeño):

- **Frontend**: sitio estático (HTML/CSS/JS vanilla o un framework ligero como el usuario prefiera) — barato de hospedar, sin build complejo, ideal si el equipo es pequeño. Si el usuario ya sabe React/Vue/Next, no fuerces vanilla — usa lo que ya domina.
- **Backend/datos**: Postgres administrado con autenticación y tiempo real integrados (ej. Supabase) — Auth, Row Level Security por tabla, funciones `SECURITY DEFINER` para toda regla de negocio sensible (nunca confiar solo en el cliente para permisos).
- **Pagos**: Stripe (u otro procesador local si el usuario opera en un mercado donde Stripe no es viable) con funciones serverless para checkout/webhook/portal de cliente — el webhook es la única fuente de verdad de qué plan tiene cada cuenta, nunca el cliente.
- **Hosting**: Vercel/Netlify para el frontend + funciones serverless; deploy automático al hacer push a la rama principal.
- **Tiempo real**: publicación de cambios en las tablas que lo necesiten (mensajes, estado de pagos, objetivos) para que la UI se actualice sola sin refrescar.

Explica brevemente el porqué de cada elección en función de LO QUE EL USUARIO DIJO (tamaño de negocio, presupuesto, stack conocido) — no repitas esta lista genérica sin conectarla a sus respuestas.

---

## Paso 3 — Diseño del modelo de planes y permisos

A partir del Bloque B, propone una tabla plan → límites → funciones, por ejemplo:

| Plan | Límite de clientes | Funciones incluidas |
|---|---|---|
| Gratis | N bajo | Solo lo esencial (gestión básica de clientes) |
| Plan medio | N medio | + chat, objetivos, pagos |
| Plan alto | N alto o ilimitado | + comunidad, rutinas/planes avanzados, reportes |

Deja claro el principio de diseño: **la fuente de verdad de qué puede hacer cada cuenta vive en el backend** (una función o tabla central que responde "¿esta cuenta puede usar la función X?"), y el frontend solo la refleja para evitar parpadeos — nunca al revés. Y define explícitamente la política de UX para funciones bloqueadas (pregúntale al usuario si prefiere ocultarlas por completo o mostrarlas atenuadas con un mensaje de upgrade — ambas son válidas, pero hay que decidirlo, no dejarlo implícito).

---

## Paso 4 — Plan de construcción por fases

Genera un plan de fases priorizado, ajustado a las funciones que el usuario eligió en el Bloque C. Orden sugerido por defecto (ajusta según lo que haya pedido):

1. **Núcleo**: autenticación, alta de profesional, gestión básica de clientes, un solo plan (sin gating aún).
2. **Monetización**: integración de pagos, planes múltiples, permisos por plan.
3. **Onboarding inteligente** (si lo pidió): wizard de preguntas al profesional nuevo + recomendación automática de plan según sus respuestas (ej. número de clientes actuales, objetivo del negocio) — el usuario siempre puede elegir un plan distinto al recomendado.
4. **Funciones core del negocio**: las que elija el usuario del Bloque C (chat, objetivos, rutinas, asistencia).
5. **Crecimiento**: referidos/recompensas, comunidad, notificaciones.
6. **Pulido**: responsive/mobile, sonidos/microinteracciones, compatibilidad con navegadores exigentes (Safari/iOS si aplica), eliminación real de cuentas (borrado completo de datos, permitiendo volver a registrarse con el mismo correo después).

Presenta el plan de fases y pregunta si quiere ajustar el orden o el alcance de alguna fase antes de continuar.

---

## Paso 5 — Confirmar y generar el prompt de construcción

Cuando el usuario esté de acuerdo con arquitectura + planes + fases, genera UN documento final con:

1. **Resumen del proyecto** (nombre, nicho, modelo de monetización) en 3-5 líneas.
2. **Arquitectura elegida** (stack final acordado).
3. **Tabla de planes y permisos** final.
4. **Plan de fases** final, en orden.
5. Una invitación clara a empezar: *"¿Quieres que empiece a construir la Fase 1 ahora mismo, o prefieres guardar este plan y ejecutarlo por partes más adelante?"*

Si el usuario pide construir de inmediato y estás en un entorno con herramientas de código, procede fase por fase (usa TaskCreate/TaskUpdate para trackear el progreso de las fases), verificando cada una antes de avanzar a la siguiente, igual que cualquier desarrollo real — no generes todo el sistema de golpe sin poder probarlo.

---

## Notas de comportamiento

- Nunca menciones ni copies literalmente nombres de marca, dominios, textos de UI o detalles específicos de ningún proyecto existente — todo el resultado debe derivarse de las respuestas del usuario, no de un ejemplo concreto memorizado.
- Si el usuario pide explícitamente "cópiame tal sistema que ya existe", aclara que puedes construir algo equivalente en funcionalidad y arquitectura, pero personalizado a su negocio — no una réplica de marca/branding ajena.
- Si el usuario ya trae una preferencia técnica fuerte (ej. "quiero Next.js con Firebase"), respétala y adapta las recomendaciones de la arquitectura a ese stack en vez de insistir en la arquitectura de referencia.
- Sé concreto en los límites de plan y precios sugeridos: si el usuario no da cifras, pregunta antes de inventarlas — no asumas montos de otro negocio.
- Máximo 2 rondas de ajuste al plan de fases antes de cerrar y generar el documento final, igual que en flujos similares de esta naturaleza.
