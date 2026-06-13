/* ─────────────────────────────────────────
   practice.js — Session logging + SR hints
   ───────────────────────────────────────── */
'use strict';

const Practice = (() => {

  // Spaced repetition: flag if not practiced in N days
  const DUE_AFTER_DAYS = 3;

  let _activeSession = null;
  let _sessionStart  = null;

  // ── Session tracking ──────────────────────

  function startSession(pieceId, tempoPercent) {
    _sessionStart  = Date.now();
    _activeSession = {
      id:         DB.uuid(),
      pieceId,
      date:       _sessionStart,
      durationMs: 0,
      tempoUsed:  tempoPercent,
      loopStart:  null,
      loopEnd:    null,
      notes:      null,
    };
  }

  function updateSessionTempo(percent) {
    if (_activeSession) _activeSession.tempoUsed = percent;
  }

  function updateSessionLoop(start, end) {
    if (_activeSession) {
      _activeSession.loopStart = start;
      _activeSession.loopEnd   = end;
    }
  }

  async function endSession() {
    if (!_activeSession || !_sessionStart) return null;
    _activeSession.durationMs = Date.now() - _sessionStart;
    // Only save sessions longer than 10 seconds
    if (_activeSession.durationMs > 10_000) {
      await DB.saveSession(_activeSession);
    }
    const s    = _activeSession;
    _activeSession = null;
    _sessionStart  = null;
    return s;
  }

  function isSessionActive() {
    return !!_activeSession;
  }

  // ── Spaced repetition ─────────────────────

  async function isDue(pieceId) {
    const last = await DB.getLastSessionDate(pieceId);
    if (!last) return true; // never practiced
    const daysSince = (Date.now() - last) / (1000 * 60 * 60 * 24);
    return daysSince >= DUE_AFTER_DAYS;
  }

  async function getDuePieces(pieceIds) {
    const results = await Promise.all(pieceIds.map(async id => ({ id, due: await isDue(id) })));
    return results.filter(r => r.due).map(r => r.id);
  }

  // ── Stats ─────────────────────────────────

  async function getPieceStats(pieceId) {
    const sessions = await DB.getSessionsForPiece(pieceId);
    if (!sessions.length) return null;

    const totalMs    = sessions.reduce((n, s) => n + s.durationMs, 0);
    const lastDate   = Math.max(...sessions.map(s => s.date));
    const avgTempo   = Math.round(sessions.reduce((n, s) => n + s.tempoUsed, 0) / sessions.length);
    const maxTempo   = Math.max(...sessions.map(s => s.tempoUsed));

    return {
      sessionCount: sessions.length,
      totalMinutes: Math.round(totalMs / 60_000),
      lastDate,
      avgTempo,
      maxTempo,
    };
  }

  return {
    startSession, updateSessionTempo, updateSessionLoop, endSession, isSessionActive,
    isDue, getDuePieces, getPieceStats,
  };
})();

window.Practice = Practice;
