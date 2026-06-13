/* ─────────────────────────────────────────
   app.js — Main controller
   ───────────────────────────────────────── */
'use strict';

const App = (() => {

  let _pieces      = [];
  let _curPiece    = null;
  let _curScore    = null;   // parsed score data
  let _noteEvents  = [];
  let _beatsPerMeasure = 4;
  let _hand        = 'both';
  let _zoom        = 1.0;

  let _filterDiff  = 'all';
  let _searchQuery = '';

  let _loopOn      = false;
  let _loopStart   = null;
  let _loopEnd     = null;
  let _loopTap     = 0;      // 0=idle 1=waiting for end

  let _editId      = null;

  // ── Boot ──────────────────────────────────

  async function init() {
    await DB.openDB();
    await DB.migrate();

    const theme = await DB.getSetting('theme', 'dark');
    document.body.className = `theme-${theme}`;

    Keyboard.init(document.getElementById('keyboard-canvas'));
    Score.init(document.getElementById('score-container'));

    Score.onMeasureClick(measureIdx => {
      if (!_loopOn) return;
      if (_loopTap === 0) {
        _loopStart = measureIdx; _loopEnd = null; _loopTap = 1;
        _updateLoopUI(); toast(`Loop start: m${measureIdx + 1} — tap end`);
      } else {
        _loopEnd = Math.max(_loopStart, measureIdx); _loopTap = 0;
        Score.setLoopPoints(_loopStart, _loopEnd);
        _updateLoopUI(); toast(`Loop: m${_loopStart+1}–${_loopEnd+1}`);
      }
    });

    _bindEvents();
    await refreshLibrary();
    showScreen('library');
  }

  // ── Screens ───────────────────────────────

  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${name}`)?.classList.add('active');
    document.body.dataset.screen = name;
  }

  // ── Library ───────────────────────────────

  async function refreshLibrary() {
    _pieces = await DB.getAllPieces();
    if (!_pieces.length) { await _seedPieces(); _pieces = await DB.getAllPieces(); }
    await renderLibrary();
  }

  async function renderLibrary() {
    const grid  = document.getElementById('library-grid');
    const empty = document.getElementById('library-empty');
    grid.innerHTML = '';

    let list = _pieces;
    if (_filterDiff !== 'all') list = list.filter(p => p.difficulty === parseInt(_filterDiff));
    if (_searchQuery) {
      const q = _searchQuery.toLowerCase();
      list = list.filter(p =>
        p.title.toLowerCase().includes(q) ||
        (p.composer||'').toLowerCase().includes(q) ||
        (p.tags||[]).some(t => t.toLowerCase().includes(q))
      );
    }

    if (!list.length) {
      grid.classList.add('hidden'); empty.classList.remove('hidden'); return;
    }
    grid.classList.remove('hidden'); empty.classList.add('hidden');

    const dueIds = new Set(await Practice.getDuePieces(list.map(p => p.id)));

    for (const piece of list) {
      const last = await DB.getLastSessionDate(piece.id);
      const card = _makeCard(piece, last, dueIds.has(piece.id));
      grid.appendChild(card);
    }
  }

  function _makeCard(piece, lastDate, isDue) {
    const card = document.createElement('div');
    card.className = 'piece-card';
    card.innerHTML = `
      ${isDue ? '<div class="due-badge" title="Due for practice"></div>' : ''}
      <div class="card-title">${_esc(piece.title)}</div>
      ${piece.composer ? `<div class="card-composer">${_esc(piece.composer)}</div>` : ''}
      <div class="card-meta">
        <div class="diff-dots">
          ${[1,2,3,4,5].map(i => `<div class="diff-dot ${i <= piece.difficulty ? 'on' : ''}"></div>`).join('')}
        </div>
        ${piece.keySignature ? `<span class="card-tag">${_esc(piece.keySignature)}</span>` : ''}
        ${piece.timeSignature ? `<span class="card-tag">${_esc(piece.timeSignature)}</span>` : ''}
      </div>
      ${(piece.tags||[]).slice(0,3).map(t => `<span class="card-tag">${_esc(t)}</span>`).join('')}
      ${lastDate ? `<div style="font-size:10px;color:var(--text-muted);margin-top:4px">Practiced ${_relDate(lastDate)}</div>` : ''}
      <div class="card-actions">
        <button class="btn-icon edit-btn" title="Edit" aria-label="Edit piece">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      </div>
    `;

    card.querySelector('.edit-btn').addEventListener('click', e => {
      e.stopPropagation(); openEditor(piece.id);
    });

    // Single tap / touchstart for instant open
    let tapped = false;
    card.addEventListener('touchstart', () => { tapped = true; openPractice(piece.id); }, { passive: true });
    card.addEventListener('click', () => { if (!tapped) openPractice(piece.id); tapped = false; });

    return card;
  }

  // ── Practice ──────────────────────────────

  async function openPractice(pieceId) {
    const piece = await DB.getPiece(pieceId);
    if (!piece) return;

    _curPiece = piece;
    _curScore = null;
    _noteEvents = [];
    _beatsPerMeasure = parseInt(piece.timeSignature?.split('/')[0]) || 4;

    document.getElementById('score-title').textContent    = piece.title;
    document.getElementById('score-composer').textContent = piece.composer || '';
    showScreen('practice');

    Practice.startSession(pieceId, Player.tempoPercent);
    _setPlayUI(false);
    _clearLoop();

    // Reset hand to 'both'
    _setHand('both');
    document.getElementById('tempo-slider').value = '100';
    document.getElementById('tempo-val').textContent = '100%';
    Player.setTempo(100);

    const score = piece.scores?.find(s => s.format === 'musicxml');
    if (!score?.content) {
      document.getElementById('score-placeholder').textContent = 'No score — import a MusicXML file';
      document.getElementById('score-placeholder').classList.remove('hidden');
      return;
    }

    document.getElementById('score-placeholder').textContent = 'Loading…';
    document.getElementById('score-placeholder').classList.remove('hidden');

    try {
      _curScore = Parser.parse(score.content);
      Score.render(_curScore, _hand);

      document.getElementById('score-placeholder').classList.add('hidden');
      Score.showCursor();

      _noteEvents = Score.extractNoteEvents(_beatsPerMeasure);

      const range = Score.getNoteRange(_hand);
      Keyboard.setRange(range.minMidi, range.maxMidi);

      Player.onNoteOn  = (midi, hand) => Keyboard.noteOn(midi, hand);
      Player.onNoteOff = (midi)       => Keyboard.noteOff(midi);
      Player.onBeat    = (idx)        => {
        const t = _noteEvents[idx]?.time ?? 0;
        Score.setCursorToTime(t, _beatsPerMeasure);
      };
      Player.onEnd = () => {
        Keyboard.clearNotes();
        _setPlayUI(false);
        if (_loopOn && _loopStart !== null) {
          setTimeout(_startPlay, 200);
        } else {
          Score.resetCursor();
        }
      };

      Player.preloadSampler();
    } catch (e) {
      document.getElementById('score-placeholder').textContent = 'Error: ' + e.message;
      console.error(e);
    }
  }

  function leavePractice() {
    Player.stop();
    Pitch.stop();
    Practice.endSession();
    Keyboard.clearNotes();
    _clearLoop();
    _curPiece = null; _curScore = null; _noteEvents = [];
    showScreen('library');
  }

  // ── Playback ──────────────────────────────

  function _startPlay() {
    if (!_noteEvents.length) { toast('No notes in score', true); return; }
    let events = _noteEvents;
    if (_loopOn && _loopStart !== null && _loopEnd !== null) {
      const lo = _loopStart * _beatsPerMeasure;
      const hi = (_loopEnd + 1) * _beatsPerMeasure;
      events = events.filter(e => e.time >= lo && e.time < hi);
    }
    Score.showCursor();
    Score.setCursorToTime(events[0]?.time ?? 0, _beatsPerMeasure);
    _setPlayUI(true);
    Player.play(events, _curPiece.tempo || 120, Player.tempoPercent);
  }

  function _handlePlay() {
    if (!_curPiece) return;
    if (Player.isPlaying) { Player.stop(); _setPlayUI(false); }
    else _startPlay();
  }

  function _handleStop() {
    Player.stop(); Score.resetCursor(); Keyboard.clearNotes(); _setPlayUI(false);
  }

  function _setPlayUI(on) {
    document.getElementById('icon-play') .classList.toggle('hidden',  on);
    document.getElementById('icon-pause').classList.toggle('hidden', !on);
  }

  // ── Hand ──────────────────────────────────

  function _setHand(hand) {
    _hand = hand;
    // Sync both transport and panel hand buttons
    document.querySelectorAll('.hand-btns .btn-tag, .hand-btns-panel .btn-tag').forEach(b => {
      b.classList.toggle('active', b.dataset.hand === hand);
      b.setAttribute('aria-pressed', String(b.dataset.hand === hand));
    });
    if (_curScore) {
      Score.setHand(hand);
      const range = Score.getNoteRange(hand);
      Keyboard.setRange(range.minMidi, range.maxMidi);
    }
    Player.setHand(hand);
  }

  // ── Loop ──────────────────────────────────

  function _toggleLoop() {
    const btn = document.getElementById('btn-loop');
    _loopOn = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(_loopOn));
    btn.classList.toggle('active', _loopOn);
    if (!_loopOn) Score.clearLoopPoints();
    else if (_loopStart !== null && _loopEnd !== null) Score.setLoopPoints(_loopStart, _loopEnd);
    _updateLoopUI();
  }

  function _clearLoop() {
    _loopOn = false; _loopStart = null; _loopEnd = null; _loopTap = 0;
    Score.clearLoopPoints();
    const btn = document.getElementById('btn-loop');
    btn.setAttribute('aria-pressed', 'false'); btn.classList.remove('active');
    _updateLoopUI();
  }

  function _updateLoopUI() {
    const r = document.getElementById('loop-range');
    r.textContent = (_loopStart !== null && _loopEnd !== null)
      ? `m${_loopStart+1}–${_loopEnd+1}`
      : _loopStart !== null ? `m${_loopStart+1}–?` : '—';
  }

  // ── Import ────────────────────────────────

  async function handleImport(file) {
    const dz   = document.getElementById('drop-zone');
    const bar  = document.getElementById('prog-bar');
    const fill = document.getElementById('prog-fill');
    const stat = document.getElementById('import-status');

    dz.classList.add('hidden'); bar.classList.remove('hidden');
    stat.textContent = 'Parsing…'; fill.style.width = '30%';

    try {
      const { score, content, format } = await Parser.importFile(file);
      fill.style.width = '70%'; stat.textContent = 'Saving…';

      const piece = {
        id: DB.uuid(), title: score.title, composer: score.composer || '',
        arranger: null, difficulty: 3,
        tempo: score.tempo || 120,
        timeSignature: `${score.beats}/${score.beatType}`,
        keySignature: _fifthsToKey(score.keyFifths, score.keyMode),
        tags: [], language: null,
        createdAt: Date.now(), updatedAt: Date.now(),
        scores: [{ id: DB.uuid(), label: 'Full score', format, content, hands: 'both' }],
        setlistIds: [],
      };

      await DB.savePiece(piece);
      fill.style.width = '100%'; stat.textContent = 'Done!';

      setTimeout(async () => {
        _closeModal('modal-import');
        _resetImport();
        await refreshLibrary();
        toast(`"${piece.title}" imported`);
      }, 400);
    } catch (e) {
      _resetImport();
      stat.textContent = 'Error: ' + e.message;
      toast(e.message, true);
    }
  }

  function _resetImport() {
    document.getElementById('drop-zone').classList.remove('hidden');
    document.getElementById('prog-bar').classList.add('hidden');
    document.getElementById('prog-fill').style.width = '0';
    document.getElementById('file-input').value = '';
  }

  function _fifthsToKey(fifths, mode) {
    const maj = ['C','G','D','A','E','B','F#','C#','F','Bb','Eb','Ab','Db','Gb','Cb'];
    const min = ['Am','Em','Bm','F#m','C#m','G#m','D#m','A#m','Dm','Gm','Cm','Fm','Bbm','Ebm','Abm'];
    const arr = mode === 'minor' ? min : maj;
    return arr[((fifths % 15) + 15) % 15] || 'C';
  }

  // ── Editor ────────────────────────────────

  async function openEditor(id) {
    const p = await DB.getPiece(id);
    if (!p) return;
    _editId = id;
    document.getElementById('pf-title').value      = p.title;
    document.getElementById('pf-composer').value   = p.composer || '';
    document.getElementById('pf-difficulty').value = p.difficulty;
    document.getElementById('pf-tags').value        = (p.tags||[]).join(', ');
    _openModal('modal-piece');
  }

  async function saveEditor() {
    const p = await DB.getPiece(_editId);
    if (!p) return;
    p.title      = document.getElementById('pf-title').value.trim() || p.title;
    p.composer   = document.getElementById('pf-composer').value.trim();
    p.difficulty = parseInt(document.getElementById('pf-difficulty').value);
    p.tags       = document.getElementById('pf-tags').value.split(',').map(t=>t.trim()).filter(Boolean);
    await DB.savePiece(p);
    _closeModal('modal-piece');
    await refreshLibrary();
    toast('Saved');
  }

  async function deleteEditor() {
    const p = await DB.getPiece(_editId);
    if (!p || !confirm(`Delete "${p.title}"?`)) return;
    await DB.deletePiece(_editId);
    _closeModal('modal-piece');
    await refreshLibrary();
    toast('Deleted');
  }

  // ── Seed data ─────────────────────────────

  async function _seedPieces() {
    if (typeof SEED_PIECES === 'undefined') return;
    for (const sp of SEED_PIECES) {
      let score;
      try { score = Parser.parse(sp.xml); } catch { continue; }
      await DB.savePiece({
        id: sp.id, title: sp.title, composer: sp.composer,
        arranger: null, difficulty: sp.difficulty, tempo: sp.tempo,
        timeSignature: sp.timeSignature, keySignature: sp.keySignature,
        tags: sp.tags, language: null,
        createdAt: Date.now(), updatedAt: Date.now(),
        scores: [{ id: DB.uuid(), label: 'Full score', format: 'musicxml', content: sp.xml, hands: 'both' }],
        setlistIds: [],
      });
    }
  }

  // ── Helpers ───────────────────────────────

  function toast(msg, isErr) {
    const el = document.createElement('div');
    el.className = 'toast' + (isErr ? ' err' : '');
    el.textContent = msg;
    document.getElementById('toast-wrap').appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  function _openModal(id)  { document.getElementById(id)?.classList.remove('hidden'); }
  function _closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }

  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function _relDate(ts) {
    const d = Math.floor((Date.now() - ts) / 86400000);
    if (d === 0) return 'today';
    if (d === 1) return 'yesterday';
    if (d < 7)  return `${d}d ago`;
    return new Date(ts).toLocaleDateString();
  }

  // ── Events ────────────────────────────────

  function _bindEvents() {
    // Theme
    document.getElementById('btn-theme').addEventListener('click', async () => {
      const dark = document.body.classList.contains('theme-dark');
      document.body.className = dark ? 'theme-light' : 'theme-dark';
      await DB.setSetting('theme', dark ? 'light' : 'dark');
    });

    // Import open
    ['btn-import-open','btn-import-empty'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', () => _openModal('modal-import'));
    });
    document.getElementById('btn-import-close').addEventListener('click', () => { _closeModal('modal-import'); _resetImport(); });
    document.getElementById('btn-browse').addEventListener('click', () => document.getElementById('file-input').click());
    document.getElementById('file-input').addEventListener('change', e => { if (e.target.files[0]) handleImport(e.target.files[0]); });

    const dz = document.getElementById('drop-zone');
    dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', ()  => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag-over'); if (e.dataTransfer.files[0]) handleImport(e.dataTransfer.files[0]); });

    // Close modals on overlay click
    document.querySelectorAll('.modal-overlay').forEach(o => {
      o.addEventListener('click', e => { if (e.target === o) o.classList.add('hidden'); });
    });

    // Back
    document.getElementById('btn-back').addEventListener('click', leavePractice);

    // Play/stop
    document.getElementById('btn-play').addEventListener('click', _handlePlay);
    document.getElementById('btn-stop').addEventListener('click', _handleStop);

    // Loop
    document.getElementById('btn-loop').addEventListener('click', _toggleLoop);
    document.getElementById('btn-loop-clear').addEventListener('click', () => { _clearLoop(); toast('Loop cleared'); });

    // Hand
    document.querySelectorAll('.hand-btns .btn-tag').forEach(btn => {
      btn.addEventListener('click', () => _setHand(btn.dataset.hand));
    });

    // Side panel hand buttons (mirror transport)
    document.querySelectorAll('.hand-btns-panel .btn-tag').forEach(btn => {
      btn.addEventListener('click', () => _setHand(btn.dataset.hand));
    });

    // Tempo slider panel (mirror)
    const tSliderPanel = document.getElementById('tempo-slider-panel');
    const tValPanel    = document.getElementById('tempo-val-panel');
    tSliderPanel?.addEventListener('input', e => {
      const v = parseInt(e.target.value);
      tValPanel.textContent = v + '%';
      document.getElementById('tempo-slider').value = v;
      document.getElementById('tempo-val').textContent = v + '%';
      Player.setTempo(v);
      Practice.updateSessionTempo(v);
    });
    document.getElementById('tempo-slider').addEventListener('input', e => {
      const v = parseInt(e.target.value);
      document.getElementById('tempo-val').textContent = v + '%';
      if (tSliderPanel) { tSliderPanel.value = v; tValPanel.textContent = v + '%'; }
      Player.setTempo(v);
      Practice.updateSessionTempo(v);
    });

    // Count-in (panel)
    let _countIn = false;
    document.getElementById('opt-countin').addEventListener('click', () => {
      _countIn = !_countIn;
      document.getElementById('opt-countin-label').textContent = `Count-in: ${_countIn ? 'On' : 'Off'}`;
      document.getElementById('opt-countin').classList.toggle('active', _countIn);
    });

    // Listen (panel)
    document.getElementById('opt-listen').addEventListener('click', async () => {
      const btn  = document.getElementById('opt-listen');
      const lbl  = document.getElementById('opt-listen-label');
      const isOn = btn.classList.contains('active');
      if (!isOn) {
        const ok = await Pitch.start();
        if (!ok) { toast('Mic denied', true); return; }
        btn.classList.add('active'); lbl.textContent = 'Listen mode: On';
        toast('Listen mode on');
      } else {
        Pitch.stop(); btn.classList.remove('active'); lbl.textContent = 'Listen mode: Off';
      }
    });

    // Side panel open/close
    const sidePanel  = document.getElementById('side-panel');
    const sideOverlay = document.getElementById('side-panel-overlay');
    const openPanel  = () => {
      sidePanel.classList.remove('hidden');
      sidePanel.classList.add('open');
      sideOverlay.classList.remove('hidden');
      document.getElementById('btn-options').setAttribute('aria-expanded', 'true');
    };
    const closePanel = () => {
      sidePanel.classList.remove('open');
      sideOverlay.classList.add('hidden');
      document.getElementById('btn-options').setAttribute('aria-expanded', 'false');
      setTimeout(() => sidePanel.classList.add('hidden'), 300);
    };
    document.getElementById('btn-options').addEventListener('click', openPanel);
    document.getElementById('btn-panel-close').addEventListener('click', closePanel);
    sideOverlay.addEventListener('click', closePanel);

    // Zoom (panel)
    document.getElementById('opt-zoom-in').addEventListener('click', () => {
      _zoom = Math.min(2.0, _zoom + 0.15);
      if (_curScore) Score.setZoom(_zoom);
    });
    document.getElementById('opt-zoom-out').addEventListener('click', () => {
      _zoom = Math.max(0.4, _zoom - 0.15);
      if (_curScore) Score.setZoom(_zoom);
    });

    // Export (panel)
    document.getElementById('opt-export').addEventListener('click', () => {
      if (!_curPiece) return;
      const s = _curPiece.scores?.find(s => s.format === 'musicxml');
      if (!s) return;
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(new Blob([s.content], { type: 'application/xml' })),
        download: _curPiece.title + '.xml',
      });
      a.click();
    });

    // Fullscreen
    const fsBtn = document.getElementById('btn-fullscreen');
    fsBtn?.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
        document.body.classList.add('is-fullscreen');
      } else {
        document.exitFullscreen?.().catch(() => {});
        document.body.classList.remove('is-fullscreen');
      }
    });
    document.addEventListener('fullscreenchange', () => {
      const inFS = !!document.fullscreenElement;
      document.body.classList.toggle('is-fullscreen', inFS);
    });

    // Piece editor
    document.getElementById('btn-piece-close').addEventListener('click',  () => _closeModal('modal-piece'));
    document.getElementById('btn-piece-cancel').addEventListener('click', () => _closeModal('modal-piece'));
    document.getElementById('btn-piece-save').addEventListener('click',   saveEditor);
    document.getElementById('btn-piece-delete').addEventListener('click', deleteEditor);

    // Library filters
    document.getElementById('lib-search').addEventListener('input', e => {
      _searchQuery = e.target.value.trim(); renderLibrary();
    });
    document.getElementById('filter-chips').addEventListener('click', e => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      _filterDiff = chip.dataset.filter;
      renderLibrary();
    });

    // Update banner
    document.getElementById('btn-update-reload')?.addEventListener('click', () => location.reload());

    // Resize: re-render score
    window.addEventListener('resize', () => {
      if (_curScore) Score.render(_curScore, _hand);
    });
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
