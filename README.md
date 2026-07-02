# MySystemFit — CRM de coach + app del alumno

Panel del coach (`index.html`) y app del alumno (`alumno.html`), conectados a Supabase (base de datos, auth, RLS). Sitio estático, sin bundler — el "build" de Vercel solo genera `assets/js/config.js` a partir de variables de entorno.

## Puesta en marcha

1. **Crear el proyecto en Supabase** (supabase.com/dashboard), con la cuenta que corresponda.
2. **Ejecutar el schema**: copia todo el contenido de `supabase/schema.sql` en el SQL Editor de tu proyecto y ejecútalo. Crea las tablas, políticas RLS y el trigger que genera el `profile` al registrarse.
3. **Configurar credenciales**:
   - Local: copia `assets/js/config.example.js` como `assets/js/config.js` y completa `SUPABASE_URL` / `SUPABASE_ANON_KEY` (Project Settings → API en Supabase).
   - Vercel: define las variables de entorno `SUPABASE_URL` y `SUPABASE_ANON_KEY` en el proyecto — el build las inyecta en `config.js` automáticamente (ver `scripts/generate-config.js`).
4. **Abrir `login.html`** — desde ahí se crea la cuenta del coach (rol "Soy coach"). Al registrarte, copia tu **ID de coach** (visible en Ajustes) y compártelo con tus alumnos para que se registren con rol "Soy alumno".

## Estructura

- `index.html` / `assets/js/app.js` — panel del coach: alumnos, pagos, rutinas, comunidad, mensajes.
- `alumno.html` / `assets/js/alumno.js` — app del alumno.
- `login.html` — autenticación (Supabase Auth, email + contraseña).
- `assets/js/supabaseClient.js` — cliente único de Supabase.
- `assets/js/auth.js` — guardas de sesión y helpers de login/signup.
- `assets/js/api.js` — capa de acceso a datos (toda la lectura/escritura a Supabase pasa por aquí).
- `supabase/schema.sql` — schema completo + RLS + trigger de creación de perfil.

## Pendiente conocido

- Subir fotos de progreso guarda solo una vista previa local — falta conectar Supabase Storage.
- El botón "Registrar pago" en Pagos y los KPIs de esa vista son estáticos.
- Eliminar cuenta cierra sesión pero no borra el usuario de `auth.users` (requiere `service_role` desde un backend/Edge Function, no se puede hacer con la anon key).
