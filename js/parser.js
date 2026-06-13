/* ─────────────────────────────────────────
   parser.js — MusicXML → data model
   ───────────────────────────────────────── */
'use strict';

const Parser = (() => {

  // MIDI number for a pitch
  function pitchToMidi(step, octave, alter) {
    const BASE = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };
    return (parseInt(octave) + 1) * 12 + BASE[step] + Math.round(parseFloat(alter || 0));
  }

  // Staff-line position (0 = middle C line for treble, used for y calc)
  // Returns steps from the middle of the staff (B4 = 0 for treble)
  // Each step = half a space between lines
  const TREBLE_STEPS = { C:0,D:1,E:2,F:3,G:4,A:5,B:6 }; // C4=0 relative
  function pitchToStaffStep(step, octave, clef) {
    // Steps from C4. Treble staff: B4 sits on middle line (step 6 from C4).
    // Each octave = 7 steps
    const base = TREBLE_STEPS[step] + (parseInt(octave) - 4) * 7;
    return base; // absolute step from C4
  }

  function parse(xmlString) {
    const dom   = new DOMParser().parseFromString(xmlString, 'application/xml');
    const err   = dom.querySelector('parsererror');
    if (err) throw new Error('XML parse error');

    const scoreEl = dom.documentElement;

    // Meta
    const title    = dom.querySelector('work-title, movement-title')?.textContent?.trim() || 'Untitled';
    const composer = dom.querySelector('identification creator[type="composer"]')?.textContent?.trim() || '';

    // Attributes (from first measure)
    const firstAttrs = dom.querySelector('attributes');
    const divisions  = parseInt(firstAttrs?.querySelector('divisions')?.textContent || 1);
    const keyFifths  = parseInt(firstAttrs?.querySelector('key fifths')?.textContent || 0);
    const keyMode    = firstAttrs?.querySelector('key mode')?.textContent || 'major';
    const beats      = parseInt(firstAttrs?.querySelector('time beats')?.textContent || 4);
    const beatType   = parseInt(firstAttrs?.querySelector('time beat-type')?.textContent || 4);
    const staves     = parseInt(firstAttrs?.querySelector('staves')?.textContent || 1);

    // Tempo
    const tempoEl = dom.querySelector('sound[tempo]');
    const tempo   = tempoEl ? parseFloat(tempoEl.getAttribute('tempo')) : 120;

    // Parse measures
    const measures = [];
    let   currentDivisions = divisions;

    dom.querySelectorAll('part > measure').forEach((mEl, mIdx) => {
      // Update divisions if changed mid-piece
      const divEl = mEl.querySelector('attributes divisions');
      if (divEl) currentDivisions = parseInt(divEl.textContent);

      const notes    = [];
      let   pos1     = 0; // position in divisions for staff 1
      let   pos2     = 0; // position in divisions for staff 2
      let   chordPos1 = 0;
      let   chordPos2 = 0;

      mEl.querySelectorAll('note').forEach(nEl => {
        const isChord = !!nEl.querySelector('chord');
        const isRest  = !!nEl.querySelector('rest');
        const staff   = parseInt(nEl.querySelector('staff')?.textContent || 1);
        const dur     = parseInt(nEl.querySelector('duration')?.textContent || 0);
        const type    = nEl.querySelector('type')?.textContent || 'quarter';
        const dot     = !!nEl.querySelector('dot');
        const step    = nEl.querySelector('pitch step')?.textContent || 'C';
        const octave  = parseInt(nEl.querySelector('pitch octave')?.textContent || 4);
        const alter   = parseFloat(nEl.querySelector('pitch alter')?.textContent || 0);
        const acc     = nEl.querySelector('accidental')?.textContent || null;

        // Track beat position
        let pos;
        if (staff === 1) {
          if (isChord) { pos = chordPos1; }
          else         { chordPos1 = pos1; pos = pos1; pos1 += dur; }
        } else {
          if (isChord) { pos = chordPos2; }
          else         { chordPos2 = pos2; pos = pos2; pos2 += dur; }
        }

        const beatPos    = pos / currentDivisions; // in quarter beats
        const durBeats   = dur / currentDivisions;
        const staffStep  = isRest ? null : pitchToStaffStep(step, octave, null);
        const midi       = isRest ? null : pitchToMidi(step, octave, alter);

        notes.push({
          isRest, isChord, staff,
          step, octave, alter: Math.round(alter), acc,
          type, dot,
          beatPos, durBeats,
          staffStep, midi,
        });
      });

      // Total duration of measure in beats
      const totalBeats = beats; // from time signature

      measures.push({ idx: mIdx, notes, totalBeats, divisions: currentDivisions });
    });

    return {
      title, composer,
      keyFifths, keyMode,
      beats, beatType,
      staves, tempo, divisions,
      measures,
    };
  }

  // Parse from File object
  async function importFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    let text;
    if (ext === 'mxl') {
      text = await _readMxl(file);
    } else {
      text = await file.text();
    }
    const score = parse(text);
    return { score, content: text, format: 'musicxml' };
  }

  async function _readMxl(file) {
    const buf   = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const view  = new DataView(buf);

    // Find End of Central Directory
    let eocd = -1;
    for (let i = bytes.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a valid ZIP');

    const cdOffset = view.getUint32(eocd + 16, true);
    const cdCount  = view.getUint16(eocd + 10, true);
    let pos = cdOffset;
    const entries = [];

    for (let i = 0; i < cdCount; i++) {
      if (view.getUint32(pos, true) !== 0x02014b50) break;
      const comp      = view.getUint16(pos + 10, true);
      const compSz    = view.getUint32(pos + 20, true);
      const nameLen   = view.getUint16(pos + 28, true);
      const extraLen  = view.getUint16(pos + 30, true);
      const commLen   = view.getUint16(pos + 32, true);
      const localOff  = view.getUint32(pos + 42, true);
      const name      = new TextDecoder().decode(bytes.slice(pos + 46, pos + 46 + nameLen));
      entries.push({ name, comp, compSz, localOff });
      pos += 46 + nameLen + extraLen + commLen;
    }

    // Find XML entry
    let xmlName = null;
    const container = entries.find(e => e.name === 'META-INF/container.xml');
    if (container) {
      const data = await _extractEntry(bytes, view, container);
      const m = new TextDecoder().decode(data).match(/full-path="([^"]+)"/);
      if (m) xmlName = m[1];
    }
    if (!xmlName) {
      const e = entries.find(e => e.name.endsWith('.xml') && !e.name.startsWith('META-INF'));
      if (e) xmlName = e.name;
    }
    if (!xmlName) throw new Error('No MusicXML entry in .mxl');

    const entry = entries.find(e => e.name === xmlName);
    const data  = await _extractEntry(bytes, view, entry);
    return new TextDecoder().decode(data);
  }

  async function _extractEntry(bytes, view, entry) {
    const lp       = entry.localOff;
    const nameLen  = view.getUint16(lp + 26, true);
    const extraLen = view.getUint16(lp + 28, true);
    const start    = lp + 30 + nameLen + extraLen;
    const compressed = bytes.slice(start, start + entry.compSz);
    if (entry.comp === 0) return compressed;
    if (entry.comp === 8) {
      const ds = new DecompressionStream('deflate-raw');
      const w  = ds.writable.getWriter(); w.write(compressed); w.close();
      const chunks = []; const r = ds.readable.getReader();
      while (true) { const { done, value } = await r.read(); if (done) break; chunks.push(value); }
      const out = new Uint8Array(chunks.reduce((n,c) => n + c.length, 0));
      let off = 0; chunks.forEach(c => { out.set(c, off); off += c.length; });
      return out;
    }
    throw new Error('Unsupported compression: ' + entry.comp);
  }

  return { parse, importFile, pitchToMidi, pitchToStaffStep };
})();

window.Parser = Parser;
