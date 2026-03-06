// 5.5 / 5.5 nefes — bip/click önlemek için oscillator’lar sürekli, fazlarda crossfade
const PHASE_LEN = 5.5;
const CYCLE_LEN = PHASE_LEN * 2;

const phaseText = document.getElementById("phaseText");
const phaseTimer = document.getElementById("phaseTimer");
const sessionTimer = document.getElementById("sessionTimer");
const sessionTotal = document.getElementById("sessionTotal");
const doneText = document.getElementById("doneText");

const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const resetBtn = document.getElementById("resetBtn");
const backBtn = document.getElementById("backBtn");

const soundToggle = document.getElementById("soundToggle");
const customMin = document.getElementById("customMin");
const presetBtns = [...document.querySelectorAll(".preset")];

// süre
let durationSec = 5 * 60;

// durum
let running = false;
let rafId = null;
let t0 = 0;
let elapsedBefore = 0;
let lastPhase = "idle";

// -------- helpers --------
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function easeInOut(t){ return t * t * (3 - 2 * t); }

function fmtMMSS(sec){
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function fmtPhase(sec){
  return Math.max(0, sec).toFixed(1).padStart(4,"0");
}
function updateTotalUI(){ sessionTotal.textContent = fmtMMSS(durationSec); }
function updateSessionUI(elapsed){
  sessionTimer.textContent = fmtMMSS(Math.max(0, durationSec - elapsed));
}
function setOrbScale(scale){
  document.documentElement.style.setProperty("--scale", scale.toFixed(4));
}

// -------- duration UI --------
function setActivePreset(min){
  presetBtns.forEach(b => b.classList.toggle("active", Number(b.dataset.min) === min));
}
function lockInputs(lock){
  customMin.disabled = lock;
  presetBtns.forEach(b => b.disabled = lock);
}
function setDurationMinutes(min){
  durationSec = Math.round(min * 60);
  elapsedBefore = 0;
  doneText.textContent = "";
  updateTotalUI();
  updateSessionUI(0);

  phaseText.textContent = "Hazır";
  phaseTimer.textContent = "00.0";
  setOrbScale(0.82);

  startBtn.textContent = "Başlat";
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  resetBtn.disabled = true;
  backBtn.disabled = true;
}

// -------- Breath math --------
function computeBreath(elapsed){
  const inCycle = elapsed % CYCLE_LEN;
  let phase, phaseProgress;

  if (inCycle < PHASE_LEN){
    phase = "inhale";
    phaseProgress = inCycle / PHASE_LEN;
  } else {
    phase = "exhale";
    phaseProgress = (inCycle - PHASE_LEN) / PHASE_LEN;
  }

  return {
    phase,
    phaseProgress,
    phaseRemaining: PHASE_LEN * (1 - phaseProgress)
  };
}

// =========================
//          AUDIO
// =========================
let audioCtx = null;
let master = null;
let inhaleBus = null;
let exhaleBus = null;
let audioReady = false;

function ensureAudio(){
  if (!audioCtx){
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();

  if (!audioReady){
    buildAudioGraph();
    audioReady = true;
  }
}

function buildAudioGraph(){
  const now = audioCtx.currentTime;

  // master gain
  master = audioCtx.createGain();
  master.gain.setValueAtTime(0.0001, now);

  // “room” hissi: hafif delay + lowpass feedback (çok sakin)
  const delay = audioCtx.createDelay(0.35);
  delay.delayTime.value = 0.18;

  const fb = audioCtx.createGain();
  fb.gain.value = 0.18;

  const fbLP = audioCtx.createBiquadFilter();
  fbLP.type = "lowpass";
  fbLP.frequency.value = 1200;
  fbLP.Q.value = 0.7;

  // feedback loop
  delay.connect(fbLP);
  fbLP.connect(fb);
  fb.connect(delay);

  // çıkış zinciri
  // dry + wet karışımı için: master’a hem dry hem de delay’den dönelim
  const wet = audioCtx.createGain();
  wet.gain.value = 0.22;

  // master’a bağla
  master.connect(audioCtx.destination);

  // Delay’yi master’a düşük seviyede ekle
  delay.connect(wet);
  wet.connect(master);

  // iki bus (inhale/exhale) -> delay + master
  inhaleBus = createChordBus({
    freqs: [220.00, 277.18, 329.63], // A3 C#4 E4 (sakin, sıcak)
    color: "warm"
  });

  exhaleBus = createChordBus({
    freqs: [293.66, 369.99, 440.00], // D4 F#4 A4 (biraz daha tiz, net)
    color: "airy"
  });

  // bus’ları dry + wet’e bağla
  inhaleBus.out.connect(master);
  exhaleBus.out.connect(master);

  inhaleBus.out.connect(delay);
  exhaleBus.out.connect(delay);

  // başlangıçta sessiz
  inhaleBus.gain.gain.setValueAtTime(0.0001, now);
  exhaleBus.gain.gain.setValueAtTime(0.0001, now);
}

function createChordBus({freqs, color}){
  const now = audioCtx.currentTime;

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.0001, now);

  // “piyano-pad” hissi: saw çok az + sine baskın + filtre ile yumuşatma
  const lp = audioCtx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(color === "warm" ? 1400 : 1700, now);
  lp.Q.setValueAtTime(0.85, now);

  // çok hafif hareket (vibrato) -> daha doğal, akordeon gibi değil çok minimal
  const lfo = audioCtx.createOscillator();
  const lfoGain = audioCtx.createGain();
  lfo.type = "sine";
  lfo.frequency.value = 0.18;     // çok yavaş
  lfoGain.gain.value = 3.0;       // detune cents
  lfo.connect(lfoGain);

  // her nota için iki osilatör: sine (ana) + çok düşük saw (çok az harmonik)
  const oscs = [];
  const noteMix = audioCtx.createGain();
  noteMix.gain.value = 1.0;

  freqs.forEach((f, i) => {
    // SINE (ana)
    const s = audioCtx.createOscillator();
    s.type = "sine";
    s.frequency.setValueAtTime(f, now);
    s.detune.setValueAtTime((i - 1) * 1.5, now); // çok küçük detune
    lfoGain.connect(s.detune);

    // SAW (çok az, “piyano parlaklığı” için)
    const w = audioCtx.createOscillator();
    w.type = "sawtooth";
    w.frequency.setValueAtTime(f, now);
    w.detune.setValueAtTime((1 - i) * 1.0, now);
    lfoGain.connect(w.detune);

    // her notaya ayrı gain: saw çok düşük
    const gS = audioCtx.createGain();
    const gW = audioCtx.createGain();

    gS.gain.value = 0.33 + (i === 1 ? 0.05 : 0.0);  // sine
    gW.gain.value = 0.05;                            // saw (çok az)

    s.connect(gS);
    w.connect(gW);
    gS.connect(noteMix);
    gW.connect(noteMix);

    oscs.push(s, w);
  });

  noteMix.connect(lp);
  lp.connect(gain);

  // “out” = gain
  const out = gain;

  // başlat (sadece 1 kere)
  oscs.forEach(o => o.start(now));
  lfo.start(now);

  return { oscs, gain, out };
}

function setPhaseAudio(phase){
  if (!audioReady) return;
  const now = audioCtx.currentTime;
  const FADE = 0.22; // yumuşak crossfade

  // ses kapalıysa ikisini de kıs
  if (!soundToggle.checked){
    inhaleBus.gain.gain.cancelScheduledValues(now);
    exhaleBus.gain.gain.cancelScheduledValues(now);
    inhaleBus.gain.gain.setTargetAtTime(0.0001, now, 0.06);
    exhaleBus.gain.gain.setTargetAtTime(0.0001, now, 0.06);
    master.gain.setTargetAtTime(0.0001, now, 0.06);
    return;
  }

  // master aç
  master.gain.cancelScheduledValues(now);
  master.gain.setTargetAtTime(0.22, now, 0.08);

  // crossfade
  if (phase === "inhale"){
    inhaleBus.gain.gain.cancelScheduledValues(now);
    exhaleBus.gain.gain.cancelScheduledValues(now);

    inhaleBus.gain.gain.setTargetAtTime(0.22, now, FADE);
    exhaleBus.gain.gain.setTargetAtTime(0.0001, now, FADE);
  } else {
    inhaleBus.gain.gain.cancelScheduledValues(now);
    exhaleBus.gain.gain.cancelScheduledValues(now);

    inhaleBus.gain.gain.setTargetAtTime(0.0001, now, FADE);
    exhaleBus.gain.gain.setTargetAtTime(0.22, now, FADE);
  }
}

function stopAudioSoft(){
  if (!audioReady) return;
  const now = audioCtx.currentTime;

  inhaleBus.gain.gain.cancelScheduledValues(now);
  exhaleBus.gain.gain.cancelScheduledValues(now);
  master.gain.cancelScheduledValues(now);

  inhaleBus.gain.gain.setTargetAtTime(0.0001, now, 0.07);
  exhaleBus.gain.gain.setTargetAtTime(0.0001, now, 0.07);
  master.gain.setTargetAtTime(0.0001, now, 0.09);
}

// =========================
//        MAIN LOOP
// =========================
function updateLoop(){
  if (!running) return;

  const now = performance.now();
  const elapsed = elapsedBefore + (now - t0) / 1000;

  if (elapsed >= durationSec){
    stopSession(true);
    return;
  }

  updateSessionUI(elapsed);

  const { phase, phaseProgress, phaseRemaining } = computeBreath(elapsed);

  if (phase !== lastPhase){
    // faz değişiminde sadece crossfade (bip yok)
    setPhaseAudio(phase);
    lastPhase = phase;
  }

  phaseText.textContent = (phase === "inhale") ? "Nefes Al" : "Nefes Ver";
  phaseTimer.textContent = fmtPhase(phaseRemaining);

  const t = easeInOut(clamp(phaseProgress, 0, 1));
  const minS = 0.78;
  const maxS = 1.08;

  const s = (phase === "inhale")
    ? (minS + (maxS - minS) * t)
    : (maxS - (maxS - minS) * t);

  setOrbScale(s);

  rafId = requestAnimationFrame(updateLoop);
}

// =========================
//        CONTROLS
// =========================
function startSession(){
  if (running) return;

  doneText.textContent = "";
  running = true;

  ensureAudio(); // iOS için user gesture ile çağrılıyor
  lastPhase = "idle"; // ilk frame’de setPhaseAudio çalışsın

  startBtn.disabled = true;
  pauseBtn.disabled = false;
  resetBtn.disabled = false;
  backBtn.disabled = false;
  lockInputs(true);

  t0 = performance.now();
  rafId = requestAnimationFrame(updateLoop);
}

function pauseSession(){
  if (!running) return;

  running = false;
  cancelAnimationFrame(rafId);

  const pausedAt = performance.now();
  elapsedBefore += (pausedAt - t0) / 1000;

  stopAudioSoft();

  startBtn.textContent = "Devam";
  startBtn.disabled = false;
  pauseBtn.disabled = true;
}

function resumeSession(){
  if (running) return;

  running = true;
  ensureAudio();
  lastPhase = "idle";

  startBtn.disabled = true;
  pauseBtn.disabled = false;

  t0 = performance.now();
  rafId = requestAnimationFrame(updateLoop);
}

function stopSession(completed=false){
  running = false;
  cancelAnimationFrame(rafId);

  stopAudioSoft();
  lockInputs(false);

  startBtn.textContent = "Başlat";
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  resetBtn.disabled = false;
  backBtn.disabled = false;

  if (completed){
    updateSessionUI(durationSec);
    phaseText.textContent = "Tamamlandı";
    phaseTimer.textContent = "00.0";
    doneText.textContent = " • Seans bitti.";
    setOrbScale(0.82);
  }
}

function resetSession(){
  running = false;
  cancelAnimationFrame(rafId);

  stopAudioSoft();

  elapsedBefore = 0;
  lastPhase = "idle";

  lockInputs(false);

  startBtn.textContent = "Başlat";
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  resetBtn.disabled = true;
  backBtn.disabled = true;

  phaseText.textContent = "Hazır";
  phaseTimer.textContent = "00.0";
  doneText.textContent = "";
  updateSessionUI(0);
  setOrbScale(0.82);
}

function backOneCycle(){
  const back = CYCLE_LEN;

  if (running){
    const now = performance.now();
    const elapsed = elapsedBefore + (now - t0) / 1000;
    elapsedBefore = Math.max(0, elapsed - back);
    t0 = performance.now();
    lastPhase = "idle";
  } else {
    elapsedBefore = Math.max(0, elapsedBefore - back);
    updateSessionUI(elapsedBefore);

    const { phase, phaseRemaining } = computeBreath(elapsedBefore);
    phaseText.textContent = (phase === "inhale") ? "Nefes Al" : "Nefes Ver";
    phaseTimer.textContent = fmtPhase(phaseRemaining);
  }
}

// ---- events ----
presetBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    const min = Number(btn.dataset.min);
    customMin.value = String(min);
    setActivePreset(min);
    setDurationMinutes(min);
  });
});

customMin.addEventListener("change", () => {
  const v = clamp(Number(customMin.value || 5), 1, 240);
  customMin.value = String(v);
  setActivePreset(-1);
  setDurationMinutes(v);
});

startBtn.addEventListener("click", () => {
  if (!running && startBtn.textContent === "Devam") resumeSession();
  else startSession();
});

pauseBtn.addEventListener("click", pauseSession);
resetBtn.addEventListener("click", resetSession);
backBtn.addEventListener("click", backOneCycle);

soundToggle.addEventListener("change", () => {
  if (!audioReady) return;
  if (!soundToggle.checked) stopAudioSoft();
  else if (running && lastPhase !== "idle") setPhaseAudio(lastPhase);
});

// init
setActivePreset(5);
updateTotalUI();
updateSessionUI(0);
phaseText.textContent = "Hazır";
phaseTimer.textContent = "00.0";
setOrbScale(0.82);
