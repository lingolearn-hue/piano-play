/* ─────────────────────────────────────────
   keyboard.js — Piano keyboard strip
   Renders only the MIDI range in use.
   ───────────────────────────────────────── */
'use strict';

const Keyboard = (() => {

  // Black-key chromatic positions within an octave (C=0)
  const BLACK = new Set([1, 3, 6, 8, 10]);

  let canvas, ctx;
  let activeNotes = new Map(); // midi → 'right'|'left'|'both'

  // Current visible range
  let _midiMin = 21;
  let _midiMax = 108;

  // Layout computed on resize/range change
  let _whites    = [];  // [{midi, x, w}]
  let _blacks    = [];  // [{midi, x, w, h}]
  let _keyHeight = 0;
  let _blackH    = 0;
  let _midiToKey = new Map(); // midi → {x, w, isBlack}

  // ── Helpers ───────────────────────────────

  function _chroma(midi) { return midi % 12; }
  function _isBlack(midi) { return BLACK.has(_chroma(midi)); }

  // Expand range to include full octave boundaries and avoid orphaned black keys
  function _expandRange(min, max) {
    // Snap to nearest C below min, B above max
    let lo = min;
    while (_isBlack(lo) || _chroma(lo) !== 0) lo--;
    if (lo < 21) lo = 21;
    let hi = max;
    while (_isBlack(hi) || _chroma(hi) !== 11) hi++;
    if (hi > 108) hi = 108;
    return { lo, hi };
  }

  // ── Build layout ──────────────────────────

  function _buildLayout(canvasW, canvasH) {
    _whites  = [];
    _blacks  = [];
    _midiToKey = new Map();

    const { lo, hi } = _expandRange(_midiMin, _midiMax);

    // Count white keys in range
    let whiteCount = 0;
    for (let m = lo; m <= hi; m++) { if (!_isBlack(m)) whiteCount++; }
    if (whiteCount === 0) return;

    const ww = canvasW / whiteCount;
    const wh = canvasH;
    const bw = ww * 0.6;
    const bh = wh * 0.62;

    _keyHeight = wh;
    _blackH    = bh;

    // First pass: place white keys
    let wx = 0;
    for (let m = lo; m <= hi; m++) {
      if (_isBlack(m)) continue;
      _whites.push({ midi: m, x: wx, w: ww });
      _midiToKey.set(m, { x: wx, w: ww, isBlack: false });
      wx += ww;
    }

    // Second pass: place black keys between their neighbours
    for (let m = lo; m <= hi; m++) {
      if (!_isBlack(m)) continue;
      // Find white key to the left
      let leftWhite = null;
      for (let lm = m - 1; lm >= lo; lm--) {
        if (!_isBlack(lm)) { leftWhite = _midiToKey.get(lm); break; }
      }
      if (!leftWhite) continue;
      const bx = leftWhite.x + leftWhite.w - bw / 2;
      _blacks.push({ midi: m, x: bx, w: bw, h: bh });
      _midiToKey.set(m, { x: bx, w: bw, isBlack: true });
    }
  }

  // ── Draw ─────────────────────────────────

  function draw() {
    if (!ctx || !canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w   = canvas.width  / dpr;
    const h   = canvas.height / dpr;
    ctx.clearRect(0, 0, w, h);

    // White keys
    for (const k of _whites) {
      const fill = _fillForNote(k.midi);
      ctx.fillStyle = fill ?? '#F5F0E8';
      ctx.fillRect(k.x + 1, 0, k.w - 2, _keyHeight - 1);
      ctx.strokeStyle = '#666';
      ctx.lineWidth   = 0.5;
      ctx.strokeRect(k.x + 1, 0, k.w - 2, _keyHeight - 1);

      // C label
      if (_chroma(k.midi) === 0) {
        const oct = Math.floor(k.midi / 12) - 1;
        ctx.fillStyle   = '#888';
        ctx.font        = `${Math.max(7, k.w * 0.48)}px Inter,sans-serif`;
        ctx.textAlign   = 'center';
        ctx.fillText(`C${oct}`, k.x + k.w / 2, _keyHeight - 4);
      }
    }

    // Black keys on top
    for (const k of _blacks) {
      const fill = _fillForNote(k.midi);
      ctx.fillStyle = fill ?? '#111';
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(k.x, 0, k.w, k.h, [0, 0, 3, 3]);
      } else {
        ctx.rect(k.x, 0, k.w, k.h);
      }
      ctx.fill();
    }
  }

  function _fillForNote(midi) {
    const s = activeNotes.get(midi);
    if (!s) return null;
    if (s === 'right') return 'rgba(200,135,58,0.92)';   // orange — matches sheet
    if (s === 'left')  return 'rgba(74,144,217,0.92)';   // blue   — matches sheet
    return 'rgba(200,135,58,0.92)';  // default orange
  }

  // ── Resize ────────────────────────────────

  function resize() {
    if (!canvas) return;
    const dpr  = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width  = rect.width  * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width  = rect.width  + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    _buildLayout(rect.width, rect.height);
    draw();
  }

  // ── Public API ────────────────────────────

  function init(canvasEl) {
    canvas = canvasEl;
    ctx    = canvas.getContext('2d');
    window.addEventListener('resize', resize);
    resize();
  }

  // Call after loading a score with its note range
  function setRange(minMidi, maxMidi) {
    _midiMin = Math.max(21,  minMidi);
    _midiMax = Math.min(108, maxMidi);
    resize();
  }

  function noteOn(midi, hand) {
    activeNotes.set(midi, hand || 'both');
    draw();
  }

  function noteOff(midi) {
    activeNotes.delete(midi);
    draw();
  }

  function clearNotes() {
    activeNotes.clear();
    draw();
  }

  function setNotes(map) {
    activeNotes = map instanceof Map ? map : new Map(Object.entries(map));
    draw();
  }

  return { init, setRange, resize, noteOn, noteOff, clearNotes, setNotes, draw };
})();

window.Keyboard = Keyboard;
