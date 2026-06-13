/* ─────────────────────────────────────────
   score.js — Custom SVG score renderer

   Draws a two-staff piano score directly.
   No external libraries.

   Layout units: 1 SPACE = distance between
   two adjacent staff lines. Everything is
   proportional to SPACE.
   ───────────────────────────────────────── */
'use strict';

const Score = (() => {

  // ── Constants ─────────────────────────────
  const SPACE        = 10;     // px between staff lines (at zoom 1)
  const LINE_W       = 1;      // staff line stroke width
  const NOTE_RX      = SPACE * 0.55; // notehead x radius
  const NOTE_RY      = SPACE * 0.40; // notehead y radius
  const STEM_H       = SPACE * 3.5;  // stem height
  const LEDGER_W     = SPACE * 1.6;  // ledger line half-width
  const STAFF_LINES  = 5;
  const STAFF_H      = (STAFF_LINES - 1) * SPACE; // 4 spaces = 40px

  // Gap between treble and bass staves within a system
  const STAFF_GAP    = SPACE * 4;

  // Margins
  const MARGIN_LEFT  = 14;
  const MARGIN_TOP   = 18;
  const MARGIN_RIGHT = 14;

  // Clef/keysig/timesig prefix width
  const PREFIX_W     = 52;
  // Minimum measure width
  const MIN_MEASURE_W = SPACE * 9;

  // Colors
  const COLOR_RIGHT  = '#C8873A';
  const COLOR_LEFT   = '#4A90D9';
  const COLOR_CURSOR = 'rgba(200,135,58,0.30)';
  const COLOR_LOOP   = 'rgba(45,90,61,0.25)';
  const COLOR_STAFF  = '#555';

  // ── State ─────────────────────────────────
  let _svg       = null;
  let _container = null;
  let _score     = null;       // parsed score data
  let _zoom      = 1.0;
  let _hand      = 'both';
  let _measureLayouts = [];    // [{x, w, beatW, notePositions}]
  let _cursorEl  = null;
  let _loopEl    = null;
  let _onMeasureClick = null;

  // ── Public API ────────────────────────────

  function init(containerEl) {
    _container = containerEl;
  }

  function setZoom(z) {
    _zoom = Math.max(0.5, Math.min(2.0, z));
    if (_score) render(_score, _hand);
  }

  function setHand(hand) {
    _hand = hand;
    if (_score) render(_score, _hand);
  }

  function onMeasureClick(fn) { _onMeasureClick = fn; }

  // ── Main render ───────────────────────────

  function render(score, hand) {
    _score = score;
    _hand  = hand || _hand;
    _container.innerHTML = '';

    const sp = SPACE * _zoom;

    // ── Layout ──────────────────────────────
    // Figure out available width
    const containerW = _container.clientWidth || 600;
    const usableW    = containerW - MARGIN_LEFT * _zoom - MARGIN_RIGHT * _zoom;

    // Layout measures into systems (rows)
    // Each measure width is proportional to its beat count
    const totalBeats  = _score.measures.reduce((s, m) => s + m.totalBeats, 0);
    const rawBeatW    = (usableW - PREFIX_W * _zoom) / Math.max(totalBeats, 1);
    const beatW       = Math.max(rawBeatW, MIN_MEASURE_W * _zoom / 4);

    // Group measures into lines (systems) that fit the width
    const systems = [];
    let   line    = [];
    let   lineW   = PREFIX_W * _zoom;
    for (const m of _score.measures) {
      const mw = Math.max(m.totalBeats * beatW, MIN_MEASURE_W * _zoom);
      if (line.length && lineW + mw > usableW) {
        systems.push(line);
        line  = [{ measure: m, w: mw }];
        lineW = PREFIX_W * _zoom + mw;
      } else {
        line.push({ measure: m, w: mw });
        lineW += mw;
      }
    }
    if (line.length) systems.push(line);

    // Calculate total SVG height
    const systemH  = (STAFF_H * 2 + STAFF_GAP) * _zoom;
    const systemGap = sp * 6;
    const totalH   = MARGIN_TOP * _zoom
                   + systems.length * (systemH + systemGap)
                   + sp * 2;

    // Create SVG
    _svg = _el('svg');
    _svg.setAttribute('width',  containerW);
    _svg.setAttribute('height', totalH);
    _svg.style.background = '#fff';
    _svg.style.display    = 'block';

    _measureLayouts = [];

    let   sy = MARGIN_TOP * _zoom;

    systems.forEach((sysLine, sysIdx) => {
      const sysX = MARGIN_LEFT * _zoom;

      // Stretch last line to fill width too
      const usedW    = sysLine.reduce((s, e) => s + e.w, 0);
      const stretch  = sysLine.length > 1
        ? (usableW - PREFIX_W * _zoom) / usedW
        : 1.0;

      // Draw clef/keysig/timesig prefix (only if first measure of system)
      _drawPrefix(sysX, sy, sp, sysIdx === 0);

      // Draw measures
      let mx = sysX + PREFIX_W * _zoom;
      sysLine.forEach(({ measure, w }) => {
        const mw = w * stretch;
        _drawMeasure(measure, mx, sy, mw, sp);
        mx += mw;
      });

      // Draw final barline
      _drawBarline(mx, sy, sp);

      sy += systemH + systemGap;
    });

    // Cursor overlay (invisible until playback)
    _cursorEl = _el('rect');
    _cursorEl.setAttribute('fill',            COLOR_CURSOR);
    _cursorEl.setAttribute('rx',              '2');
    _cursorEl.setAttribute('pointer-events',  'none');
    _cursorEl.setAttribute('visibility',      'hidden');
    _svg.appendChild(_cursorEl);

    // Loop overlay
    _loopEl = _el('rect');
    _loopEl.setAttribute('fill',           COLOR_LOOP);
    _loopEl.setAttribute('stroke',         'rgba(45,90,61,0.6)');
    _loopEl.setAttribute('stroke-width',   '1.5');
    _loopEl.setAttribute('rx',             '2');
    _loopEl.setAttribute('pointer-events', 'none');
    _loopEl.setAttribute('visibility',     'hidden');
    _svg.appendChild(_loopEl);

    _container.appendChild(_svg);
    _applyHandVisibility(_hand);
  }

  // ── Draw prefix (clef, key, time) ────────

  function _drawPrefix(x, sy, sp, showTimeSig) {
    if (!_score) return;
    // Treble staff prefix
    if (_hand !== 'left') {
      const ty = sy;
      _drawTrebleClef(x + 4 * _zoom, ty, sp);
      _drawKeySig(x, ty, sp, _score.keyFifths, _score.keyMode, 'treble');
      if (showTimeSig) _drawTimeSig(x, ty, sp, _score.beats, _score.beatType);
    }
    // Bass staff prefix
    if (_hand !== 'right') {
      const by = sy + (STAFF_H + STAFF_GAP) * _zoom;
      _drawBassClef(x + 4 * _zoom, by, sp);
      _drawKeySig(x, by, sp, _score.keyFifths, _score.keyMode, 'bass');
      if (showTimeSig) _drawTimeSig(x, by, sp, _score.beats, _score.beatType);
    }
    // Brace
    if (_hand === 'both') {
      const ty = sy;
      const by = sy + (STAFF_H + STAFF_GAP) * _zoom;
      const g  = _el('text');
      g.setAttribute('x',           x - 2 * _zoom);
      g.setAttribute('y',           ty + (STAFF_H * _zoom) / 2 + STAFF_GAP * _zoom / 2);
      g.setAttribute('font-size',   (STAFF_H * 2 + STAFF_GAP) * _zoom + 'px');
      g.setAttribute('fill',        COLOR_STAFF);
      g.setAttribute('text-anchor', 'end');
      g.textContent = '𝄔';
      _svg.appendChild(g);
    }
  }

  // ── Draw a measure ────────────────────────

  function _drawMeasure(measure, x, sy, w, sp) {
    const beatW  = w / measure.totalBeats;
    const notePositions = []; // [{beatPos, x, noteIdx}]

    // Draw staves
    if (_hand !== 'left') {
      _drawStaff(x, sy, w, sp, 'treble', measure.idx);
    }
    if (_hand !== 'right') {
      const by = sy + (STAFF_H + STAFF_GAP) * _zoom;
      _drawStaff(x, by, w, sp, 'bass', measure.idx);
    }

    // Opening barline
    _drawBarline(x, sy, sp);

    // Draw notes
    const noteXMap = new Map(); // beatPos key → x

    measure.notes.forEach((note, nIdx) => {
      const color = note.staff === 1 ? COLOR_RIGHT : COLOR_LEFT;
      if (_hand === 'right' && note.staff !== 1) return;
      if (_hand === 'left'  && note.staff !== 2) return;

      const staffY = note.staff === 1
        ? sy
        : sy + (STAFF_H + STAFF_GAP) * _zoom;

      const nx = x + note.beatPos * beatW + beatW * 0.15;

      if (!note.isChord) {
        noteXMap.set(note.beatPos, nx);
        notePositions.push({ beatPos: note.beatPos, x: nx });
      }

      if (note.isRest) {
        _drawRest(nx, staffY, note.type, note.dot, sp, color);
      } else {
        const ny = _noteY(note.staffStep, staffY, sp, note.staff === 2);
        _drawNote(nx, ny, staffY, note, sp, color);
      }
    });

    _measureLayouts.push({
      idx:   measure.idx,
      x, w,
      beatW,
      sy,
      notePositions: notePositions.sort((a,b) => a.beatPos - b.beatPos),
    });

    // Measure number
    const numEl = _el('text');
    numEl.setAttribute('x',         x + 2 * _zoom);
    numEl.setAttribute('y',         sy - 3 * _zoom);
    numEl.setAttribute('font-size', 7 * _zoom + 'px');
    numEl.setAttribute('fill',      '#aaa');
    numEl.textContent = measure.idx + 1;
    _svg.appendChild(numEl);

    // Clickable overlay for loop selection
    const clickH = (STAFF_H * 2 + STAFF_GAP) * _zoom;
    const hit = _el('rect');
    hit.setAttribute('x',       x); hit.setAttribute('y', sy);
    hit.setAttribute('width',   w); hit.setAttribute('height', clickH);
    hit.setAttribute('fill',    'transparent');
    hit.setAttribute('cursor',  'pointer');
    hit.dataset.measureIdx = measure.idx;
    hit.addEventListener('click', () => { if (_onMeasureClick) _onMeasureClick(measure.idx); });
    _svg.appendChild(hit);
  }

  // ── Staff drawing ─────────────────────────

  function _drawStaff(x, y, w, sp, clef, measureIdx) {
    const g = _el('g');
    g.dataset.clef        = clef;
    g.dataset.measureIdx  = measureIdx;
    for (let i = 0; i < STAFF_LINES; i++) {
      const line = _el('line');
      const ly   = y + i * sp;
      line.setAttribute('x1',           x);       line.setAttribute('y1', ly);
      line.setAttribute('x2',           x + w);   line.setAttribute('y2', ly);
      line.setAttribute('stroke',       COLOR_STAFF);
      line.setAttribute('stroke-width', LINE_W * _zoom);
      g.appendChild(line);
    }
    _svg.appendChild(g);
  }

  function _drawBarline(x, sy, sp) {
    const h   = (STAFF_H * 2 + STAFF_GAP) * _zoom;
    const bar = _el('line');
    bar.setAttribute('x1',           x); bar.setAttribute('y1', sy);
    bar.setAttribute('x2',           x); bar.setAttribute('y2', sy + h);
    bar.setAttribute('stroke',       COLOR_STAFF);
    bar.setAttribute('stroke-width', LINE_W * _zoom);
    _svg.appendChild(bar);
  }

  // ── Note Y position ───────────────────────
  // staffStep: steps from C4 (C4=0, D4=1, E4=2...)
  // Treble staff: B4 (step 6) sits on the middle line (line 2, y = staffY + 2*sp)
  // Each staff step = sp/2 upward

  function _noteY(staffStep, staffY, sp, isBass) {
    if (isBass) {
      // Bass staff: D3 (step -1 from C4, so -1) sits on middle line
      // Middle line of bass = staffY + 2*sp
      // D3 = staffStep -1 (from C4). Middle line note = D3.
      // Each step up = sp/2 up
      const D3_STEP = -1; // D3 relative to C4
      return (staffY + 2 * sp) - (staffStep - D3_STEP) * (sp / 2);
    } else {
      // Treble: B4 (step 6) on middle line
      const B4_STEP = 6;
      return (staffY + 2 * sp) - (staffStep - B4_STEP) * (sp / 2);
    }
  }

  // ── Draw note ─────────────────────────────

  function _drawNote(x, y, staffY, note, sp, color) {
    const isFilled = !['whole','half'].includes(note.type);

    // Ledger lines
    _drawLedgers(x, y, staffY, sp, color);

    // Accidental
    if (note.acc || note.alter !== 0) {
      _drawAccidental(x - sp * 1.1, y, note.alter, sp, color);
    }

    // Notehead
    const nh = _el('ellipse');
    nh.setAttribute('cx',    x);  nh.setAttribute('cy', y);
    nh.setAttribute('rx',    NOTE_RX * _zoom);
    nh.setAttribute('ry',    NOTE_RY * _zoom);
    nh.setAttribute('fill',  isFilled ? color : 'none');
    if (!isFilled) {
      nh.setAttribute('stroke',       color);
      nh.setAttribute('stroke-width', LINE_W * 1.5 * _zoom);
    }
    // Slight rotation for open noteheads
    nh.setAttribute('transform', `rotate(-15,${x},${y})`);
    _svg.appendChild(nh);

    // Stem (not for whole notes)
    if (note.type !== 'whole') {
      const stemUp  = note.staffStep < (note.staff === 1 ? 6 : -1); // below middle → stem up
      const stemX   = stemUp ? x + NOTE_RX * _zoom - 0.5 : x - NOTE_RX * _zoom + 0.5;
      const stemY1  = y;
      const stemY2  = stemUp ? y - STEM_H * _zoom : y + STEM_H * _zoom;
      const stem    = _el('line');
      stem.setAttribute('x1',           stemX); stem.setAttribute('y1', stemY1);
      stem.setAttribute('x2',           stemX); stem.setAttribute('y2', stemY2);
      stem.setAttribute('stroke',       color);
      stem.setAttribute('stroke-width', LINE_W * 1.5 * _zoom);
      _svg.appendChild(stem);

      // Flags
      const flags = { eighth:1, '16th':2, '32nd':3 };
      const nFlags = flags[note.type] || 0;
      for (let f = 0; f < nFlags; f++) {
        const fy = stemUp ? stemY2 + f * sp * 0.8 : stemY2 - f * sp * 0.8;
        const flag = _el('path');
        const dx   = sp * 0.9 * _zoom;
        const dy   = sp * 0.7 * _zoom;
        if (stemUp) {
          flag.setAttribute('d', `M${stemX},${fy} C${stemX+dx},${fy+dy} ${stemX+dx*0.5},${fy+dy*1.5} ${stemX},${fy+dy*2}`);
        } else {
          flag.setAttribute('d', `M${stemX},${fy} C${stemX+dx},${fy-dy} ${stemX+dx*0.5},${fy-dy*1.5} ${stemX},${fy-dy*2}`);
        }
        flag.setAttribute('fill',   'none');
        flag.setAttribute('stroke', color);
        flag.setAttribute('stroke-width', LINE_W * 1.5 * _zoom);
        _svg.appendChild(flag);
      }
    }

    // Dot
    if (note.dot) {
      const dot = _el('circle');
      dot.setAttribute('cx',   x + NOTE_RX * _zoom + sp * 0.6);
      dot.setAttribute('cy',   y % sp < sp / 2 ? y - sp * 0.25 : y); // nudge off line
      dot.setAttribute('r',    sp * 0.15);
      dot.setAttribute('fill', color);
      _svg.appendChild(dot);
    }
  }

  // ── Ledger lines ──────────────────────────

  function _drawLedgers(nx, ny, staffY, sp, color) {
    const topLine = staffY;
    const botLine = staffY + 4 * sp;
    const lw      = LEDGER_W * _zoom;

    // Lines above staff
    if (ny < topLine - sp * 0.5) {
      for (let y = topLine - sp; y >= ny - sp * 0.5; y -= sp) {
        _line(nx - lw, y, nx + lw, y, color, LINE_W * _zoom);
      }
    }
    // Lines below staff
    if (ny > botLine + sp * 0.5) {
      for (let y = botLine + sp; y <= ny + sp * 0.5; y += sp) {
        _line(nx - lw, y, nx + lw, y, color, LINE_W * _zoom);
      }
    }
  }

  // ── Accidentals ───────────────────────────

  function _drawAccidental(x, y, alter, sp, color) {
    const t = _el('text');
    t.setAttribute('x',         x);
    t.setAttribute('y',         y + sp * 0.35);
    t.setAttribute('font-size', sp * 1.6 + 'px');
    t.setAttribute('fill',      color);
    t.setAttribute('text-anchor', 'middle');
    t.textContent = alter > 0 ? '♯' : alter < 0 ? '♭' : '♮';
    _svg.appendChild(t);
  }

  // ── Rest drawing ──────────────────────────

  function _drawRest(x, staffY, type, dot, sp, color) {
    const my = staffY + 2 * sp; // middle line
    const t  = _el('text');
    t.setAttribute('x',           x);
    t.setAttribute('y',           my + sp * 0.4);
    t.setAttribute('font-size',   sp * 1.8 + 'px');
    t.setAttribute('fill',        color);
    t.setAttribute('text-anchor', 'middle');
    // Unicode rest symbols
    const RESTS = {
      whole: '𝄻', half: '𝄼', quarter: '𝄽',
      eighth: '𝄾', '16th': '𝄿', '32nd': '𝅀',
    };
    t.textContent = RESTS[type] || '𝄽';
    _svg.appendChild(t);
  }

  // ── Clef drawing ──────────────────────────

  function _drawTrebleClef(x, staffY, sp) {
    const t = _el('text');
    t.setAttribute('x',         x);
    t.setAttribute('y',         staffY + 4.2 * sp);
    t.setAttribute('font-size', sp * 6.5 + 'px');
    t.setAttribute('fill',      COLOR_STAFF);
    t.textContent = '𝄞';
    _svg.appendChild(t);
  }

  function _drawBassClef(x, staffY, sp) {
    const t = _el('text');
    t.setAttribute('x',         x);
    t.setAttribute('y',         staffY + 2.8 * sp);
    t.setAttribute('font-size', sp * 3.5 + 'px');
    t.setAttribute('fill',      COLOR_STAFF);
    t.textContent = '𝄢';
    _svg.appendChild(t);
  }

  // ── Key signature ─────────────────────────

  function _drawKeySig(x, staffY, sp, fifths, mode, clef) {
    if (fifths === 0) return;
    const SHARP_TREBLE = [4, 1, 5, 2, 6, 3, 7]; // staff steps from top line
    const FLAT_TREBLE  = [6, 3, 7, 4, 8, 5, 9];
    const SHARP_BASS   = [2, -1, 3, 0, 4, 1, 5];
    const FLAT_BASS    = [4, 1, 5, 2, 6, 3, 7];

    const steps  = fifths > 0
      ? (clef === 'treble' ? SHARP_TREBLE : SHARP_BASS)
      : (clef === 'treble' ? FLAT_TREBLE  : FLAT_BASS);
    const count  = Math.abs(fifths);
    const sym    = fifths > 0 ? '♯' : '♭';
    const startX = x + 24 * _zoom;

    for (let i = 0; i < count; i++) {
      const step  = steps[i];
      // Convert staff step to Y: treble B4=step6 on line 2
      const refStep   = clef === 'treble' ? 6 : -1;
      const noteY     = (staffY + 2 * sp) - (step - refStep) * (sp / 2);
      const t = _el('text');
      t.setAttribute('x',         startX + i * sp * 0.9);
      t.setAttribute('y',         noteY + sp * 0.35);
      t.setAttribute('font-size', sp * 1.4 + 'px');
      t.setAttribute('fill',      COLOR_STAFF);
      t.textContent = sym;
      _svg.appendChild(t);
    }
  }

  // ── Time signature ────────────────────────

  function _drawTimeSig(x, staffY, sp, beats, beatType) {
    const tx = x + 38 * _zoom;
    [beats, beatType].forEach((n, i) => {
      const t = _el('text');
      t.setAttribute('x',           tx);
      t.setAttribute('y',           staffY + (i === 0 ? 1.5 : 3.5) * sp);
      t.setAttribute('font-size',   sp * 2 + 'px');
      t.setAttribute('font-weight', 'bold');
      t.setAttribute('fill',        COLOR_STAFF);
      t.setAttribute('text-anchor', 'middle');
      t.textContent = n;
      _svg.appendChild(t);
    });
  }

  // ── Hand visibility ───────────────────────
  // We track which staff each element belongs to via data-clef,
  // then show/hide those groups.

  function _applyHandVisibility(hand) {
    if (!_svg) return;
    // Staves are <g data-clef="treble/bass"> elements
    _svg.querySelectorAll('g[data-clef]').forEach(g => {
      const isTreble = g.dataset.clef === 'treble';
      if (hand === 'both')  g.style.display = '';
      else if (hand === 'right') g.style.display = isTreble ? '' : 'none';
      else                       g.style.display = isTreble ? 'none' : '';
    });
  }

  // ── Cursor ────────────────────────────────

  function showCursor()  { if (_cursorEl) _cursorEl.setAttribute('visibility', 'visible'); }
  function hideCursor()  { if (_cursorEl) _cursorEl.setAttribute('visibility', 'hidden'); }
  function resetCursor() {
    if (!_cursorEl || !_measureLayouts.length) return;
    _moveCursorToMeasurePos(0, 0);
  }

  function setCursorToTime(timeBeat, beatsPerMeasure) {
    if (!_cursorEl || !_measureLayouts.length) return;
    const measureIdx = Math.floor(timeBeat / beatsPerMeasure);
    const beatInMeasure = timeBeat - measureIdx * beatsPerMeasure;
    _moveCursorToMeasurePos(measureIdx, beatInMeasure);
  }

  function _moveCursorToMeasurePos(measureIdx, beatInMeasure) {
    const layout = _measureLayouts.find(m => m.idx === measureIdx);
    if (!layout) return;

    // Find the note position at or just before this beat
    let np = layout.notePositions[0];
    for (const p of layout.notePositions) {
      if (p.beatPos <= beatInMeasure + 0.01) np = p;
      else break;
    }

    const cx = np ? np.x - NOTE_RX * _zoom * 1.5 : layout.x;
    const cy = layout.sy;
    const cw = layout.beatW * 0.85;
    const ch = (STAFF_H * 2 + STAFF_GAP) * _zoom;

    _cursorEl.setAttribute('x',      cx);
    _cursorEl.setAttribute('y',      cy);
    _cursorEl.setAttribute('width',  Math.max(cw, 8));
    _cursorEl.setAttribute('height', ch);

    // Scroll into view
    if (_container) {
      const svgRect = _svg.getBoundingClientRect();
      const conRect = _container.getBoundingClientRect();
      const noteAbsY = svgRect.top + cy - conRect.top + _container.scrollTop;
      const viewH    = _container.clientHeight;
      if (noteAbsY < _container.scrollTop || noteAbsY > _container.scrollTop + viewH - ch) {
        _container.scrollTop = noteAbsY - viewH * 0.3;
      }
    }
  }

  // ── Loop overlay ──────────────────────────

  function setLoopPoints(startMeasure, endMeasure) {
    const s = _measureLayouts.find(m => m.idx === startMeasure);
    const e = _measureLayouts.find(m => m.idx === endMeasure);
    if (!s || !_loopEl) return;
    const ex = e ? e.x + e.w : s.x + s.w;
    _loopEl.setAttribute('x',       s.x);
    _loopEl.setAttribute('y',       s.sy);
    _loopEl.setAttribute('width',   ex - s.x);
    _loopEl.setAttribute('height',  (STAFF_H * 2 + STAFF_GAP) * _zoom);
    _loopEl.setAttribute('visibility', 'visible');
  }

  function clearLoopPoints() {
    if (_loopEl) _loopEl.setAttribute('visibility', 'hidden');
  }

  // ── getNoteRange ──────────────────────────

  function getNoteRange(hand) {
    if (!_score) return { minMidi: 48, maxMidi: 84 };
    let min = 127, max = 0;
    _score.measures.forEach(m => {
      m.notes.forEach(n => {
        if (n.isRest || !n.midi) return;
        if (hand === 'right' && n.staff !== 1) return;
        if (hand === 'left'  && n.staff !== 2) return;
        min = Math.min(min, n.midi);
        max = Math.max(max, n.midi);
      });
    });
    if (min > max) return { minMidi: 48, maxMidi: 84 };
    return { minMidi: Math.max(21, min - 2), maxMidi: Math.min(108, max + 2) };
  }

  // Extract note events for player
  function extractNoteEvents(beatsPerMeasure) {
    if (!_score) return [];
    const events = [];
    _score.measures.forEach(m => {
      m.notes.forEach(n => {
        if (n.isRest || !n.midi) return;
        const hand     = n.staff === 1 ? 'right' : 'left';
        const timeBeat = m.idx * beatsPerMeasure + n.beatPos;
        events.push({ time: timeBeat, duration: n.durBeats, midi: n.midi, hand });
      });
    });
    events.sort((a, b) => a.time - b.time || a.midi - b.midi);
    console.log('Events:', events.length, '| First 6:',
      events.slice(0,6).map(e => `t=${e.time.toFixed(1)} m=${e.midi} ${e.hand[0]}`).join(' '));
    return events;
  }

  // ── SVG helpers ───────────────────────────

  function _el(tag) {
    return document.createElementNS('http://www.w3.org/2000/svg', tag);
  }

  function _line(x1, y1, x2, y2, stroke, sw) {
    const l = _el('line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1);
    l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    l.setAttribute('stroke', stroke);
    l.setAttribute('stroke-width', sw);
    _svg.appendChild(l);
    return l;
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
