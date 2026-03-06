// 5.5 / 5.5 nefes — tek sayfa uygulama
// Görsel senkron: JS her frame'de --scale CSS değişkenini günceller.
// Ses: WebAudio ile inhale/exhale başlangıcında kısa "piyano benzeri" ton.

const PHASE_LEN = 5.5;       // saniye
const CYCLE_LEN = PHASE_LEN * 2;

const orb = document.getElementById("orb");
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

let durationSec = 5 * 60;
let remainingSec = durationSec;

let running = false;
let rafId = null;

// zaman referansları
let t0 = 0;            // performance.now() başlangıcı
let pausedAt = 0;      // pause zamanı
let elapsedBefore = 0; // pause öncesi geçen süre (sn)

// ses tetik bayrakları (aynı faz içinde 1 kez)
let lastPhase = "idle"; // "inhale" | "exhale" | "idle"

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

function easeInOut(t){
  // smoothstep benzeri
  return t * t * (3 - 2 * t);
}

function fmtMMSS(sec){
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function fmtPhase(sec){
  // 0.1 hassasiyet
  const v = Math.max(0, sec);
  return v.toFixed(1).padStart(4,"0");
}

function setDurationMinutes(min){
  durationSec = Math.round(min * 60);
  remainingSec = durationSec;
  elapsedBefore = 0;
  updateSessionUI(0);
  updateTotalUI();
  doneText.textContent = "";
}

function updateTotalUI(){
  sessionTotal.textContent = fmtMMSS(durationSec);
}

function updateSessionUI(elapsed){
  const left = Math.max(0, durationSec - elapsed);
  sessionTimer.textContent = fmtMMSS(left);
}

function setActivePreset(min){
  presetBtns.forEach(b => b.classList.toggle("active", Number(b.dataset.min) === min));
}

function ensureAudio(){
  if (!audioCtx){
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // iOS/Safari: user gesture sonrası resume gerekebilir
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function pianoLikeTone({freq=261.63, dur=0.22, type="triangle", bright=0.0}){
  // “piyano gibi” kısa atak + hızlı decay (tam piano değil ama rahat bir timbre)
  if (!soundToggle.checked) return;
  ensureAudio();
  const now = audioCtx.currentTime;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const filt = audioCtx.createBiquadFilter();

  // hafif parlaklık için lowpass kesimini ayarlıyoruz
  filt.type = "lowpass";
  filt.frequency.setValueAtTime(1200 + bright * 1800, now);
  filt.Q.setValueAtTime(0.7, now);

  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);

  // ADSR benzeri zarf
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.22, now + 0.01); // attack
  gain.gain.exponentialRampToValueAtTime(0.06, now + 0.06); // decay
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur); // release

  osc.connect(filt);
  filt.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(now);
  osc.stop(now + dur + 0.02);
}

function playInhaleSound(){
  // daha düşük ve yumuşak
  pianoLikeTone({freq: 261.63, dur: 0.23, type:"triangle", bright: 0.05}); // C4
}

function playExhaleSound(){
  // biraz daha tiz ve belirgin
  pianoLikeTone({freq: 329.63, dur: 0.20, type:"triangle", bright: 0.18}); // E4
}

function computeBreath(elapsed){
  // elapsed: toplam geçen süre (sn)
  const inCycle = elapsed % CYCLE_LEN;

  let phase, phaseProgress;
  if (inCycle < PHASE_LEN){
    phase = "inhale";
    phaseProgress = inCycle / PHASE_LEN; // 0..1
  } else {
    phase = "exhale";
    phaseProgress = (inCycle - PHASE_LEN) / PHASE_LEN; // 0..1
  }

  const phaseRemaining = PHASE_LEN * (1 - phaseProgress);

  return { phase, phaseProgress, phaseRemaining };
}

function setOrbScale(scale){
  document.documentElement.style.setProperty("--scale", scale.toFixed(4));
}

function updateLoop(){
  if (!running) return;

  const now = performance.now();
  const elapsed = elapsedBefore + (now - t0) / 1000;

  // seans bitti mi?
  if (elapsed >= durationSec){
    stopSession(true);
    return;
  }

  remainingSec = durationSec - elapsed;
  updateSessionUI(elapsed);

  // nefes fazı hesapla
  const { phase, phaseProgress, phaseRemaining } = computeBreath(elapsed);

  // faz geçişinde ses çal
  if (phase !== lastPhase){
    if (phase === "inhale") playInhaleSound();
    if (phase === "exhale") playExhaleSound();
    lastPhase = phase;
  }

  // UI metinleri
  phaseText.textContent = (phase === "inhale") ? "Nefes Al" : "Nefes Ver";
  phaseTimer.textContent = fmtPhase(phaseRemaining);

  // Ölçek: inhale 0.78 -> 1.08, exhale ters
  const t = easeInOut(clamp(phaseProgress, 0, 1));
  const minS = 0.78;
  const maxS = 1.08;

  let s;
  if (phase === "inhale") s = minS + (maxS - minS) * t;
  else s = maxS - (maxS - minS) * t;

  setOrbScale(s);

  rafId = requestAnimationFrame(updateLoop);
}

function startSession(){
  if (running) return;

  doneText.textContent = "";
  running = true;

  // audio context'ini kullanıcı etkileşimiyle aktive et
  ensureAudio();

  startBtn.disabled = true;
  pauseBtn.disabled = false;
  resetBtn.disabled = false;
  backBtn.disabled = false;
  customMin.disabled = true;
  presetBtns.forEach(b => b.disabled = true);

  // zaman başlat
  t0 = performance.now();
  lastPhase = "idle"; // ilk frame’de inhale/exhale sesi tetiklensin

  rafId = requestAnimationFrame(updateLoop);
}

function pauseSession(){
  if (!running) return;

  running = false;
  cancelAnimationFrame(rafId);

  pausedAt = performance.now();
  elapsedBefore += (pausedAt - t0) / 1000;

  startBtn.textContent = "Devam";
  startBtn.disabled = false;
  pauseBtn.disabled = true;
}

function resumeSession(){
  if (running) return;
  running = true;

  ensureAudio();
  t0 = performance.now();

  startBtn.disabled = true;
  pauseBtn.disabled = false;

  rafId = requestAnimationFrame(updateLoop);
}

function stopSession(completed=false){
  running = false;
  cancelAnimationFrame(rafId);

  // bitiş UI
  startBtn.textContent = "Başlat";
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  resetBtn.disabled = false;
  backBtn.disabled = false;

  customMin.disabled = false;
  presetBtns.forEach(b => b.disabled = false);

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

  elapsedBefore = 0;
  remainingSec = durationSec;
  lastPhase = "idle";

  startBtn.textContent = "Başlat";
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  resetBtn.disabled = true;
  backBtn.disabled = true;

  customMin.disabled = false;
  presetBtns.forEach(b => b.disabled = false);

  phaseText.textContent = "Hazır";
  phaseTimer.textContent = "00.0";
  doneText.textContent = "";
  updateSessionUI(0);
  setOrbScale(0.82);
}

function backOneCycle(){
  // 1 döngü (11 sn) geri sar
  // çalışıyorsa: elapsedBefore ve t0 bazlı geri al
  // durduysa: elapsedBefore'dan düş
  const back = CYCLE_LEN;

  if (running){
    const now = performance.now();
    const elapsed = elapsedBefore + (now - t0) / 1000;
    const newElapsed = Math.max(0, elapsed - back);

    // yeniden referansla
    elapsedBefore = newElapsed;
    t0 = performance.now();
    lastPhase = "idle"; // yeni faza göre sesi yeniden doğru tetiklemek için
  } else {
    elapsedBefore = Math.max(0, elapsedBefore - back);
    lastPhase = "idle";
    updateSessionUI(elapsedBefore);

    const { phase, phaseRemaining } = computeBreath(elapsedBefore);
    phaseText.textContent = (phase === "inhale") ? "Nefes Al" : "Nefes Ver";
    phaseTimer.textContent = fmtPhase(phaseRemaining);
  }
}

// --- Event wiring ---

presetBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    const min = Number(btn.dataset.min);
    customMin.value = String(min);
    setActivePreset(min);
    setDurationMinutes(min);
    resetBtn.disabled = true;
    backBtn.disabled = true;
    startBtn.textContent = "Başlat";
  });
});

customMin.addEventListener("change", () => {
  const v = clamp(Number(customMin.value || 5), 1, 240);
  customMin.value = String(v);
  setActivePreset(-1);
  setDurationMinutes(v);
  resetBtn.disabled = true;
  backBtn.disabled = true;
  startBtn.textContent = "Başlat";
});

startBtn.addEventListener("click", () => {
  if (!running && startBtn.textContent === "Devam") {
    resumeSession();
  } else {
    startSession();
  }
});

pauseBtn.addEventListener("click", pauseSession);

resetBtn.addEventListener("click", resetSession);

backBtn.addEventListener("click", backOneCycle);

// başlangıç
setActivePreset(5);
setDurationMinutes(5);
phaseText.textContent = "Hazır";
phaseTimer.textContent = "00.0";
updateTotalUI();
resetBtn.disabled = true;
backBtn.disabled = true;
``