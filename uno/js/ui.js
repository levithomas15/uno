/* Der Spieltisch: alles, was auf dem Bildschirm passiert.
 *
 * Die Oberflaeche kennt die Spielregeln nicht. Sie bekommt eine Sicht
 * (viewFor) und schickt Zuege an den Treiber – lokal wie online gleich.
 */

import { cardSvg, cardBackSvg } from './cards.js';
import { COLOR_NAMES } from './engine.js';

const $ = (id) => document.getElementById(id);

export function openOverlay(id) { $(id).classList.add('is-open'); }
export function closeOverlay(id) { $(id).classList.remove('is-open'); }

let toastTimer = null;
export function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* Wer ist gerade gefragt – am Zug oder beim Anzweifeln? */
export function actorOf(view) {
  if (view.phase === 'challenge' && view.pendingWild4) return view.pendingWild4.target;
  if (view.phase === 'round-over' || view.phase === 'game-over') return null;
  return view.current;
}

export class TableUI {
  constructor(handlers) {
    this.handlers = handlers;          // { send, quit }
    this.payload = null;
    this.pendingWildCard = null;       // Karte, fuer die eine Farbe fehlt
    this.bind();
  }

  bind() {
    $('draw-pile').addEventListener('click', () => this.handlers.send({ type: 'draw' }));
    $('game-quit').addEventListener('click', () => this.handlers.quit());
    $('game-log-btn').addEventListener('click', () => {
      this.renderLog();
      openOverlay('ov-log');
    });

    for (const btn of document.querySelectorAll('#ov-color .swatch')) {
      btn.addEventListener('click', () => {
        const color = btn.dataset.color;
        closeOverlay('ov-color');
        if (this.pendingWildCard) {
          const cardId = this.pendingWildCard;
          this.pendingWildCard = null;
          this.play(cardId, color);
        } else {
          this.handlers.send({ type: 'color', color });
        }
      });
    }

    $('challenge-yes').addEventListener('click', () => {
      closeOverlay('ov-challenge');
      this.handlers.send({ type: 'challenge', challenge: true });
    });
    $('challenge-no').addEventListener('click', () => {
      closeOverlay('ov-challenge');
      this.handlers.send({ type: 'challenge', challenge: false });
    });
  }

  play(cardId, color) {
    const view = this.payload?.view;
    const me = view?.players[view.you];
    const action = { type: 'play', cardId };
    if (color) action.color = color;
    // Mit der vorletzten Karte wird "UNO!" gleich mitgerufen, wenn der
    // Knopf vorher gedrueckt wurde.
    if (this.unoArmed && me && me.count === 2) action.sayUno = true;
    const res = this.handlers.send(action);
    if (res && res.ok === false) toast(res.error);
    this.unoArmed = false;
  }

  render(payload) {
    this.payload = payload;
    const { view } = payload;
    const seat = view.you;
    const actor = actorOf(view);
    const meTurn = seat !== null && seat >= 0 && actor === seat;

    $('game-title').textContent = payload.title
      || (view.options.targetScore ? `Runde ${view.round} · bis ${view.options.targetScore}` : `Runde ${view.round}`);

    this.renderOpponents(view, seat, actor);
    this.renderBoard(view, meTurn);
    this.renderHand(view, seat, meTurn);
    this.renderControls(view, seat, meTurn);

    // Farbe waehlen, wenn die eigene Wunschkarte liegt.
    if (view.phase === 'color' && meTurn) openOverlay('ov-color');
    else if (!this.pendingWildCard) closeOverlay('ov-color');

    if (view.phase === 'challenge' && view.pendingWild4?.target === seat) {
      const by = view.players[view.pendingWild4.by];
      $('challenge-text').textContent =
        `${by.name} legt Zieh Vier und wünscht ${COLOR_NAMES[view.activeColor] || '–'}. Erlaubt ist das nur ohne passende Farbe auf der Hand.`;
      openOverlay('ov-challenge');
    } else {
      closeOverlay('ov-challenge');
    }
  }

  renderOpponents(view, seat, actor) {
    const box = $('opponents');
    box.innerHTML = '';
    const n = view.players.length;
    const base = seat >= 0 ? seat : -1;
    for (let step = 1; step <= n; step++) {
      const i = (base + step * (view.direction || 1) + n * n) % n;
      if (i === seat) continue;
      const p = view.players[i];
      const el = document.createElement('div');
      el.className = 'opp' + (i === actor ? ' is-current' : '') + (p.connected === false ? ' is-out' : '');
      const mini = Array.from({ length: Math.min(p.count, 9) }, () => '<i></i>').join('');
      el.innerHTML = `
        <div class="who">${escapeHtml(p.name)}${p.isBot ? ' 🤖' : ''}</div>
        <div class="mini">${mini}</div>
        <div class="cards">${p.count} Karten${view.options.targetScore ? ` · ${p.score} P` : ''}</div>
        ${p.count === 1 && p.saidUno ? '<span class="uno">UNO</span>' : ''}`;
      if (view.unoVulnerable === i && seat >= 0 && seat !== i) {
        const btn = document.createElement('button');
        btn.className = 'catch';
        btn.textContent = 'Erwischt!';
        btn.addEventListener('click', () => {
          const res = this.handlers.send({ type: 'catch', target: i });
          if (res && res.ok === false) toast(res.error);
        });
        el.appendChild(btn);
      }
      box.appendChild(el);
    }
  }

  renderBoard(view, meTurn) {
    $('discard-pile').innerHTML = view.top ? cardSvg(view.top) : '';
    $('draw-pile').innerHTML = cardBackSvg();
    $('draw-pile').disabled = !(meTurn && view.phase === 'play');
    $('draw-note').textContent = `${view.drawPileCount} im Stapel`;
    $('discard-note').textContent = view.activeColor ? COLOR_NAMES[view.activeColor] : 'Farbe offen';

    for (const dot of document.querySelectorAll('#colorring i')) {
      dot.classList.toggle('on', dot.classList.contains(view.activeColor || ''));
    }

    const note = $('turn-note');
    const actor = actorOf(view);
    let text;
    if (view.phase === 'round-over') text = 'Runde vorbei.';
    else if (view.phase === 'game-over') text = 'Partie vorbei.';
    else if (actor === null) text = '';
    else if (meTurn && view.phase === 'drawn') text = 'Gezogene Karte legen – oder passen.';
    else if (meTurn && view.phase === 'color') text = 'Wünsch dir eine Farbe.';
    else if (meTurn && view.phase === 'challenge') text = 'Anzweifeln?';
    else if (meTurn) text = 'Du bist dran.';
    else text = `${view.players[actor].name} ist dran …`;
    note.textContent = text;
    note.classList.toggle('you', meTurn);
  }

  renderHand(view, seat, meTurn) {
    const box = $('hand');
    box.innerHTML = '';
    const me = seat >= 0 ? view.players[seat] : null;
    if (!me || !me.hand) {
      box.innerHTML = '<p class="hand-empty">Die Karten sind verdeckt.</p>';
      return;
    }
    const playableIds = new Set(this.playableIds(view, me.hand, meTurn));
    for (const card of me.hand) {
      const btn = document.createElement('button');
      const can = playableIds.has(card.id);
      btn.className = 'card' + (can ? ' playable' : meTurn ? ' blocked' : '');
      btn.innerHTML = cardSvg(card);
      btn.setAttribute('aria-label', cardAria(card));
      btn.addEventListener('click', () => {
        if (!meTurn) { toast('Du bist nicht dran.'); return; }
        if (!can) { toast('Diese Karte passt nicht.'); return; }
        if (card.color === 'wild') {
          this.pendingWildCard = card.id;
          openOverlay('ov-color');
          return;
        }
        this.play(card.id, null);
      });
      box.appendChild(btn);
    }
  }

  /* Spielbarkeit fuer die Anzeige – die endgueltige Pruefung macht das
   * Regelwerk beim Zug. */
  playableIds(view, hand, meTurn) {
    if (!meTurn || (view.phase !== 'play' && view.phase !== 'drawn')) return [];
    const top = view.top;
    return hand.filter((card) => {
      if (view.phase === 'drawn' && card.id !== view.drawnCardId) return false;
      if (card.color === 'wild') return true;
      if (card.color === view.activeColor) return true;
      return top && top.color !== 'wild' && card.kind === top.kind;
    }).map((c) => c.id);
  }

  renderControls(view, seat, meTurn) {
    const box = $('controls');
    box.innerHTML = '';
    const me = seat >= 0 ? view.players[seat] : null;

    if (meTurn && view.phase === 'play') {
      box.appendChild(this.button('Karte ziehen', 'ghost', () => this.handlers.send({ type: 'draw' })));
    }
    if (meTurn && view.phase === 'drawn') {
      box.appendChild(this.button('Passen', 'ghost', () => this.handlers.send({ type: 'pass' })));
    }
    if (me && me.count <= 2 && me.count > 0) {
      const armed = this.unoArmed && me.count === 2;
      const btn = this.button(armed ? 'UNO! ✓' : 'UNO!', 'uno-btn', () => {
        if (me.count === 2 && meTurn) {
          // Vor dem Legen der vorletzten Karte gerufen.
          this.unoArmed = true;
          this.handlers.send({ type: 'uno' });
          toast('UNO ist angesagt.');
        } else {
          const res = this.handlers.send({ type: 'uno' });
          if (res && res.ok === false) toast(res.error);
          else toast('UNO!');
        }
        this.render(this.payload);
      });
      box.appendChild(btn);
    }
  }

  button(text, cls, onClick) {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  renderLog() {
    const body = $('log-body');
    body.innerHTML = (this.payload?.view.log || [])
      .slice()
      .reverse()
      .map((entry) => `<p>${escapeHtml(entry.text)}</p>`)
      .join('');
  }
}

function cardAria(card) {
  const kinds = { skip: 'Aussetzen', reverse: 'Retour', draw2: 'Zieh Zwei', wild: 'Farbwunsch', wild4: 'Zieh Vier' };
  const kind = kinds[card.kind] || card.kind;
  return card.color === 'wild' ? kind : `${COLOR_NAMES[card.color]} ${kind}`;
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
