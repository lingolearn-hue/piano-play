/* ─────────────────────────────────────────
   pitch.js — Microphone pitch detection
   Web Audio API: getUserMedia → AnalyserNode
   Algorithm: Autocorrelation (McLeod Pitch Method simplified)
   ───────────────────────────────────────── */
'use strict';

const Pitch = (() => {

  const FFT_SIZE      = 4096;
  const SAMPLE_RATE   = 44100;
  const CONFIDENCE_THRESHOLD = 0.82;
  const SILENCE_THRESHOLD    = 0.005;

  let _audioCtx   = null;
  let _analyser   = null;
  let _stream     = null;
  let _source     = null;
  let _rafId      = null;
  let _running    = false;
  let _enabled    = false;

  // Expected notes for current cursor position
  // Set by app.js before each beat
  let _expectedMidi   = [];   // array of midi note numbers
  let _onMatch        = null; // () => void — called when match detected
  let _matchCooldownMs = 600;
  let _lastMatchTime  = 0;

  // ── Public: start/stop ────────────────────

  async function start() {
    if (_running) return;
    try {
      _stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
      _analyser = _audioCtx.createAnalyser();
      _analyser.fftSize = FFT_SIZE;
      _analyser.smoothingTimeConstant = 0.3;
      _source = _audioCtx.createMediaStreamSource(_stream);
      _source.connect(_analyser);
      _running = true;
      _loop();
      return true;
    } catch (e) {
      console.warn('Pitch: mic access failed:', e);
      return false;
    }
  }

  function stop() {
    _running = false;
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    if (_source) { try { _source.disconnect(); } catch {} _source = null; }
    if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
    if (_audioCtx) { try { _audioCtx.close(); } catch {} _audioCtx = null; }
    _analyser = null;
    _expectedMidi = [];
  }

  function setEnabled(v) { _enabled = v; }
  function setExpected(midiNotes) { _expectedMidi = midiNotes || []; }
  function setOnMatch(fn) { _onMatch = fn; }

  // ── Detection loop ─────────────────────────

  function _loop() {
    if (!_running) return;
    _rafId = requestAnimationFrame(_loop);

    if (!_enabled || !_expectedMidi.length || !_analyser) return;

    const buf = new Float32Array(_analyser.fftSize);
    _analyser.getFloatTimeDomainData(buf);

    // Silence check
    const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
    if (rms < SILENCE_THRESHOLD) return;

    const detected = _detectPitch(buf, _audioCtx.sampleRate);
    if (!detected) return;

    const { freq, confidence } = detected;
    if (confidence < CONFIDENCE_THRESHOLD) return;

    const detectedMidi = _freqToMidi(freq);

    // Check if detected note (±1 semitone tolerance) matches any expected note
    const matched = _expectedMidi.some(expected =>
      Math.abs(detectedMidi - expected) <= 1
    );

    if (matched) {
      const now = performance.now();
      if (now - _lastMatchTime > _matchCooldownMs) {
        _lastMatchTime = now;
        if (_onMatch) _onMatch(detectedMidi, freq, confidence);
      }
    }
  }

  // ── McLeod Pitch Method (simplified autocorrelation) ─────────

  function _detectPitch(buf, sampleRate) {
    const N = buf.length;

    // Normalised Square Difference Function
    const nsdf = new Float32Array(N);
    let m = 0;
    for (let i = 0; i < N; i++) m += buf[i] * buf[i];

    for (let tau = 0; tau < N / 2; tau++) {
      let acf = 0;
      let norm = 0;
      for (let i = 0; i < N - tau; i++) {
        acf  += buf[i] * buf[i + tau];
        norm += buf[i] * buf[i] + buf[i + tau] * buf[i + tau];
      }
      nsdf[tau] = norm > 0 ? 2 * acf / norm : 0;
    }

    // Find highest peak after first zero crossing
    let maxVal = -Infinity;
    let maxTau = -1;
    let inPeak = false;

    for (let tau = 1; tau < N / 2 - 1; tau++) {
      if (!inPeak && nsdf[tau] > 0 && nsdf[tau - 1] <= 0) inPeak = true;
      if (inPeak) {
        if (nsdf[tau] > maxVal) {
          maxVal = nsdf[tau];
          maxTau = tau;
        }
        if (nsdf[tau] < 0) break;
      }
    }

    if (maxTau < 1 || maxVal < CONFIDENCE_THRESHOLD) return null;

    // Parabolic interpolation for sub-sample accuracy
    const a = nsdf[maxTau - 1];
    const b = nsdf[maxTau];
    const c = nsdf[maxTau + 1];
    const refinedTau = maxTau + (c - a) / (2 * (2 * b - a - c));

    const freq = sampleRate / refinedTau;
    // Sanity check: piano range A0 (27.5Hz) to C8 (4186Hz)
    if (freq < 27 || freq > 4200) return null;

    return { freq, confidence: maxVal };
  }

  // ── MIDI helpers ──────────────────────────

  function _freqToMidi(freq) {
    return Math.round(69 + 12 * Math.log2(freq / 440));
  }

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function midiToName(midi) {
    const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    return names[midi % 12] + Math.floor(midi / 12 - 1);
  }

  // ── Status ────────────────────────────────

  function isRunning() { return _running; }
  function isEnabled() { return _enabled; }

  return {
    start, stop, setEnabled, setExpected, setOnMatch,
    midiToFreq, midiToName,
    get isRunning() { return _running; },
    get isEnabled() { return _enabled; },
  };
})();

window.Pitch = Pitch;
