/* Computergegner.
 *
 * Drei Stufen: "easy" spielt fast zufaellig, "normal" achtet auf Farben und
 * hebt sich Wuenschkarten auf, "hard" zaehlt zusaetzlich mit, wer wenige
 * Karten haelt, und zweifelt eine Zieh-Vier an, wenn sie verdaechtig ist.
 */

import {
  COLORS, isWild, isNumber, playableCards, hasActiveColor, nextIndex, cardPoints,
} from './engine.js';

function pick(arr, rnd = Math.random) {
  return arr[Math.floor(rnd() * arr.length)];
}

function colorCounts(hand) {
  const counts = { red: 0, yellow: 0, green: 0, blue: 0 };
  for (const c of hand) if (!isWild(c)) counts[c.color] += 1;
  return counts;
}

/* Die Farbe, in der die Hand am staerksten ist. */
export function bestColor(hand) {
  const counts = colorCounts(hand);
  let best = COLORS[0];
  for (const color of COLORS) if (counts[color] > counts[best]) best = color;
  if (counts[best] === 0) return pick(COLORS);
  return best;
}

/* Naechste Person im Spielverlauf – auf die zielen Aktionskarten. */
function threatLevel(state) {
  const next = state.players[nextIndex(state)];
  return next ? next.hand.length : 7;
}

function scoreCard(state, me, card) {
  const hand = me.hand;
  const counts = colorCounts(hand);
  const nextCount = threatLevel(state);
  let score = 0;

  if (card.kind === 'wild4') score -= 40;          // teuer, nur als letzter Ausweg
  else if (card.kind === 'wild') score -= 18;
  else {
    score += counts[card.color] * 2;               // in der starken Farbe bleiben
    if (isNumber(card)) score += 4;
    else score += 10;                              // Aktionskarten frueh loswerden
  }

  // Gegen jemanden mit wenigen Karten helfen Aussetzen und Ziehen sofort.
  if (nextCount <= 2 && ['skip', 'reverse', 'draw2', 'wild4'].includes(card.kind)) score += 26;
  if (hand.length <= 2) score += cardPoints(card) / 4; // hohe Karten zuerst abwerfen
  return score;
}

/* Der Zug des Bots, als Aktion fuer applyAction. */
export function botAction(state, playerIdx, rnd = Math.random) {
  const me = state.players[playerIdx];
  const level = me.botLevel || 'normal';

  if (state.phase === 'challenge') {
    const pending = state.pendingWild4;
    if (pending && pending.target === playerIdx) {
      let challenge = false;
      if (level === 'hard') {
        // Verdaechtig, wenn kurz zuvor noch in der aktiven Farbe gelegt wurde.
        const offender = state.players[pending.by];
        challenge = offender.hand.length >= 4 && rnd() < 0.35;
      } else if (level === 'normal') {
        challenge = rnd() < 0.12;
      }
      return { type: 'challenge', challenge };
    }
  }

  if (state.phase === 'color') {
    return { type: 'color', color: level === 'easy' ? pick(COLORS, rnd) : bestColor(me.hand) };
  }

  if (state.phase === 'play' || state.phase === 'drawn') {
    const options = playableCards(state, playerIdx);
    if (options.length === 0) {
      return state.phase === 'drawn' ? { type: 'pass' } : { type: 'draw' };
    }

    let card;
    if (level === 'easy') {
      card = pick(options, rnd);
    } else {
      // Zieh-Vier nur, wenn es nichts anderes gibt (und dann regelkonform).
      const cheap = options.filter((c) => c.kind !== 'wild4');
      const pool = cheap.length && hasActiveColor(state, playerIdx) ? cheap : options;
      card = pool.reduce((a, b) => (scoreCard(state, me, b) > scoreCard(state, me, a) ? b : a));
    }

    const action = { type: 'play', cardId: card.id };
    if (isWild(card)) {
      action.color = level === 'easy' ? pick(COLORS, rnd) : bestColor(me.hand.filter((c) => c.id !== card.id));
    }
    // Wer gleich nur noch eine Karte hat, ruft UNO – auf "easy" gern zu spaet.
    if (me.hand.length === 2) action.sayUno = level === 'easy' ? rnd() < 0.5 : true;
    return action;
  }

  return null;
}

/* Erwischt der Bot jemanden, der "UNO!" vergessen hat? */
export function botCatch(state, playerIdx, rnd = Math.random) {
  const target = state.unoVulnerable;
  if (target === null || target === playerIdx) return null;
  const level = state.players[playerIdx].botLevel || 'normal';
  const chance = { easy: 0.25, normal: 0.6, hard: 0.95 }[level] ?? 0.6;
  if (rnd() > chance) return null;
  return { type: 'catch', target };
}
