/* ─────────────────────────────────────────
   score.js — Custom SVG score renderer
   ───────────────────────────────────────── */
'use strict';

const Score = (() => {

  const SPACE       = 10;
  const LINE_W      = 1;
  const NOTE_RX     = SPACE * 0.55;
  const NOTE_RY     = SPACE * 0.40;
  const STEM_H      = SPACE * 3.5;
  const LEDGER_W    = SPACE * 1.6;
  const STAFF_LINES = 5;
  const STAFF_H     = (STAFF_LINES - 1) * SPACE;
  const STAFF_GAP   = SPACE * 4;
  const MARGIN_L    = 12;
  const MARGIN_T    = 14;
  const MARGIN_R    = 10;
  const PREFIX_W    = 52;
  const MIN_MEAS_W  = SPACE * 8;

  const COLOR_RIGHT  = '#C8873A';
  const COLOR_LEFT   = '#4A90D9';
  const COLOR_CURSOR = 'rgba(200,135,58,0.28)';
  const COLOR_LOOP   = 'rgba(45,90,61,0.22)';
  const COLOR_STAFF  = '#444';

  let _svg       = null;
  let _container = null;
  let _score     = null;
  let _zoom      = 1.0;
  let _hand      = 'both';
  let _measureLayouts = []; // [{idx, x, w, sy, beatW, beatPositions[{beat,x}]}]
  let _cursorEl  = null;
  let _loopEl    = null;
  let _onMeasureClick = null;

  // ── Public ────────────────────────────────

  function init(containerEl) { _container = containerEl; }
  function setZoom(z) { _zoom = Math.max(0.4, Math.min(2.0, z)); if (_score) render(_score, _hand); }
  function setHand(hand) { _hand = hand; if (_score) render(_score, _hand); }
  function onMeasureClick(fn) { _onMeasureClick = fn; }

  // ── Render ────────────────────────────────

  function render(score, hand) {
    _score = score;
    _hand  = hand || _hand;
    _container.innerHTML = '';
    _measureLayouts = [];

    const sp       = SPACE * _zoom;
    const contW    = _container.clientWidth || 600;
    const usableW  = contW - (MARGIN_L + MARGIN_R) * _zoom;
    const totalBeats = _score.measures.reduce((s, m) => s + m.totalBeats, 0);
    const beatW    = Math.max((usableW - PREFIX_W * _zoom) / Math.max(totalBeats, 1), MIN_MEAS_W * _zoom / 4);

    // Layout measures into systems
    const systems = [];
    let line = [], lineW = PREFIX_W * _zoom;
    for (const m of _score.measures) {
      const mw = Math.max(m.totalBeats * beatW, MIN_MEAS_W * _zoom);
      if (line.length && lineW + mw > usableW + 1) {
        systems.push(line); line = [{ m, w: mw }]; lineW = PREFIX_W * _zoom + mw;
      } else { line.push({ m, w: mw }); lineW += mw; }
    }
    if (line.length) systems.push(line);

    const systemH  = (STAFF_H * 2 + STAFF_GAP) * _zoom;
    const sysGap   = sp * 5;
    const totalH   = MARGIN_T * _zoom + systems.length * (systemH + sysGap) + sp;

    _svg = _el('svg');
    _svg.setAttribute('width',  contW);
    _svg.setAttribute('height', totalH);
    _svg.style.cssText = 'background:#fff;display:block;';

    let sy = MARGIN_T * _zoom;
    systems.forEach((sysLine, sysIdx) => {
      const sysX  = MARGIN_L * _zoom;
      const usedW = sysLine.reduce((s, e) => s + e.w, 0);
      const stretch = sysLine.length > 1 ? (usableW - PREFIX_W * _zoom) / usedW : 1.0;

      _drawPrefix(sysX, sy, sp, sysIdx === 0);

      let mx = sysX + PREFIX_W * _zoom;
      sysLine.forEach(({ m, w }) => {
        const mw = w * stretch;
        _drawMeasure(m, mx, sy, mw, sp);
        mx += mw;
      });
      _drawBarline(mx, sy, sp);
      sy += systemH + sysGap;
    });

    // Cursor rect
    _cursorEl = _el('rect');
    _cursorEl.setAttribute('fill',           COLOR_CURSOR);
    _cursorEl.setAttribute('rx',             '2');
    _cursorEl.setAttribute('pointer-events', 'none');
    _cursorEl.setAttribute('visibility',     'hidden');
    _svg.appendChild(_cursorEl);

    // Loop rect
    _loopEl = _el('rect');
    _loopEl.setAttribute('fill',           COLOR_LOOP);
    _loopEl.setAttribute('stroke',         'rgba(45,90,61,0.5)');
    _loopEl.setAttribute('stroke-width',   '1.5');
    _loopEl.setAttribute('rx',             '2');
    _loopEl.setAttribute('pointer-events', 'none');
    _loopEl.setAttribute('visibility',     'hidden');
    _svg.appendChild(_loopEl);

    _container.appendChild(_svg);
  }

  // ── Prefix ───────────────────────────────

  function _drawPrefix(x, sy, sp, showTimeSig) {
    if (_hand !== 'left')  _drawTrebleClef(x + 3 * _zoom, sy, sp);
    if (_hand !== 'right') _drawBassClef(x + 3 * _zoom, sy + (STAFF_H + STAFF_GAP) * _zoom, sp);
    if (_score.keyFifths !== 0) {
      if (_hand !== 'left')  _drawKeySig(x, sy,                                sp, _score.keyFifths, 'treble');
      if (_hand !== 'right') _drawKeySig(x, sy + (STAFF_H + STAFF_GAP) * _zoom, sp, _score.keyFifths, 'bass');
    }
    if (showTimeSig) {
      if (_hand !== 'left')  _drawTimeSig(x, sy,                                sp);
      if (_hand !== 'right') _drawTimeSig(x, sy + (STAFF_H + STAFF_GAP) * _zoom, sp);
    }
  }

  // ── Measure ───────────────────────────────

  function _drawMeasure(measure, x, sy, w, sp) {
    const beatW = w / measure.totalBeats;

    // Staff lines
    if (_hand !== 'left')  _drawStaff(x, sy, w, sp, 'treble', measure.idx);
    if (_hand !== 'right') _drawStaff(x, sy + (STAFF_H + STAFF_GAP) * _zoom, w, sp, 'bass', measure.idx);

    _drawBarline(x, sy, sp);

    // Beat position map — record x for EVERY beat that has a note onset,
    // regardless of which hand, so cursor sync always finds the right position.
    const beatPosMap = new Map(); // round(beat*1000) → x

    measure.notes.forEach(note => {
      if (note.isChord) return; // chords share the same beat position
      const key = Math.round(note.beatPos * 1000);
      if (!beatPosMap.has(key)) {
        beatPosMap.set(key, x + note.beatPos * beatW + beatW * 0.15);
      }
    });

    // Draw notes
    measure.notes.forEach(note => {
      if (_hand === 'right' && note.staff !== 1) return;
      if (_hand === 'left'  && note.staff !== 2) return;

      const color  = note.staff === 1 ? COLOR_RIGHT : COLOR_LEFT;
      const staffY = note.staff === 1 ? sy : sy + (STAFF_H + STAFF_GAP) * _zoom;
      const nx     = x + note.beatPos * beatW + beatW * 0.15;

      if (note.isRest) {
        _drawRest(nx, staffY, note.type, note.dot, sp, color);
      } else {
        const ny = _noteY(note.staffStep, staffY, sp, note.staff === 2);
        _drawNote(nx, ny, staffY, note, sp, color);
      }
    });

    // Measure number
    const mn = _el('text');
    mn.setAttribute('x', x + 2 * _zoom); mn.setAttribute('y', sy - 3 * _zoom);
    mn.setAttribute('font-size', 7 * _zoom + 'px'); mn.setAttribute('fill', '#bbb');
    mn.textContent = measure.idx + 1;
    _svg.appendChild(mn);

    // Click overlay
    const ch  = (STAFF_H * 2 + STAFF_GAP) * _zoom;
    const hit = _el('rect');
    hit.setAttribute('x', x); hit.setAttribute('y', sy);
    hit.setAttribute('width', w); hit.setAttribute('height', ch);
    hit.setAttribute('fill', 'transparent'); hit.setAttribute('cursor', 'pointer');
    hit.dataset.measureIdx = measure.idx;
    hit.addEventListener('click', () => { if (_onMeasureClick) _onMeasureClick(measure.idx); });
    _svg.appendChild(hit);

    // Store layout — beatPositions sorted by beat
    const beatPositions = [...beatPosMap.entries()]
      .map(([key, bx]) => ({ beat: key / 1000, x: bx }))
      .sort((a, b) => a.beat - b.beat);

    _measureLayouts.push({ idx: measure.idx, x, w, sy, beatW, beatPositions });
  }

  // ── Staff ─────────────────────────────────

  function _drawStaff(x, y, w, sp, clef, measureIdx) {
    const g = _el('g');
    g.dataset.clef = clef; g.dataset.measureIdx = measureIdx;
    for (let i = 0; i < STAFF_LINES; i++) {
      const l = _el('line');
      const ly = y + i * sp;
      l.setAttribute('x1', x);     l.setAttribute('y1', ly);
      l.setAttribute('x2', x + w); l.setAttribute('y2', ly);
      l.setAttribute('stroke', COLOR_STAFF);
      l.setAttribute('stroke-width', LINE_W * _zoom);
      g.appendChild(l);
    }
    _svg.appendChild(g);
  }

  function _drawBarline(x, sy, sp) {
    const l = _el('line');
    l.setAttribute('x1', x); l.setAttribute('y1', sy);
    l.setAttribute('x2', x); l.setAttribute('y2', sy + (STAFF_H * 2 + STAFF_GAP) * _zoom);
    l.setAttribute('stroke', COLOR_STAFF); l.setAttribute('stroke-width', LINE_W * _zoom);
    _svg.appendChild(l);
  }

  // ── Note Y ───────────────────────────────
  // staffStep: steps from C4 (C4=0, D4=1, ..., B4=6, C5=7 ...)
  // Treble: B4 (step 6) on middle line (staffY + 2*sp)
  // Bass:   D3 (step -1) on middle line

  function _noteY(staffStep, staffY, sp, isBass) {
    const refStep = isBass ? -1 : 6; // D3 or B4
    return (staffY + 2 * sp) - (staffStep - refStep) * (sp / 2);
  }

  // ── Draw note ─────────────────────────────

  function _drawNote(x, y, staffY, note, sp, color) {
    const isFilled = !['whole', 'half'].includes(note.type);
    _drawLedgers(x, y, staffY, sp, color);
    if (note.alter !== 0) _drawAccidental(x - sp * 1.1, y, note.alter, sp, color);

    const nh = _el('ellipse');
    nh.setAttribute('cx', x); nh.setAttribute('cy', y);
    nh.setAttribute('rx', NOTE_RX * _zoom); nh.setAttribute('ry', NOTE_RY * _zoom);
    nh.setAttribute('fill',      isFilled ? color : 'none');
    nh.setAttribute('stroke',    color);
    nh.setAttribute('stroke-width', LINE_W * 1.5 * _zoom);
    nh.setAttribute('transform', `rotate(-15,${x},${y})`);
    _svg.appendChild(nh);

    if (note.type !== 'whole') {
      const up   = note.staffStep < (note.staff === 1 ? 6 : -1);
      const sx   = up ? x + NOTE_RX * _zoom - 0.5 : x - NOTE_RX * _zoom + 0.5;
      const sy2  = up ? y - STEM_H * _zoom : y + STEM_H * _zoom;
      _line(sx, y, sx, sy2, color, LINE_W * 1.5 * _zoom);

      const flags = { eighth: 1, '16th': 2, '32nd': 3 };
      for (let f = 0; f < (flags[note.type] || 0); f++) {
        const fy = up ? sy2 + f * sp * 0.8 : sy2 - f * sp * 0.8;
        const dx = sp * 0.9, dy = sp * 0.7;
        const flag = _el('path');
        flag.setAttribute('d', up
          ? `M${sx},${fy} C${sx+dx},${fy+dy} ${sx+dx*0.5},${fy+dy*1.5} ${sx},${fy+dy*2}`
          : `M${sx},${fy} C${sx+dx},${fy-dy} ${sx+dx*0.5},${fy-dy*1.5} ${sx},${fy-dy*2}`);
        flag.setAttribute('fill', 'none');
        flag.setAttribute('stroke', color);
        flag.setAttribute('stroke-width', LINE_W * 1.5 * _zoom);
        _svg.appendChild(flag);
      }
    }

    if (note.dot) {
      const dot = _el('circle');
      dot.setAttribute('cx',   x + NOTE_RX * _zoom + sp * 0.55);
      dot.setAttribute('cy',   y % sp < sp / 2 ? y - sp * 0.25 : y);
      dot.setAttribute('r',    sp * 0.14);
      dot.setAttribute('fill', color);
      _svg.appendChild(dot);
    }
  }

  function _drawLedgers(nx, ny, staffY, sp, color) {
    const top = staffY, bot = staffY + 4 * sp, lw = LEDGER_W * _zoom;
    if (ny < top - sp * 0.5) {
      for (let y = top - sp; y >= ny - sp * 0.5; y -= sp) _line(nx-lw, y, nx+lw, y, color, LINE_W*_zoom);
    }
    if (ny > bot + sp * 0.5) {
      for (let y = bot + sp; y <= ny + sp * 0.5; y += sp) _line(nx-lw, y, nx+lw, y, color, LINE_W*_zoom);
    }
  }

  function _drawAccidental(x, y, alter, sp, color) {
    const t = _el('text');
    t.setAttribute('x', x); t.setAttribute('y', y + sp * 0.35);
    t.setAttribute('font-size', sp * 1.6 + 'px');
    t.setAttribute('fill', color); t.setAttribute('text-anchor', 'middle');
    t.textContent = alter > 0 ? '♯' : '♭';
    _svg.appendChild(t);
  }

  function _drawRest(x, staffY, type, dot, sp, color) {
    const RESTS = { whole:'𝄻', half:'𝄼', quarter:'𝄽', eighth:'𝄾', '16th':'𝄿', '32nd':'𝅀' };
    const t = _el('text');
    t.setAttribute('x', x); t.setAttribute('y', staffY + 2.5 * sp);
    t.setAttribute('font-size', sp * 1.8 + 'px');
    t.setAttribute('fill', color); t.setAttribute('text-anchor', 'middle');
    t.textContent = RESTS[type] || '𝄽';
    _svg.appendChild(t);
  }

  // ── Clefs ─────────────────────────────────

  function _drawTrebleClef(x, sy, sp) {
    const t = _el('text');
    t.setAttribute('x', x); t.setAttribute('y', sy + 4.2 * sp);
    t.setAttribute('font-size', sp * 6.5 + 'px'); t.setAttribute('fill', COLOR_STAFF);
    t.textContent = '𝄞'; _svg.appendChild(t);
  }
  function _drawBassClef(x, sy, sp) {
    const t = _el('text');
    t.setAttribute('x', x); t.setAttribute('y', sy + 2.8 * sp);
    t.setAttribute('font-size', sp * 3.5 + 'px'); t.setAttribute('fill', COLOR_STAFF);
    t.textContent = '𝄢'; _svg.appendChild(t);
  }

  // ── Key signature ─────────────────────────

  function _drawKeySig(x, sy, sp, fifths, clef) {
    const SHARP_T = [4,1,5,2,6,3,7], FLAT_T = [6,3,7,4,8,5,9];
    const SHARP_B = [2,-1,3,0,4,1,5], FLAT_B = [4,1,5,2,6,3,7];
    const steps   = fifths > 0 ? (clef==='treble'?SHARP_T:SHARP_B) : (clef==='treble'?FLAT_T:FLAT_B);
    const ref     = clef === 'treble' ? 6 : -1;
    const sym     = fifths > 0 ? '♯' : '♭';
    const sx      = x + 22 * _zoom;
    for (let i = 0; i < Math.abs(fifths); i++) {
      const ny = (sy + 2 * sp) - (steps[i] - ref) * (sp / 2);
      const t  = _el('text');
      t.setAttribute('x', sx + i * sp * 0.85); t.setAttribute('y', ny + sp * 0.35);
      t.setAttribute('font-size', sp * 1.3 + 'px'); t.setAttribute('fill', COLOR_STAFF);
      t.textContent = sym; _svg.appendChild(t);
    }
  }

  // ── Time signature ────────────────────────

  function _drawTimeSig(x, sy, sp) {
    [_score.beats, _score.beatType].forEach((n, i) => {
      const t = _el('text');
      t.setAttribute('x', x + 37 * _zoom); t.setAttribute('y', sy + (i===0?1.5:3.5)*sp);
      t.setAttribute('font-size', sp * 2 + 'px'); t.setAttribute('font-weight', 'bold');
      t.setAttribute('fill', COLOR_STAFF); t.setAttribute('text-anchor', 'middle');
      t.textContent = n; _svg.appendChild(t);
    });
  }

  // ── Cursor ────────────────────────────────

  function showCursor()  { _cursorEl?.setAttribute('visibility', 'visible'); }
  function hideCursor()  { _cursorEl?.setAttribute('visibility', 'hidden'); }
  function resetCursor() { if (_measureLayouts.length) _setCursorAt(_measureLayouts[0], 0); }

  function setCursorToTime(timeBeat, beatsPerMeasure) {
    if (!_cursorEl || !_measureLayouts.length) return;
    const measureIdx    = Math.floor(timeBeat / beatsPerMeasure);
    const beatInMeasure = timeBeat - measureIdx * beatsPerMeasure;
    const layout = _measureLayouts.find(m => m.idx === measureIdx)
                || _measureLayouts[_measureLayouts.length - 1];
    if (layout) _setCursorAt(layout, beatInMeasure);
  }

  function _setCursorAt(layout, beatInMeasure) {
    // Find the beat position closest to (but not after) beatInMeasure
    let best = layout.beatPositions[0];
    for (const bp of layout.beatPositions) {
      if (bp.beat <= beatInMeasure + 0.01) best = bp;
      else break;
    }
    const cx = best ? best.x - NOTE_RX * _zoom * 1.5 : layout.x;
    const cw = Math.max(layout.beatW * 0.9, 8);
    const ch = (STAFF_H * 2 + STAFF_GAP) * _zoom;

    _cursorEl.setAttribute('x',      cx);
    _cursorEl.setAttribute('y',      layout.sy);
    _cursorEl.setAttribute('width',  cw);
    _cursorEl.setAttribute('height', ch);

    // Auto-scroll
    if (_container) {
      const absY  = layout.sy;
      const vTop  = _container.scrollTop;
      const vBot  = vTop + _container.clientHeight;
      if (absY < vTop + 20 || absY + ch > vBot - 20) {
        _container.scrollTop = Math.max(0, absY - _container.clientHeight * 0.25);
      }
    }
  }

  // ── Loop ─────────────────────────────────

  function setLoopPoints(s, e) {
    const sl = _measureLayouts.find(m => m.idx === s);
    const el = _measureLayouts.find(m => m.idx === e);
    if (!sl || !_loopEl) return;
    const ex = el ? el.x + el.w : sl.x + sl.w;
    _loopEl.setAttribute('x',       sl.x);
    _loopEl.setAttribute('y',       sl.sy);
    _loopEl.setAttribute('width',   ex - sl.x);
    _loopEl.setAttribute('height',  (STAFF_H * 2 + STAFF_GAP) * _zoom);
    _loopEl.setAttribute('visibility', 'visible');
  }
  function clearLoopPoints() { _loopEl?.setAttribute('visibility', 'hidden'); }

  // ── Note range ────────────────────────────

  function getNoteRange(hand) {
    if (!_score) return { minMidi: 48, maxMidi: 84 };
    let min = 127, max = 0;
    _score.measures.forEach(m => m.notes.forEach(n => {
      if (n.isRest || !n.midi) return;
      if (hand === 'right' && n.staff !== 1) return;
      if (hand === 'left'  && n.staff !== 2) return;
      min = Math.min(min, n.midi); max = Math.max(max, n.midi);
    }));
    return min > max ? { minMidi: 48, maxMidi: 84 }
      : { minMidi: Math.max(21, min-2), maxMidi: Math.min(108, max+2) };
  }

  // ── Extract note events ───────────────────

  function extractNoteEvents(beatsPerMeasure) {
    if (!_score) return [];
    const events = [];
    _score.measures.forEach(m => {
      m.notes.forEach(n => {
        if (n.isRest || !n.midi) return;
        events.push({
          time:     m.idx * beatsPerMeasure + n.beatPos,
          duration: n.durBeats,
          midi:     n.midi,
          hand:     n.staff === 1 ? 'right' : 'left',
        });
      });
    });
    events.sort((a, b) => a.time - b.time || a.midi - b.midi);
    console.log('Events:', events.length,
      events.slice(0,4).map(e=>`t=${e.time.toFixed(1)} m=${e.midi} ${e.hand[0]}`).join(' '));
    return events;
  }

  // ── SVG helpers ───────────────────────────

  function _el(tag)  { return document.createElementNS('http://www.w3.org/2000/svg', tag); }
  function _line(x1,y1,x2,y2,s,sw) {
    const l = _el('line');
    l.setAttribute('x1',x1); l.setAttribute('y1',y1);
    l.setAttribute('x2',x2); l.setAttribute('y2',y2);
    l.setAttribute('stroke',s); l.setAttribute('stroke-width',sw);
    _svg.appendChild(l); return l;
  }

  return {
    init, render, setZoom, setHand, onMeasureClick,
    showCursor, hideCursor, resetCursor, setCursorToTime,
    setLoopPoints, clearLoopPoints,
    getNoteRange, extractNoteEvents,
    get isLoaded() { return !!_score; },
  };
})();

window.Score = Score;
