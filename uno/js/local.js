/* Partie auf diesem Geraet: allein gegen Bots oder reihum auf einem Handy.
 *
 * Der Treiber haelt den Spielstand, laesst die Bots ziehen und meldet der
 * Oberflaeche nach jeder Aenderung, was der aktuelle Platz sehen darf.
 */

import { createGame, applyAction, viewFor } from './engine.js';
import { botAction, botCatch } from './bot.js';

const BOT_DELAY = 850;
const BOT_CATCH_DELAY = 1400;

export class LocalDriver {
  constructor({ players, options, mode }) {
    this.mode = mode;                    // 'solo' | 'pass'
    this.state = createGame({ players, options });
    this.listener = null;
    this.timers = [];
    this.shownSeat = null;               // wem das Geraet zuletzt gehoerte
    this.handoffPending = false;
    this.stopped = false;
  }

  onUpdate(cb) { this.listener = cb; }

  start() {
    this.prepareSeat(true);
    this.emit();
    this.schedule();
  }

  stop() {
    this.stopped = true;
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  /* Wer ist jetzt gefragt? Beim Anzweifeln nicht die Person am Zug. */
  actorIndex() {
    const s = this.state;
    if (s.phase === 'challenge' && s.pendingWild4) return s.pendingWild4.target;
    if (s.phase === 'round-over' || s.phase === 'game-over') return null;
    return s.current;
  }

  /* Der Platz, dessen Karten gezeigt werden. */
  seatIndex() {
    if (this.mode === 'solo') {
      const human = this.state.players.findIndex((p) => !p.isBot);
      return human === -1 ? 0 : human;
    }
    const actor = this.actorIndex();
    if (actor === null) return this.shownSeat ?? 0;
    return this.state.players[actor].isBot ? null : actor;
  }

  /* Beim Weiterreichen: erst bestaetigen, dann die Hand zeigen. */
  prepareSeat(initial = false) {
    if (this.mode !== 'pass') { this.handoffPending = false; return; }
    const seat = this.seatIndex();
    if (seat === null) { this.handoffPending = false; return; }
    if (initial || seat !== this.shownSeat) {
      this.handoffPending = true;
    }
  }

  confirmHandoff() {
    this.handoffPending = false;
    this.shownSeat = this.seatIndex();
    this.emit();
  }

  emit() {
    if (!this.listener || this.stopped) return;
    const seat = this.seatIndex();
    const hidden = this.handoffPending;
    this.listener({
      mode: this.mode,
      seat,
      actor: this.actorIndex(),
      handoff: hidden ? { name: seat === null ? '' : this.state.players[seat].name } : null,
      // Waehrend des Weiterreichens sieht das Geraet keine einzige Handkarte.
      view: viewFor(this.state, hidden || seat === null ? -1 : seat),
      state: this.state,
    });
  }

  /* Ein Zug der Person, der das Geraet gerade gehoert. */
  send(action) {
    const seat = this.handoffPending ? null : this.seatIndex();
    const from = action.type === 'catch' && seat === null ? null : seat;
    if (from === null) return { ok: false, error: 'Gerade bist du nicht dran.' };
    const res = applyAction(this.state, from, action);
    if (res.ok) {
      if (this.mode === 'pass') this.shownSeat = from;
      this.prepareSeat();
      this.emit();
      this.schedule();
    }
    return res;
  }

  nextRound() {
    const res = applyAction(this.state, 0, { type: 'next-round' });
    if (res.ok) {
      this.shownSeat = null;
      this.prepareSeat(true);
      this.emit();
      this.schedule();
    }
    return res;
  }

  /* Bots ziehen zeitversetzt, damit man ihnen folgen kann. */
  schedule() {
    if (this.stopped) return;
    const s = this.state;

    if (s.unoVulnerable !== null) {
      this.after(BOT_CATCH_DELAY, () => {
        if (s.unoVulnerable === null) return;
        for (let i = 0; i < s.players.length; i++) {
          if (!s.players[i].isBot) continue;
          const c = botCatch(s, i);
          if (c) { applyAction(s, i, c); this.emit(); break; }
        }
      });
    }

    const actor = this.actorIndex();
    if (actor === null || !s.players[actor].isBot) return;

    this.after(BOT_DELAY, () => {
      const idx = this.actorIndex();
      if (idx === null || !this.state.players[idx].isBot) return;
      const action = botAction(this.state, idx);
      if (!action) return;
      const res = applyAction(this.state, idx, action);
      if (!res.ok) {
        // Sollte nicht vorkommen; lieber ziehen als haengen bleiben.
        applyAction(this.state, idx, { type: 'draw' });
      }
      this.prepareSeat();
      this.emit();
      this.schedule();
    });
  }

  after(ms, fn) {
    const id = setTimeout(() => {
      this.timers = this.timers.filter((t) => t !== id);
      if (!this.stopped) fn();
    }, ms);
    this.timers.push(id);
  }
}
