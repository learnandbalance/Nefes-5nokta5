// 5.5 / 5.5 nefes — sürekli akor (phase boyunca) + görsel senkron
const PHASE_LEN = 5.5;           // saniye
const CYCLE_LEN = PHASE_LEN * 2; // 11 saniye

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

let audioCtx = null;

// Seans süresi
let durationSec = 5 * 60;
let remainingSec = durationSec;

// Döngü kontrol
let running = false;
let rafId = null;

// Zaman referansları
let t0 = 0;            // performance.now() başlangıcı
let elapsedBefore = 0; // pause öncesi geçen süre (sn)
let lastPhase = "idle"; // "inhale" | "exhale" | "idle"

// --- yardımcılar ---
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

function easeInOut(t){
  // smoothstep
  return t * t * (3 - 2 * t);
}

function fmtMMSS(sec){
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function fmtPhase(sec){
  const v = Math.max(0, sec);
  return v.toFixed(1).padStart(4,"0");
}

function updateTotalUI(){
  sessionTotal.textContent = fmtMMSS(durationSec);
}

function updateSessionUI(elapsed){
  const left = Math.max(0, durationSec - elapsed);
  sessionTimer.textContent = fmtMMSS(left);
}

function setOrbScale(scale){
  document.documentElement.style.setProperty("--scale", scale.toFixed(4));
}

// --- süre seçimi ---
function setActivePreset(min){
  presetBtns.forEach(b => b.classList.toggle("active", Number(b.dataset.min) === min));
}

function setDurationMinutes(min){
  durationSec = Math.round(min * 60);
  remainingSec = durationSec;
  elapsedBefore = 0;
  doneText.textContent = "";
  updateSessionUI(0);
  updateTotalUI();

  // UI reset
  phaseText.textContent = "Hazır";
  phaseTimer.textContent = "00.0";
  setOrbScale(0.82);
  startBtn.textContent = "Başlat";
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  resetBtn.disabled = true;
  backBtn.disabled = true;
}

// --- audio ---
let chord = null; // { oscs, gain, filt, phase }

function ensureAudio(){
  if (!audioCtx){
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function stopChord(fadeOut = 0.12){
  if (!audioCtx || !chord) return;
  const now = audioCtx.currentTime;

  try{
    chord.gain.gain.cancelScheduledValues(now);
    const current = Math.max(0.0001, chord.gain.gain.value || 0.0001);
    chord.gain.gain.setValueAtTime(current, now);
    chord.gain.gain.exponentialRampToValueAtTime(0.0001, now + fadeOut);
  } catch(e){}

  chord.oscs.forEach(o => {
    try { o.stop(now + fadeOut + 0.03); } catch(e) {}
  });

  chord = null;
}

function startChord(phase){
  if (!soundToggle.checked) return;
  ensureAudio();

  const now = audioCtx.currentTime;

  // Inhale: daha sıcak (C maj) — Exhale: biraz daha "ferah" (D sus2)
  const inhaleChord = [261.63, 329.63, 392.00]; // C4 E4 G4
  const exhaleChord = [293.66, 329.63, 440.00]; // D4 E4 A4
  const freqs = (phase === "inhale") ? inhaleChord : exhaleChord;

  // Önce eski akoru yumuşak kapat (crossfade)
  stopChord(0.12);

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.18); // yumuşak attack

  const filt = audioCtx.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.setValueAtTime(1600, now);
  filt.Q.setValueAtTime(0.8, now);

  // Çok hafif stereo hissi için iki kanala küçük panning (opsiyonel)
  const panner = audioCtx.createStereoPanner();
  panner.pan.setValueAtTime(0, now);

  const oscs = [];

  freqs.forEach((f, i) => {
    // 2 katman: sine + triangle (yumuşak ama harmonik)
    const osc1 = audioCtx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(f, now);
    osc1.detune.setValueAtTime((i - 1) * 2.5, now);

    const osc2 = audioCtx.createOscillator();
    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(f, now);
    osc2.detune.setValueAtTime((1 - i) * 3.5, now);

    const noteGain = audioCtx.createGain();
    const level = 0.42 + (i === 1 ? 0.08 : 0.0); // orta nota biraz baskın
    noteGain.gain.setValueAtTime(level, now);

    osc1.connect(noteGain);
    osc2.connect(noteGain);
    noteGain.connect(filt);

    oscs.push(osc1, osc2);
  });

  // Zincir
  filt.connect(panner);
  panner.connect(gain);
  gain.connect(audioCtx.destination);

  oscs.forEach(o => o.start(now));

  chord = { oscs, gain, filt, phase };
}

function setPhaseAudio(phase){
  if (!soundToggle.checked) { stopChord(0.12); return; }
  if (chord && chord.phase === phase) return;
  startChord(phase);
}

// --- nefes hesap ---
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

  const phaseRemaining = PHASE_LEN * (1 - phaseProgress);
  return { phase, phaseProgress, phaseRemaining };
}

// --- ana loop ---
function updateLoop(){
  if (!running) return;

  const now = performance.now();
  const elapsed = elapsedBefore + (now - t0) / 1000;

  if (elapsed >= durationSec){
    stopSession(true);
    return;
  }

  remainingSec = durationSec - elapsed;
  updateSessionUI(elapsed);

  const { phase, phaseProgress, phaseRemaining } = computeBreath(elapsed);

  // faz değişiminde sürekli akoru değiştir
  if (phase !== lastPhase){
    setPhaseAudio(phase);
    lastPhase = phase;
  }

  // UI
  phaseText.textContent = (phase === "inhale") ? "Nefes Al" : "Nefes Ver";
  phaseTimer.textContent = fmtPhase(phaseRemaining);

  // Ölçek: inhale büyür, exhale küçülür
  const t = easeInOut(clamp(phaseProgress, 0, 1));
  const minS = 0.78;
  const maxS = 1.08;

  let s;
  if (phase === "inhale") s = minS + (maxS - minS) * t;
  else s = maxS - (maxS - minS) * t;

  setOrbScale(s);

  rafId = requestAnimationFrame(updateLoop);
}

// --- kontroller ---
function lockInputs(lock){
  customMin.disabled = lock;
  presetBtns.forEach(b => b.disabled = lock);
}

function startSession(){
  if (running) return;

  doneText.textContent = "";
  running = true;

  // iOS için audio kullanıcı etkileşimi ile aktive olur
  ensureAudio();

  startBtn.disabled = true;
  pauseBtn.disabled = false;
  resetBtn.disabled = false;
  backBtn.disabled = false;
  lockInputs(true);

  t0 = performance.now();
  lastPhase = "idle"; // ilk frame’de setPhaseAudio tetiklensin

  rafId = requestAnimationFrame(updateLoop);
}

function pauseSession(){
  if (!running) return;

  running = false;
  cancelAnimationFrame(rafId);

  const pausedAt = performance.now();
  elapsedBefore += (pausedAt - t0) / 1000;

  stopChord(0.10);

  startBtn.textContent = "Devam";
  startBtn.disabled = false;
  pauseBtn.disabled = true;
}

function resumeSession(){
  if (running) return;

  running = true;
  ensureAudio();

  startBtn.disabled = true;
  pauseBtn.disabled = false;

  t0 = performance.now();
  lastPhase = "idle"; // tekrar doğru faz akorunu başlatsın
  rafId = requestAnimationFrame(updateLoop);
}

function stopSession(completed=false){
  running = false;
  cancelAnimationFrame(rafId);
  stopChord(0.12);

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

    resetBtn.disabled = false;
    backBtn.disabled = false;
  }
}

function resetSession(){
  running = false;
  cancelAnimationFrame(rafId);
  stopChord(0.12);

  elapsedBefore = 0;
  remainingSec = durationSec;
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
    const newElapsed = Math.max(0, elapsed - back);

    elapsedBefore = newElapsed;
    t0 = performance.now();
    lastPhase = "idle"; // yeni fazın akorunu yeniden başlat
  } else {
    elapsedBefore = Math.max(0, elapsedBefore - back);
    updateSessionUI(elapsedBefore);

    const { phase, phaseRemaining } = computeBreath(elapsedBefore);
    phaseText.textContent = (phase === "inhale") ? "Nefes Al" : "Nefes Ver";
    phaseTimer.textContent = fmtPhase(phaseRemaining);
    setOrbScale(0.82);
  }
}

// --- event wiring ---
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
  if (!soundToggle.checked){
    stopChord(0.12);
  } else {
    // seans çalışıyorsa o anki fazın akorunu başlat
    if (running && lastPhase !== "idle") setPhaseAudio(lastPhase);
  }
});

// başlangıç
setActivePreset(5);
updateTotalUI();
updateSessionUI(0);
phaseText.textContent = "Hazır";
phaseTimer.textContent = "00.0";
setOrbScale(0.82);
``
