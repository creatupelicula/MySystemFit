# MySystemFit — CRM de coach + app del alumno

Panel del coach (`index.html`) y app del alumno (`alumno.html`), conectados a Supabase (base de datos, auth, RLS, storage). Sitio estático, sin bundler — el "build" de Vercel solo genera `assets/js/config.js` a partir de variables de entorno.

## Estado actual

La base de datos del proyecto Supabase **MySystemFit** (`fqlwirnaproktxrtdqya`) ya tiene aplicado el schema completo, la migración de planes y el bucket de fotos. No hace falta correr SQL de nuevo; los archivos en `supabase/` quedan como referencia/respaldo.

### Planes (funcionando end-to-end)

| Plan | Límite de alumnos | Rutinas personalizadas | Comunidad | IA |
|---|---|---|---|---|
| Star | 30 | ✗ (candado + upsell) | ✗ | ✗ |
| Star Plus | 100 | ✓ | ✓ | ✗ |
| Kings (futuro) | 500 | ✓ | ✓ | pendiente |

- El límite de alumnos se valida en la app **y** con un trigger en la BD (`enforce_student_limit`), imposible de brincar desde el cliente.
- Todo coach nuevo se registra con plan **Star**. El plan se cambia por ahora directo en la tabla `profiles` (columna `plan`); los pagos online de suscripción vienen después.

### Features implementadas

**Coach** (`index.html`): dashboard con KPIs reales (ingresos cobrados del mes, activos, nuevos, pendientes), gráfico de ingresos con cobros reales de 12 meses, asistencia de hoy de alumnos presenciales, alumnos (alta con cuenta de acceso + membresía + cobro inicial sincronizado), pagos con KPIs reales, constructor de rutinas con **grupo muscular por ejercicio**, comunidad, mensajes en tiempo real, **referidos** (código personal `MSF-XXXXXX` + lista de coaches referidos), ajustes con plan y uso (barra X/límite).

**Alumno** (`alumno.html`): anillo de progreso según peso vs meta, membresía a la vista, **asistencia diaria para presenciales** (¿vas hoy? sí/no + motivo → el coach lo ve en su dashboard), rutina del día con músculo por ejercicio, fotos de progreso (Supabase Storage privado, URLs firmadas), evolución de peso, comunidad del coach, chat en tiempo real.

**Registro** (`login.html`): coach (con campo opcional de código de referido) o alumno (con ID del coach). El trigger `handle_new_user` crea el perfil, asigna plan Star, genera código de referido y registra el referido si aplica.

### Aislamiento multi-coach

RLS verificado por pruebas: un coach no ve alumnos/pagos/asistencia de otro; un alumno solo ve su propia ficha, rutina, pagos y fotos; el referidor solo ve nombre/email de sus referidos.

## Puesta en marcha (proyecto nuevo desde cero)

1. Crear proyecto en Supabase y ejecutar en el SQL Editor, en orden: `supabase/schema.sql` → `supabase/migration_planes.sql` → crear bucket privado `progress` con sus políticas (ver migración `storage_progress_bucket` aplicada al proyecto actual).
2. Credenciales: copiar `assets/js/config.example.js` como `assets/js/config.js` con `SUPABASE_URL` / `SUPABASE_ANON_KEY`. En Vercel se generan solas desde env vars (`scripts/generate-config.js`).
3. Abrir `login.html` y crear la cuenta del coach. Su ID (Ajustes) sirve para registrar alumnos; su código de referido (vista Referidos) para invitar coaches.

## Estructura

- `index.html` / `assets/js/app.js` — panel del coach.
- `alumno.html` / `assets/js/alumno.js` — app del alumno.
- `login.html` — autenticación (email + contraseña).
- `assets/js/api.js` — capa de datos (planes, límites, referidos, asistencia, finanzas y todo el CRUD).
- `assets/js/auth.js` — sesión, login/signup, alta de cuenta de alumno desde el panel.
- `supabase/schema.sql` + `supabase/migration_planes.sql` — schema completo de referencia.

## Pendiente (fuera del alcance actual, por decisión)

- **Pagos online** (suscripción del coach y cobros a alumnos) — siguiente fase.
- **Plan Kings + IA** (asistente, análisis de progreso, recomendaciones) — siguiente fase.
- Eliminar cuenta borra sesión pero no el usuario de `auth.users` (requiere Edge Function con `service_role`).
- Empaquetado iOS/Android (Capacitor es el camino natural para este stack) — cuando el producto web esté validado.
