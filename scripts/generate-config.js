// Genera assets/js/config.js a partir de variables de entorno.
// Se ejecuta en el build de Vercel (ver package.json → "build").
// En local, si no hay env vars, usa config.js existente (copiado de config.example.js).
const fs = require("fs");
const path = require("path");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.log("[generate-config] SUPABASE_URL / SUPABASE_ANON_KEY no están seteadas — se conserva config.js local si existe.");
  process.exit(0);
}

const out = `window.MSF_CONFIG = {\n  SUPABASE_URL: ${JSON.stringify(url)},\n  SUPABASE_ANON_KEY: ${JSON.stringify(key)},\n};\n`;
const dest = path.join(__dirname, "..", "assets", "js", "config.js");
fs.writeFileSync(dest, out);
console.log("[generate-config] config.js generado desde variables de entorno.");
