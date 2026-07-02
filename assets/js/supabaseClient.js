/* Cliente único de Supabase, compartido por app.js y alumno.js.
   Requiere que config.js se haya cargado antes en el <script> del HTML. */
(function () {
  "use strict";
  const cfg = window.MSF_CONFIG;
  if (!cfg || !cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("TU-PROYECTO")) {
    document.addEventListener("DOMContentLoaded", () => {
      document.body.innerHTML =
        '<div style="font-family:sans-serif;max-width:520px;margin:80px auto;padding:24px;line-height:1.6">' +
        "<h2>Falta configurar Supabase</h2>" +
        "<p>Copia <code>assets/js/config.example.js</code> como <code>assets/js/config.js</code> " +
        "y completa <code>SUPABASE_URL</code> y <code>SUPABASE_ANON_KEY</code> con los datos de tu proyecto " +
        "(Project Settings → API en supabase.com).</p></div>";
    });
    window.msfSupabase = null;
    return;
  }
  window.msfSupabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
})();
