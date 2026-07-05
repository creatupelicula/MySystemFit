/* ============================================================
   MySystemFit — Sonidos sutiles de interfaz (Web Audio API).
   Sin archivos de audio: tonos cortos generados por código.
   ============================================================ */
window.msfSound = (function () {
  "use strict";
  const KEY = "msf_sound_enabled";
  let enabled = localStorage.getItem(KEY) !== "false"; // default: activado
  let ctx = null;

  function getCtx() {
    if (!ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      ctx = new Ctx();
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  // Presets discretos: frecuencia/duración/tipo de onda/volumen por acción.
  const PRESETS = {
    click:   { freq: 620,  dur: 0.05, type: "sine",     gain: 0.05 },
    confirm: { freq: 880,  dur: 0.12, type: "sine",     gain: 0.08 },
    save:    { freq: 740,  dur: 0.10, type: "triangle", gain: 0.07 },
    notify:  { freq: 1046, dur: 0.15, type: "sine",     gain: 0.06 },
    payment: { freq: 988,  dur: 0.18, type: "triangle", gain: 0.08 },
  };

  function playSound(name) {
    if (!enabled) return;
    const p = PRESETS[name] || PRESETS.click;
    try {
      const c = getCtx();
      if (!c) return;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = p.type;
      osc.frequency.value = p.freq;
      gain.gain.setValueAtTime(p.gain, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + p.dur);
      osc.connect(gain).connect(c.destination);
      osc.start();
      osc.stop(c.currentTime + p.dur);
    } catch (_) { /* silencioso: el sonido nunca debe romper la app */ }
  }

  function isEnabled() { return enabled; }
  function setEnabled(v) {
    enabled = !!v;
    try { localStorage.setItem(KEY, String(enabled)); } catch (_) {}
  }

  return { playSound, isEnabled, setEnabled };
})();
