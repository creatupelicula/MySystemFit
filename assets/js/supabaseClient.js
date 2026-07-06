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
  // Safari en modo privado (o con "Lockdown Mode") puede lanzar al escribir en
  // localStorage en vez de solo ignorarlo silenciosamente; sin este fallback
  // la sesión ni siquiera se podría crear en memoria para esa pestaña.
  function safeStorage() {
    try {
      const k = "__msf_storage_test__";
      window.localStorage.setItem(k, "1");
      window.localStorage.removeItem(k);
      return window.localStorage;
    } catch (_) {
      const mem = new Map();
      return {
        getItem: (key) => (mem.has(key) ? mem.get(key) : null),
        setItem: (key, value) => { mem.set(key, value); },
        removeItem: (key) => { mem.delete(key); },
      };
    }
  }
  // flowType 'pkce' evita depender del fragmento #access_token en la URL de
  // retorno de OAuth, que Safari (ITP) maneja peor entre dominios distintos
  // (accounts.google.com -> mysystem.fit) que Chrome/Firefox.
  window.msfSupabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: safeStorage() },
  });
})();
