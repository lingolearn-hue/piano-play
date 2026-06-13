/* ─────────────────────────────────────────
   player.js — Playback engine
   
   Each note fires at its own time and holds
   for its own duration independently.
   ───────────────────────────────────────── */
'use strict';

const Player = (() => {

  let _playing      = false;
  let _tempoPercent = 100;
  let _hand         = 'both';
  let _timeouts     = [];   // all scheduled timeouts so stop() can clear them
  let _bpm          = 120;

  // Active notes: midi → timeoutId for note-off
  let _activeNoteOffs = new Map();

  // Tone.js sampler
  let _sampler        = null;
  let _samplerReady   = false;
  let _samplerLoading = false;

  // Web Audio fallback
  let _audioCtx = null;

  // Callbacks
  let _onNoteOn  = null;
  let _onNoteOff = null;
  let _onBeat    = null;  // (groupIndex, totalGroups)
  let _onEnd     = null;

  // ── MIDI helpers ──────────────────────────

  function midiToNoteName(midi) {
    const n = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    return n[midi % 12] + (Math.floor(midi / 12) - 1);
  }
  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // ── Build beat groups (for cursor sync only) ──
  // Groups note events by onset time so we know when to fire _onBeat.

  function _buildOnsetGroups(noteEvents) {
    const map = new Map();
    noteEvents
      .filter(ev => _shouldPlayHand(ev.hand))
      .forEach(ev => {
        const key = Math.round(ev.time * 1000);
        if (!map.has(key)) map.set(key, { beat: ev.time, events: [] });
        map.get(key).events.push(ev);
      });
    return [...map.values()].sort((a, b) => a.beat - b.beat);
  }

  function _shouldPlayHand(hand) {
    if (_hand === 'both')  return true;
    if (_hand === 'right') return hand === 'right';
    if (_hand === 'left')  return hand === 'left';
    return true;
  }

  // ── Play ──────────────────────────────────

  function play(noteEvents, bpm, tempoPercent) {
    stop();
    if (!noteEvents?.length) return;

    _bpm          = bpm || 120;
    _tempoPercent = tempoPercent ?? _tempoPercent;
    _playing      = true;

    const scaledBpm  = _bpm * (_tempoPercent / 100);
    const beatsToMs  = beats => (beats / scaledBpm) * 60_000;

    const filtered = noteEvents.filter(ev => _shouldPlayHand(ev.hand));
    if (!filtered.length) return;

    // Build onset groups for cursor/beat callbacks
    const groups = _buildOnsetGroups(noteEvents);
    console.log(`Playing ${filtered.length} notes in ${groups.length} onset groups`);
    console.log('First 6 groups:', groups.slice(0,6).map(g =>
      `t=${g.beat.toFixed(2)} [${g.events.map(e=>e.midi).join(',')}]`).join(' | '));

    // Schedule each note independently with its own duration
    filtered.forEach((ev, i) => {
      const startMs = beatsToMs(ev.time);
      const durMs   = Math.max(50, beatsToMs(ev.duration) * 0.95);

      // Note ON
      const onId = setTimeout(() => {
        _soundNoteOn(ev.midi, durMs / 1000);
        if (_onNoteOn) _onNoteOn(ev.midi, ev.hand);
      }, startMs);
      _timeouts.push(onId);

      // Note OFF
      const offId = setTimeout(() => {
        if (_onNoteOff) _onNoteOff(ev.midi);
      }, startMs + durMs);
      _timeouts.push(offId);
    });

    // Schedule beat callbacks (for cursor sync) at each onset group
    groups.forEach((group, idx) => {
      const startMs = beatsToMs(group.beat);
      const id = setTimeout(() => {
        if (_onBeat) _onBeat(group.beat);
      }, startMs);
      _timeouts.push(id);
    });

    // End callback
    const lastNote   = filtered.reduce((a, b) => (a.time + a.duration > b.time + b.duration ? a : b));
    const totalMs    = beatsToMs(lastNote.time + lastNote.duration) + 100;
    const endId = setTimeout(() => {
      _playing = false;
      if (_onEnd) _onEnd();
    }, totalMs);
    _timeouts.push(endId);
  }

  function stop() {
    _playing = false;
    _timeouts.forEach(id => clearTimeout(id));
    _timeouts = [];
    // Fire noteOff for any still-active notes
    _activeNoteOffs.forEach((id, midi) => {
      clearTimeout(id);
      if (_onNoteOff) _onNoteOff(midi);
    });
    _activeNoteOffs.clear();
  }

  // ── Audio ─────────────────────────────────

  function _soundNoteOn(midi, durSec) {
    if (_samplerReady && _sampler) {
      try {
        _sampler.triggerAttackRelease(midiToNoteName(midi), durSec);
        return;
      } catch (e) {}
    }
    _oscNoteOn(midi, durSec);
    if (!_samplerReady && !_samplerLoading) _loadSampler();
  }

  function _getCtx() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    return _audioCtx;
  }

  function _oscNoteOn(midi, durSec) {
    const ctx  = _getCtx();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durSec);
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type  = 'triangle';
    osc.frequency.value = midiToFreq(midi);
    osc.connect(gain);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + durSec + 0.05);
  }

  // ── Tone.js sampler ───────────────────────

  async function _loadSampler() {
    if (_samplerLoading || _samplerReady) return;
    _samplerLoading = true;
    try {
      if (typeof Tone === 'undefined') {
        await _loadScript('https://cdnjs.cloudflare.com/ajax/libs/tone/14.9.3/Tone.js');
      }
      await Tone.start();
      _sampler = new Tone.Sampler({
        urls: {
          A0:'A0.mp3', C1:'C1.mp3', 'D#1':'Ds1.mp3', 'F#1':'Fs1.mp3',
          A1:'A1.mp3', C2:'C2.mp3', 'D#2':'Ds2.mp3', 'F#2':'Fs2.mp3',
          A2:'A2.mp3', C3:'C3.mp3', 'D#3':'Ds3.mp3', 'F#3':'Fs3.mp3',
          A3:'A3.mp3', C4:'C4.mp3', 'D#4':'Ds4.mp3', 'F#4':'Fs4.mp3',
          A4:'A4.mp3', C5:'C5.mp3', 'D#5':'Ds5.mp3', 'F#5':'Fs5.mp3',
          A5:'A5.mp3', C6:'C6.mp3', 'D#6':'Ds6.mp3', 'F#6':'Fs6.mp3',
          A6:'A6.mp3', C7:'C7.mp3', 'D#7':'Ds7.mp3', 'F#7':'Fs7.mp3',
          A7:'A7.mp3', C8:'C8.mp3',
        },
        baseUrl: 'https://gleitz.github.io/midi-js-soundfonts/MusyngKite/acoustic_grand_piano-mp3/',
        onload: () => { _samplerReady = true; _samplerLoading = false; console.log('Sampler ready'); },
        onerror: () => { _samplerLoading = false; },
      }).toDestination();
    } catch (e) { _samplerLoading = false; }
  }

  function _loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // ── Public ────────────────────────────────

  function setTempo(pct) { _tempoPercent = Math.max(25, Math.min(150, pct)); }
  function setHand(h)    { _hand = h; }
  function preloadSampler() { _loadSampler(); }

  return {
    play, stop, setTempo, setHand, preloadSampler,
    midiToNoteName, midiToFreq,
    get isPlaying()    { return _playing; },
    get tempoPercent() { return _tempoPercent; },
    set onNoteOn(fn)   { _onNoteOn  = fn; },
    set onNoteOff(fn)  { _onNoteOff = fn; },
    set onBeat(fn)     { _onBeat    = fn; },
    set onEnd(fn)      { _onEnd     = fn; },
  };
})();

window.Player = Player;
