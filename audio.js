/* =========================================================
   AUDIO.JS — Bayroqlar Jangi uchun fon musiqasi
   Web Audio API orqali protsedural ravishda yaratilgan,
   uzluksiz halqa (loop) bo'lib yangraydigan epik/kinematik
   fon musiqasi. Hech qanday tashqi audio-fayl kerak emas.
   index.js va index.css ga tegilmagan — mustaqil modul.
   ========================================================= */

(function () {
  "use strict";

  // ---------- CONFIG ----------
  const MUSIC_CONFIG = {
    bpm: 96,
    masterVolume: 0.52,     // balandlashtirildi — endi ko'p bayroq to'qnashsa ham eshitiladi
    padVolume: 0.62,
    bassVolume: 0.68,
    arpVolume: 0.44,
    hatVolume: 0.2,
    lookahead: 25,          // ms — scheduler tekshirish oralig'i
    scheduleAhead: 0.12,    // s — oldindan rejalashtirish oynasi
    // Minor-epik progressiya (Dm — Bb — F — C uslubida, DEXO uchun "jang" kayfiyati)
    chordProgression: [
      [146.83, 174.61, 220.00],   // Dm  (D3, F3, A3)
      [116.54, 146.83, 174.61],   // Bb  (Bb2, D3, F3)
      [174.61, 220.00, 261.63],   // F   (F3, A3, C4)
      [130.81, 164.81, 196.00]    // C   (C3, E3, G3)
    ],
    arpPattern: [0, 1, 2, 1, 0, 1, 2, 1] // akkord ichidagi arpeggio indekslari
  };

  // ---------- STATE ----------
  let audioCtx = null;
  let masterGain = null;
  let padGain = null;
  let bassGain = null;
  let arpGain = null;
  let hatGain = null;

  let isPlaying = false;
  let isMuted = false;
  let schedulerTimer = null;

  let nextNoteTime = 0;
  let beatIndex = 0;       // umumiy bitlar hisoblagichi
  let chordIndex = 0;      // joriy akkord progressiyadagi o'rni

  const secondsPerBeat = () => 60 / MUSIC_CONFIG.bpm;

  // ---------- AUDIO GRAPH ----------
  function ensureContext() {
    if (audioCtx) return;

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = MUSIC_CONFIG.masterVolume;

    // yengil "arena" hissi uchun past-o'tkazuvchi filtr + ozgina reverb-simon kechikish
    const lowpass = audioCtx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 5200;

    const delay = audioCtx.createDelay();
    delay.delayTime.value = 0.22;
    const delayFeedback = audioCtx.createGain();
    delayFeedback.gain.value = 0.16;
    const delayMix = audioCtx.createGain();
    delayMix.gain.value = 0.18;

    delay.connect(delayFeedback);
    delayFeedback.connect(delay);
    delay.connect(delayMix);

    // Limiter/compressor — ovoz balandlashtirilgani uchun qo'shildi.
    // Bir nechta tovush (pad+bass+arp+hat) bir vaqtda yangraganda
    // signal "klipping" (xirillash) bo'lib qolmasligi uchun cho'qqilarni
    // silliq ravishda bosib turadi, shu bilan birga umumiy ovoz baland
    // va aniq eshitiladi.
    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 24;
    compressor.ratio.value = 10;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    masterGain.connect(lowpass);
    lowpass.connect(compressor);
    lowpass.connect(delay);
    delayMix.connect(compressor);
    compressor.connect(audioCtx.destination);

    padGain = audioCtx.createGain();
    padGain.gain.value = MUSIC_CONFIG.padVolume;
    padGain.connect(masterGain);

    bassGain = audioCtx.createGain();
    bassGain.gain.value = MUSIC_CONFIG.bassVolume;
    bassGain.connect(masterGain);

    arpGain = audioCtx.createGain();
    arpGain.gain.value = MUSIC_CONFIG.arpVolume;
    arpGain.connect(masterGain);

    hatGain = audioCtx.createGain();
    hatGain.gain.value = MUSIC_CONFIG.hatVolume;
    hatGain.connect(masterGain);
  }

  // ---------- NOTE BUILDERS ----------
  function playPadChord(freqs, time, duration) {
    freqs.forEach((f, i) => {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = f;

      // ikkinchi qatlam — ozgina detune bilan "kenglik" beradi
      const osc2 = audioCtx.createOscillator();
      osc2.type = "triangle";
      osc2.frequency.value = f * 1.004;

      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(0.18, time + duration * 0.25);
      g.gain.linearRampToValueAtTime(0.12, time + duration * 0.7);
      g.gain.linearRampToValueAtTime(0, time + duration);

      osc.connect(g);
      osc2.connect(g);
      g.connect(padGain);

      osc.start(time);
      osc2.start(time);
      osc.stop(time + duration + 0.05);
      osc2.stop(time + duration + 0.05);
    });
  }

  function playBassNote(freq, time, duration) {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = freq / 2; // bir oktava pastroq

    const filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 420;

    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.9, time + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    osc.connect(filter);
    filter.connect(g);
    g.connect(bassGain);

    osc.start(time);
    osc.stop(time + duration + 0.05);
  }

  function playArpNote(freq, time, duration) {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = "square";
    osc.frequency.value = freq * 2; // bir oktava yuqoriroq — yorqin arpeggio

    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.5, time + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    osc.connect(g);
    g.connect(arpGain);

    osc.start(time);
    osc.stop(time + duration + 0.03);
  }

  function playHat(time) {
    const bufferSize = audioCtx.sampleRate * 0.04;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;

    const filter = audioCtx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 6500;

    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.5, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.035);

    noise.connect(filter);
    filter.connect(g);
    g.connect(hatGain);

    noise.start(time);
    noise.stop(time + 0.05);
  }

  // ---------- SCHEDULER ----------
  function scheduleBeat(time) {
    const beatDur = secondsPerBeat();
    const barPos = beatIndex % 8; // 8 ta sakkizinchi-nota qadami bir akkordga

    if (barPos === 0) {
      const chord = MUSIC_CONFIG.chordProgression[chordIndex % MUSIC_CONFIG.chordProgression.length];
      playPadChord(chord, time, beatDur * 8 * 0.98);
      playBassNote(chord[0], time, beatDur * 4);
      chordIndex++;
    }
    if (barPos === 4) {
      const chord = MUSIC_CONFIG.chordProgression[(chordIndex - 1 + MUSIC_CONFIG.chordProgression.length) % MUSIC_CONFIG.chordProgression.length];
      playBassNote(chord[0] * 1.0, time, beatDur * 4);
    }

    // arpeggio — har sakkizinchi notada
    const chordForArp = MUSIC_CONFIG.chordProgression[(chordIndex - 1 + MUSIC_CONFIG.chordProgression.length) % MUSIC_CONFIG.chordProgression.length];
    const arpStep = MUSIC_CONFIG.arpPattern[barPos % MUSIC_CONFIG.arpPattern.length];
    playArpNote(chordForArp[arpStep], time, beatDur * 0.9);

    // yengil hi-hat — har ikkinchi qadamda, ritm hissi uchun
    if (barPos % 2 === 1) {
      playHat(time);
    }

    beatIndex++;
  }

  function scheduler() {
    while (nextNoteTime < audioCtx.currentTime + MUSIC_CONFIG.scheduleAhead) {
      scheduleBeat(nextNoteTime);
      nextNoteTime += secondsPerBeat() / 2; // sakkizinchi notalar (eighth notes)
    }
    schedulerTimer = setTimeout(scheduler, MUSIC_CONFIG.lookahead);
  }

  // ---------- PUBLIC CONTROLS ----------
  function startMusic() {
    if (isPlaying) return;
    ensureContext();

    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }

    isPlaying = true;
    beatIndex = 0;
    chordIndex = 0;
    nextNoteTime = audioCtx.currentTime + 0.05;

    // musiqa yumshoq kirib keladi (fade-in)
    masterGain.gain.cancelScheduledValues(audioCtx.currentTime);
    masterGain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    masterGain.gain.linearRampToValueAtTime(
      isMuted ? 0.0001 : MUSIC_CONFIG.masterVolume,
      audioCtx.currentTime + 1.4
    );

    scheduler();
  }

  function stopMusic() {
    isPlaying = false;
    clearTimeout(schedulerTimer);
  }

  function toggleMute() {
    isMuted = !isMuted;
    if (!audioCtx) return;
    const target = isMuted ? 0.0001 : MUSIC_CONFIG.masterVolume;
    masterGain.gain.cancelScheduledValues(audioCtx.currentTime);
    masterGain.gain.setValueAtTime(masterGain.gain.value, audioCtx.currentTime);
    masterGain.gain.linearRampToValueAtTime(target, audioCtx.currentTime + 0.3);
    updateToggleIcon();
  }

  // ---------- UI: Mute tugmasi (inline — index.css ga tegmaydi) ----------
  let toggleBtn = null;

  function createToggleButton() {
    toggleBtn = document.createElement("button");
    toggleBtn.id = "musicToggleBtn";
    toggleBtn.type = "button";
    toggleBtn.setAttribute("aria-label", "Musiqani yoqish/o'chirish");
    toggleBtn.innerHTML = "🔊";

    Object.assign(toggleBtn.style, {
      position: "fixed",
      right: "14px",
      bottom: "14px",
      width: "44px",
      height: "44px",
      borderRadius: "50%",
      border: "1px solid #232c42",
      background: "linear-gradient(180deg, #181f33 0%, #10162a 100%)",
      color: "#f2f4fa",
      fontSize: "19px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      zIndex: "50",
      boxShadow: "0 8px 20px rgba(0,0,0,.45)",
      transition: "transform .15s ease, box-shadow .25s ease, border-color .25s ease",
      userSelect: "none"
    });

    toggleBtn.addEventListener("mouseenter", () => {
      toggleBtn.style.transform = "scale(1.08)";
      toggleBtn.style.borderColor = "#f4c542";
    });
    toggleBtn.addEventListener("mouseleave", () => {
      toggleBtn.style.transform = "scale(1)";
      toggleBtn.style.borderColor = "#232c42";
    });

    toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      startMusic(); // agar hali boshlanmagan bo'lsa, shu yerda ham ishga tushadi
      toggleMute();
    });

    document.body.appendChild(toggleBtn);
  }

  function updateToggleIcon() {
    if (!toggleBtn) return;
    toggleBtn.innerHTML = isMuted ? "🔇" : "🔊";
    toggleBtn.style.opacity = isMuted ? "0.6" : "1";
  }

  // ---------- AUTOPLAY UNLOCK ----------
  // Brauzerlar foydalanuvchi ishorasisiz audio ijrosini bloklaydi,
  // shuning uchun birinchi tegish/bosishda musiqani ishga tushiramiz.
  function unlockOnFirstGesture() {
    startMusic();
    window.removeEventListener("click", unlockOnFirstGesture);
    window.removeEventListener("touchstart", unlockOnFirstGesture);
    window.removeEventListener("keydown", unlockOnFirstGesture);
  }

  function init() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", createToggleButton);
    } else {
      createToggleButton();
    }

    window.addEventListener("click", unlockOnFirstGesture, { once: true });
    window.addEventListener("touchstart", unlockOnFirstGesture, { once: true });
    window.addEventListener("keydown", unlockOnFirstGesture, { once: true });

    // sahifa fonga o'tsa — musiqa resurslarni tejash uchun pauza qo'ymaydi,
    // lekin tab qayta faollashganda contextni tiklab qo'yamiz
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && audioCtx && audioCtx.state === "suspended" && isPlaying) {
        audioCtx.resume();
      }
    });
  }

  init();

  // tashqi API (kerak bo'lsa boshqa skriptlar ham boshqarishi mumkin)
  window.DexoMusic = {
    start: startMusic,
    stop: stopMusic,
    toggleMute: toggleMute
  };
})();
