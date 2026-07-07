---
name: mysystemfit-contexto
description: "Contexto completo y detallado del proyecto MySystemFit (este CRM): qué es, para quién es, arquitectura técnica, modelo de datos, planes y permisos, todos los módulos/funciones, sistema de diseño, historial de mejoras y pendientes reales. Úsala cuando necesites el panorama completo del proyecto antes de planear un cambio grande, escribir documentación, un pitch, onboarding de un colaborador nuevo, o cuando el usuario pregunte 'qué es este proyecto', 'dame el contexto completo', 'explícame todo el sistema', 'resume MySystemFit', 'qué hace el CRM', 'documenta el proyecto', 'cuál es el alcance actual'."
---

# Contexto completo — MySystemFit (CRM COACHS)

Esta skill es la fuente única y detallada de contexto de ESTE proyecto específico. No es un tutorial genérico: describe exactamente lo que existe, cómo está construido y por qué, para que cualquier trabajo futuro (código, documentación, pitch, auditoría) parta de la realidad actual del sistema y no de suposiciones.

**Regla de uso:** si vas a usar esta skill para generar documentación o un pitch, prioriza precisión sobre entusiasmo de marketing — todo lo escrito aquí debe poder verificarse contra el código o la base de datos. Si algo cambió desde la última actualización de esta skill, dilo explícitamente en vez de asumir que sigue igual (ver "Cómo mantener esta skill actualizada" al final).

---

## 1. Qué es y para quién

**MySystemFit** es un CRM/SaaS para **coaches y entrenadores personales** (fitness, fuerza, online/presencial) que gestionan alumnos de forma profesional. Reemplaza hojas de cálculo, WhatsApp suelto y seguimiento manual con un panel único donde el coach:

- Da de alta y administra a sus alumnos (fichas, estado, pagos).
- Define objetivos/metas y los asigna.
- Se comunica por chat integrado.
- Ve asistencia/encuesta diaria de sus alumnos.
- Cobra su propia membresía a la plataforma vía Stripe (planes Free/Star/Star Plus).
- Gana puntos de referidos por invitar a otros coaches que se suscriben.

El **alumno** tiene su propia app (misma base de código, vista distinta) donde ve su ficha, objetivos, progreso, confirma asistencia/entrenamiento del día, chatea con su coach y participa en una comunidad (según el plan de su coach).

Dominio de producción: **mysystem.fit**. Repositorio: `github.com/creatupelicula/MySystemFit`, deploy automático a Vercel (proyecto `mysystemfit`) al hacer push a `master`.

---

## 2. Arquitectura técnica

- **Frontend**: sitio estático multi-página, **vanilla JS** (sin framework — sin React/Vue), HTML+CSS a mano. Páginas principales: `index.html` (dashboard del coach, app de una sola página con vistas por `data-nav`), `alumno.html` (app del alumno), `login.html` (login/signup/recuperación/gate de código de coach), `onboarding.html` (wizard del coach nuevo), `select-plan.html` (selección de plan).
- **Backend de datos**: **Supabase** (Postgres + Auth + Realtime + Storage), proyecto `fqlwirnaproktxrtdqya`. Toda la lógica de negocio sensible vive en **RPCs `SECURITY DEFINER`** en Postgres (no en el cliente) protegidas por **RLS** en cada tabla — el cliente nunca es la última línea de defensa, solo evita parpadeos de UI.
- **Pagos**: **Stripe** en cuenta LIVE (`acct_1TpIC6ApZFJajGb5`) — suscripciones del coach a la plataforma (Star $500 MXN/mes, Star Plus $1,000 MXN/mes), Embedded Checkout dentro de la app, portal de cliente, webhook (`api/webhook.js`) como fuente de verdad de sincronización de plan.
- **Serverless**: funciones en `api/*.js` sobre Vercel (Node) para todo lo que requiere `service_role`/claves secretas: checkout, portal, webhook, invoices, delete-account, cancel-subscription, confirm-trial-upgrade, redeem-referral. Patrón común en `api/_lib.js`: `coachFromToken`/`userFromToken` valida el JWT del usuario y da acceso admin controlado.
- **Realtime**: tablas publicadas en `supabase_realtime` (messages, students, payments, student_objectives, attendance, community_posts/comments/likes, profiles) para que cambios de membresía, pagos, objetivos y comunidad se reflejen en vivo sin refrescar. *Gotcha conocido*: un binding `postgres_changes` con filtro no dispara si comparte canal con demasiados otros bindings — cada binding filtrado va en su propio canal dedicado.
- **JS de cliente clave**: `assets/js/supabaseClient.js` (cliente único, PKCE explícito + fallback de storage en memoria para Safari), `auth.js` (guardas de sesión, gate de onboarding/plan del coach), `api.js` (capa central de acceso a datos + `PLAN_FEATURES`/`can()` espejo del backend), `app.js` (lógica del panel del coach), `alumno.js` (lógica de la app del alumno), `checkout-shared.js` (checkout embebido compartido entre `index.html` y `select-plan.html`), `sound.js` (Web Audio API, sin archivos de audio).
- **Diseño**: sistema de tokens CSS en `assets/css/tokens.css` — tema oscuro (`--bg-base:#07080C`), acento primario azul eléctrico (`--indigo:#2E6BFF`), acento positivo/progreso cian (`--lime:#39D0FF`), acento de alerta/poder rojo-coral (`--coral:#FF2E4D`), ámbar para "pendiente". Estética premium/fitness, glows y soft-colors sobre superficies oscuras escalonadas (`surface`/`surface-2`/`surface-3`).

---

## 3. Modelo de datos (tablas centrales)

- `profiles` — una fila por usuario (coach o alumno), `role`, `plan` (solo coaches; alumno hereda vía `my_coach_plan()`), `plan_selected`, `basic_info_completed`, `onboarding_completed`, `referral_code` (formato `MSF-XXXXXX`), datos de onboarding (`location`, `current_students_count`, `business_goal`, `years_experience`, `bio`, `phone`, `training_modes`), campos de regalo de referidos (`gift_plan`, `pre_gift_plan`, `gift_started_at`, `gift_ends_at`, `gift_warned_at`, `stripe_schedule_id`), Stripe (`stripe_customer_id`, `stripe_subscription_id`).
- `students` — ficha de cada alumno bajo un coach: `coach_id`, `profile_id` (nullable — puede existir antes de que el alumno tenga cuenta, `ON DELETE SET NULL`, no cascade), `state` interno (ya no editable a mano, ver abajo), `last_activity_at` (se actualiza solo por triggers en `messages`/`attendance`), `training_type` (Online/Presencial, determina el tipo de encuesta diaria), datos de onboarding del alumno (edad, sexo, altura, experiencia, motivación, etc.). El estado que ve el coach es **100% calculado**: vista `students_with_state` + función `student_display_state()` (SECURITY DEFINER, lee `auth.users.last_sign_in_at`) devuelven `activo` / `suspendido` (30+ días sin login ni actividad) / `sin_iniciar_sesion`. El cliente lee de esa vista, nunca de la columna `state` cruda.
- `payments` — pagos manuales que el coach registra por alumno (estado `ok`/`pend`), base de "Facturación"/dashboard.
- `coach_objectives` / `student_objectives` — catálogo de metas (filas `is_system=true` compartidas por todos + filas custom por coach, Star+) y asignación/seguimiento por alumno.
- `attendance` — encuesta diaria rediseñada: `response` (sí/no), `attend_date`, `scheduled_time`, `reason` (obligatorio si `response='no'`); presencial confirma para MAÑANA, online reporta HOY.
- `messages`, `community_posts`/`community_comments`/`community_likes` — chat 1:1 coach-alumno y comunidad (Star Plus).
- `routines`/`routine_days`/`routine_exercises` — rutinas de entrenamiento (Star Plus).
- `notifications` — centro de notificaciones real para coach Y alumno (mensajes, objetivo asignado/actualizado, pago confirmado, rutina asignada/actualizada se insertan solos vía triggers; RLS separada por rol). Tabla y `coach_objectives` están publicadas en `supabase_realtime`.
- `referral_rewards` (idempotencia por `unique(referral_id)`) y `membership_events` (auditoría de regalos/cancelaciones, sin FK a Stripe para sobrevivir aunque el objeto de Stripe se borre).
- La mayoría de las FK hacia `profiles(id)` son `on delete cascade` (corregido explícitamente — antes bloqueaban el borrado real de cuentas), **excepto** `students.profile_id` y `profiles.coach_id`/`profiles.referred_by`, que son `on delete set null` a propósito (borrar el perfil de un alumno no debe borrar silenciosamente la ficha de negocio del coach, ni borrar a un coach debe arrastrar las cuentas de sus alumnos). Por eso el borrado de alumno (`api/delete-student.js`) y de cuenta propia (`api/delete-account.js`) borran la fila de `students` **explícitamente** después de borrar `auth.users` — si no, queda un alumno fantasma "sin cuenta" con `profile_id=null`.

---

## 4. Planes y sistema de permisos

Tres planes de coach: **Free** (default universal, 30 alumnos, solo Dashboard/Alumnos/Pagos/Ajustes), **Star** (100 alumnos, $500 MXN/mes, +mensajes/objetivos/fotos de progreso), **Star Plus** (300 alumnos, $1,000 MXN/mes, +comunidad/rutinas). Existe un plan oculto "Kings" solo como constante interna, sin uso activo.

- **Fuente de verdad = base de datos**: `plan_features(plan) jsonb` + RPC `can(cap)` (evalúa `my_coach_plan()`). El cliente (`api.js` → `PLAN_FEATURES`/`api.can()`) replica esto solo para evitar parpadeos visuales; la protección real está en las políticas RLS de cada tabla (`messages`, `coach_objectives`/`student_objectives`, `progress_photos`, `community_*`, `routines*`), así que ni manipulando la URL o el DOM se puede saltar el gating.
- **Alumno nunca tiene plan propio** — siempre hereda el de su coach.
- **Regla de UX de gating (importante, decisión explícita del producto)**: por defecto, una función bloqueada para el alumno **NO se oculta**, se muestra atenuada (`.is-locked`) y al tocarla da un mensaje neutro sin ningún CTA de upgrade — el alumno nunca ve opciones de mejorar plan, eso es exclusivo del coach. Solo dos excepciones se ocultan por completo (`display:none`): la card "Rutina de hoy" en Home y el ícono de campana/chat de la topbar del alumno.
- El coach sí ve upsell real: modal `#modal-upsell` con plan/beneficios/precio y botón directo a `startCheckout(plan)`.

---

## 5. Módulos y funciones (estado actual, todo verificado en navegador y desplegado)

**Autenticación y onboarding del coach**: signup email/password + Google OAuth (PKCE), wizard `onboarding.html` de 7 preguntas (nombre, celular, ciudad/país, años de experiencia, número de alumnos actuales, modalidad Presencial/Online/híbrida, objetivo principal del negocio) → pantalla de **recomendación automática de plan** con texto dinámico según las respuestas reales → `select-plan.html` (tarjetas Free/Star/Star Plus generadas desde una única fuente de verdad, con "Recomendado para ti") → si el plan es Star/Star Plus, paso final obligatorio de crear 3 objetivos personalizados. Gate central en `auth.js` (`coachLandingPage`/`requireCoachReady`): rol → datos básicos → plan elegido → onboarding completo → dashboard, en ese orden estricto, incluso vía URL directa.

**Vinculación alumno-coach**: dos mecanismos — enlace de invitación (`register?coach=<uuid>`) y **código amigable `MSF-XXXXXX`** (que el coach comparte desde Ajustes/Referidos), validable en vivo y usable tanto en el formulario de registro como en la pantalla obligatoria post-login ("gate de código") para alumnos que entraron por Google sin invitación.

**Onboarding del alumno**: wizard de varios pasos (objetivo del catálogo del coach o texto libre, edad, sexo, altura, experiencia, motivación) que se muestra una sola vez, con auto-asignación de objetivos por `goal_type`.

**Gestión de alumnos (coach)**: alta/edición/eliminación real vía `api/delete-student.js` (borra la cuenta completa del alumno si ya tenía una —`auth.users` + la fila de `students`, que no cascadea sola— o solo la fila si nunca se registró), 3 estados visibles calculados automáticamente (`Activo`/`Suspendido`/`Sin iniciar sesión`, ver sección 3), vista tabla y tarjetas (responsive), modal de límite de alumnos por plan, tabs de ficha bloqueadas en Free.

**Pagos**: registro manual de pagos por alumno con máscara de moneda MXN en vivo (acepta `1000`, `1,000`, `1 000`, `1000.00`, `1000,00`, formatea con separador de miles mientras se escribe — mismo parser/formatter en `api.js` usado por el modal de alta de alumno y el de Pagos), contador de pendientes por alumno único (no por fila de pago), facturación interna del coach vía Stripe Invoices sin salir de la app.

**Objetivos**: catálogo de 5 objetivos de sistema (fijos, editables solo por SQL directo) + objetivos custom por coach (Star+, obligatorios 3 desde el onboarding); asignación y seguimiento por alumno; autoservicio del alumno para elegir su objetivo de catálogo. Realtime de doble vía: cambios del coach en `coach_objectives` y asignaciones en `student_objectives` se reflejan solos en ambos lados (canales dedicados).

**Rutinas** (Star Plus): rutinas por día/ejercicio asignadas por el coach.

**Mensajes/chat** (Star+): 1:1 coach-alumno, realtime.

**Comunidad** (Star Plus): posts/comentarios/likes con aislamiento estricto por coach (RLS reforzada tras un fix de seguridad real).

**Encuesta/asistencia diaria** (Free, disponible siempre): presencial confirma para el día siguiente con wheel picker de horario (CSS puro, sin librerías); online reporta el entrenamiento del día. Panel del coach con filtros, orden y estadísticas.

**Notificaciones**: centro de notificaciones real (tabla `notifications`, publicada en `supabase_realtime`) para coach Y alumno. Coach: mezcla eventos derivados (pagos/seguimientos) con notificaciones reales marcadas `read`. Alumno: campana independiente del chat (`#aBellBtn`/`#aNotifPanel` en `alumno.html`), alimentada por triggers automáticos en `messages` (mensaje del coach), `student_objectives` (asignado/actualizado), `payments` (confirmado) y `routines` (asignada/actualizada), con RLS propia (`notifications_student_read/update`). El chat sigue siendo un módulo aparte, accesible desde el tab "Coach" del bottom nav.

**Referidos por puntos**: un coach referido da puntos al que lo invitó solo cuando completa registro + paga + el pago se mantiene activo (Star=1pt, Star Plus=2pt). Star: a 4 puntos puede canjear manualmente 1 mes gratis de Star, o seguir a 5 para subir automáticamente a Star Plus gratis. Star Plus: a 4 puntos, sube automático 1 mes gratis. Mecánica real con cupones Stripe y `subscriptionSchedules`, aviso previo de fin de regalo (perezoso, en cada login), conversión a plan real antes de que acabe el regalo, cancelación de membresía al final del periodo con historial auditado en `membership_events`.

**Sonidos**: `assets/js/sound.js`, tonos cortos generados con Web Audio API (sin archivos), toggle en Ajustes de coach y alumno, distintos presets (incluye uno grave para acciones destructivas como eliminar).

**Eliminación de cuentas (real)**: tanto coach como alumno pueden borrar su cuenta de verdad desde Ajustes (`api/delete-account.js`, botón ya presente también en `alumno.html`) — cancela cualquier suscripción de Stripe activa de inmediato, borra `auth.users` (cascada real a todo lo dependiente: perfil, objetivos, rutinas, mensajes, notificaciones, etc.), borra explícitamente la fila de `students` del alumno (no cascadea sola, ver sección 3), y una sesión vieja de una cuenta ya borrada es expulsada con aviso claro en el próximo intento de uso. El mismo correo puede volver a registrarse después como si fuera nuevo (no hay bloqueo permanente del email, no se recupera nada de la cuenta anterior). El coach también puede eliminar la cuenta completa de un alumno específico desde su panel (`api/delete-student.js`), no solo la relación.

**Compatibilidad Safari**: PKCE explícito en el cliente de Supabase + fallback de storage en memoria si `localStorage` falla (modo privado agresivo/Lockdown Mode); login por email y Google OAuth usan redirect de página completa (no popups), evitando el bloqueo de Safari a popups sin gesto directo.

**Mobile**: sidebar con botón de cierre y cierre por toque-fuera, vista de Alumnos fuerza tarjetas responsive bajo 820px, modales con `.form-grid` responsivo.

---

## 6. Reglas operativas de este proyecto (para quien trabaje en el código)

- **Nunca** confiar solo en el cliente para permisos — toda regla de negocio sensible debe reforzarse con RLS/RPC `SECURITY DEFINER` en la base de datos.
- **Nunca** borrar datos permanentemente por cuenta propia (`delete from auth.users`, vaciar tablas) aunque el usuario lo autorice explícitamente y de forma repetida — dar la instrucción/SQL para que el usuario mismo lo ejecute en el dashboard o SQL editor.
- Antes de tocar claves de Stripe/entorno en Vercel: el usuario las pega él mismo, Claude no debe manipular esas variables.
- Confirmación explícita del usuario antes de todo `git push origin master`. Cambios que son solo migraciones SQL (sin tocar archivos del repo) no requieren push ni deploy — comunicar esa distinción cada vez.
- Para reproducir bugs de flujos con RPC, usar cuentas de prueba reales vía `signInWithPassword` (insertar en `auth.users` + `auth.identities` con todos los campos de token como `''`, nunca `NULL`) y revisar `preview_network` de la request fallida — el body trae el código real de Postgres (ej. `23514`), mucho más útil que el mensaje traducido que ve el usuario.
- Después de cualquier migración que toque permisos, correr `get_advisors(security)` y comparar contra el baseline conocido (solo warnings esperados de funciones `SECURITY DEFINER` auto-validadas por `auth.uid()`).
- Actualizar la memoria persistente del proyecto (`mysystemfit-estado.md`) tras cada módulo cerrado, seccionado por fecha con `Why:`/`How to apply:`.

---

## 7. Mejoras identificadas pero NO implementadas (pendientes reales)

- Pegar las 3 claves LIVE de Stripe en Vercel (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`) + price IDs live — pendiente de que el usuario las configure.
- SMTP propio (Resend u otro) — el SMTP de Supabase limita ~2 correos/hora, bloqueante real para registro/recuperación de contraseña en producción.
- Activar "Leaked password protection" en Supabase Auth (toggle manual, no vía SQL/MCP).
- Cobro online a alumnos (hoy 100% manual/registro por el coach) — no solicitado aún, solo existe el cobro de la suscripción del coach a la plataforma.
- Prueba humana real en dispositivo Safari/iPhone físico de los fixes de compatibilidad (el entorno de desarrollo solo puede probar en Chromium).
- Prueba con dinero real (tarjeta de prueba controlada) de la mecánica de cupones/schedules de referidos antes de anunciarla a coaches reales — se reverificó la capa SQL/RPC/webhook línea por línea (correcta) pero sigue sin probarse con un cobro real de Stripe en modo test.
- El estado automático "Suspendido" del alumno solo detecta inactividad vía login, mensajes propios y respuestas de asistencia — no considera fotos de progreso ni registros de peso como señal de actividad; podría ampliarse si se ve que da falsos "suspendido".
- Notificaciones derivadas del alumno (ej. "pago por vencer en X días", "recordatorio de entrenamiento") no están implementadas todavía — hoy solo hay notificaciones reales por evento (mensaje, objetivo, pago confirmado, rutina), igual que "cambio de plan" y "nuevas funciones disponibles" del pedido original.

---

## Cómo mantener esta skill actualizada

Cada vez que se cierre un módulo nuevo (código comiteado + desplegado + verificado), actualiza las secciones relevantes de este archivo (no solo la memoria de sesión) para que la próxima vez que se invoque esta skill refleje el estado real, no uno desactualizado. Si hay conflicto entre lo que dice esta skill y lo que muestra el código/la base de datos actual, confía en el código/BD y corrige este archivo.
