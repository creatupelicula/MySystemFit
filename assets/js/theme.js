/* ============================================================
   MySystemFit — Tema (claro/oscuro) + color de acento.
   Se carga ANTES que app.js/alumno.js en todas las páginas para
   evitar parpadeo. Persiste en localStorage y aplica al instante.
   ============================================================ */
window.msfTheme = (function () {
  "use strict";
  const KEY_MODE = "msf_theme_mode";      // 'dark' | 'light'
  const KEY_ACCENT = "msf_accent";        // hex, ej '#6C5CE7'

  /* Paleta de acentos sugeridos (el primero es el default de la marca) */
  const PRESETS = [
    { name: "Azul eléctrico", hex: "#2E6BFF" },
    { name: "Rojo energía", hex: "#FF2E4D" },
    { name: "Cian", hex: "#39D0FF" },
    { name: "Violeta", hex: "#9B5CF6" },
    { name: "Ámbar", hex: "#F59E0B" },
    { name: "Rosa", hex: "#EC4899" },
    { name: "Verde", hex: "#22C55E" },
    { name: "Azul cielo", hex: "#3B82F6" },
  ];

  /* ---- utilidades de color ---- */
  function hexToRgb(hex) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  }
  function mix(hex, target, amt) {
    const a = hexToRgb(hex), b = hexToRgb(target);
    return rgbToHex(a.r + (b.r - a.r) * amt, a.g + (b.g - a.g) * amt, a.b + (b.b - a.b) * amt);
  }
  function rgba(hex, a) { const { r, g, b } = hexToRgb(hex); return `rgba(${r}, ${g}, ${b}, ${a})`; }

  /* ---- aplicar ---- */
  function applyAccent(hex) {
    const root = document.documentElement.style;
    root.setProperty("--indigo", hex);
    root.setProperty("--indigo-hi", mix(hex, "#ffffff", 0.18));
    root.setProperty("--indigo-lo", mix(hex, "#000000", 0.15));
    root.setProperty("--indigo-soft", rgba(hex, 0.14));
    root.setProperty("--indigo-glow", rgba(hex, 0.35));
  }
  function applyMode(mode) {
    document.documentElement.setAttribute("data-theme", mode);
  }

  /* ---- API pública ---- */
  function getMode() { return localStorage.getItem(KEY_MODE) || "dark"; }
  function getAccent() { return localStorage.getItem(KEY_ACCENT) || PRESETS[0].hex; }
  function setMode(mode) { localStorage.setItem(KEY_MODE, mode); applyMode(mode); }
  function toggleMode() { const next = getMode() === "light" ? "dark" : "light"; setMode(next); return next; }
  function setAccent(hex) { localStorage.setItem(KEY_ACCENT, hex); applyAccent(hex); }
  function reset() { localStorage.removeItem(KEY_ACCENT); applyAccent(PRESETS[0].hex); }

  /* Migración: si el acento guardado es el índigo viejo de la marca
     anterior, se resetea al azul eléctrico actual. */
  if ((localStorage.getItem(KEY_ACCENT) || "").toLowerCase() === "#6c5ce7") {
    localStorage.removeItem(KEY_ACCENT);
  }

  /* Aplicar de inmediato al cargar el script */
  applyMode(getMode());
  applyAccent(getAccent());

  return { PRESETS, getMode, getAccent, setMode, toggleMode, setAccent, reset };
})();
