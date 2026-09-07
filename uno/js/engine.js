/* UNO – Regelwerk.
 *
 * Reines JavaScript-Modul ohne DOM- oder Node-Abhaengigkeiten: es laeuft
 * unveraendert im Browser (Solo, Pass & Play) und auf dem Server (Online).
 * Der gesamte Spielstand steckt in einem einfachen Objekt und laesst sich
 * per JSON verschicken oder speichern.
 */

export const COLORS = ['red', 'yellow', 'green', 'blue'];

export const COLOR_NAMES = {
  red: 'Rot',
  yellow: 'Gelb',
  green: 'Grün',
  blue: 'Blau',
};

/* ------------------------------------------------------------------ Zufall */

/* Deterministischer PRNG, damit sich eine Partie aus ihrem Seed exakt
 * nachspielen laesst (Tests, Fehlersuche, Wiederholung einer Runde). */
export function makeRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

function shuffle(cards, rng) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

/* -------------------------------------------------------------------- Deck */

/* Das Original-Deck: 108 Karten.
 * Je Farbe eine 0, je zwei 1-9, zwei Aussetzen, zwei Retour, zwei Zieh-Zwei
 * (= 25 Karten pro Farbe), dazu vier Farbwuensche und vier Zieh-Vier. */
export function createDeck() {
  const cards = [];
  let n = 0;
  const add = (color, kind) => cards.push({ id: `c${n++}`, color, kind });

  for (const color of COLORS) {
    add(color, '0');
    for (let v = 1; v <= 9; v++) {
      add(color, String(v));
      add(color, String(v));
    }
    for (const kind of ['skip', 'reverse', 'draw2']) {
      add(color, kind);
      add(color, kind);
    }
  }
  for (let i = 0; i < 4; i++) add('wild', 'wild');
  for (let i = 0; i < 4; i++) add('wild', 'wild4');

  return cards;
}

export function isWild(card) {
  return card.color === 'wild';
}

export function isNumber(card) {
  return card.kind.length === 1 && card.kind >= '0' && card.kind <= '9';
}

/* Punktwerte der Originalregeln: Zahlen zaehlen ihren Wert,
 * Aktionskarten 20, Farbwunsch und Zieh-Vier 50. */
export function cardPoints(card) {
  if (isNumber(card)) return Number(card.kind);
  if (card.kind === 'wild' || card.kind === 'wild4') return 50;
  return 20;
}

export function handPoints(hand) {
  return hand.reduce((sum, card) => sum + cardPoints(card), 0);
}

export function cardLabel(card) {
  const kinds = {
    skip: 'Aussetzen',
    reverse: 'Retour',
    draw2: 'Zieh Zwei',
    wild: 'Farbwunsch',
    wild4: 'Zieh Vier',
  };
  const name = kinds[card.kind] || card.kind;
  return isWild(card) ? name : `${COLOR_NAMES[card.color]} ${name}`;
}

/* ------------------------------------------------------------------ Optionen */

export const DEFAULT_OPTIONS = {
  targetScore: 500,   // 0 = nur eine Runde
  stacking: false,    // Zieh-Karten weiterreichen (Hausregel, offiziell aus)
  drawUntilPlayable: false, // ziehen bis spielbar (Hausregel)
  jumpIn: false,      // reserviert, aktuell nicht aktiv
  challenge: true,    // Zieh-Vier anzweifeln erlaubt
  unoPenalty: 2,      // Strafkarten fuers vergessene "UNO!"
};

/* --------------------------------------------------------------- Spielstart */

export function createGame({ players, options = {}, seed = randomSeed() }) {
  if (!players || players.length < 2 || players.length > 10) {
    throw new Error('UNO wird zu 2 bis 10 Personen gespielt.');
  }
  const state = {
    seed,
    rngState: seed,
    options: { ...DEFAULT_OPTIONS, ...options },
    players: players.map((p, i) => ({
      id: p.id ?? `p${i}`,
      name: p.name ?? `Spieler ${i + 1}`,
      isBot: !!p.isBot,
      botLevel: p.botLevel ?? 'normal',
      hand: [],
      score: 0,
      saidUno: false,
      connected: p.connected !== false,
    })),
    round: 0,
    dealer: 0,
    drawPile: [],
    discard: [],
    activeColor: null,
    current: 0,
    direction: 1,
    pendingDraw: 0,      // aufgelaufene Zieh-Karten (nur bei Stapel-Hausregel)
    drawnCard: null,     // gerade gezogene Karte, darf sofort gelegt werden
    phase: 'play',       // play | color | drawn | challenge | round-over | game-over
    unoVulnerable: null, // Index, wer beim "UNO!" erwischt werden kann
    pendingWild4: null,  // { by, target, legal }
    winner: null,
    lastRound: null,
    log: [],
  };
  startRound(state);
  return state;
}

function rngNext(state) {
  const rng = makeRng(state.rngState);
  const value = rng();
  state.rngState = Math.floor(value * 0xffffffff) >>> 0;
  return value;
}

function shuffleState(state, cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rngNext(state) * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export function log(state, text) {
  state.log.push({ n: state.log.length, text });
  if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
}

export function startRound(state) {
  state.round += 1;
  state.drawPile = shuffleState(state, createDeck());
  state.discard = [];
  state.pendingDraw = 0;
  state.drawnCard = null;
  state.pendingWild4 = null;
  state.unoVulnerable = null;
  state.direction = 1;
  state.winner = null;
  state.phase = 'play';

  for (const p of state.players) {
    p.hand = [];
    p.saidUno = false;
  }
  for (let round = 0; round < 7; round++) {
    for (const p of state.players) p.hand.push(state.drawPile.pop());
  }

  if (state.round > 1) state.dealer = (state.dealer + 1) % state.players.length;
  state.current = (state.dealer + 1) % state.players.length;

  // Startkarte aufdecken. Eine Zieh-Vier wandert zurueck ins Deck.
  let start = state.drawPile.pop();
  while (start.kind === 'wild4') {
    state.drawPile.splice(Math.floor(rngNext(state) * state.drawPile.length), 0, start);
    start = state.drawPile.pop();
  }
  state.discard.push(start);
  state.activeColor = isWild(start) ? null : start.color;
  log(state, `Runde ${state.round} – Startkarte: ${cardLabel(start)}.`);

  applyStartCard(state, start);
  return state;
}

/* Wirkung der aufgedeckten Startkarte, nach den Originalregeln. */
function applyStartCard(state, card) {
  const two = state.players.length === 2;
  switch (card.kind) {
    case 'skip':
      log(state, `${currentPlayer(state).name} setzt aus.`);
      advance(state);
      break;
    case 'reverse':
      if (two) {
        // Zu zweit wirkt Retour wie Aussetzen: der Geber beginnt.
        state.current = state.dealer;
        log(state, 'Retour: der Geber beginnt.');
      } else {
        state.direction = -1;
        state.current = (state.dealer - 1 + state.players.length) % state.players.length;
        log(state, 'Retour: die Richtung dreht sich, rechts vom Geber beginnt.');
      }
      break;
    case 'draw2': {
      const victim = currentPlayer(state);
      drawCards(state, state.current, 2);
      log(state, `${victim.name} zieht 2 und setzt aus.`);
      advance(state);
      break;
    }
    case 'wild':
      // Wer beginnt, waehlt die Farbe.
      state.phase = 'color';
      log(state, `${currentPlayer(state).name} waehlt die Startfarbe.`);
      break;
    default:
      break;
  }
}

/* ------------------------------------------------------------------ Helfer */

export function currentPlayer(state) {
  return state.players[state.current];
}

export function topCard(state) {
  return state.discard[state.discard.length - 1];
}

export function nextIndex(state, from = state.current, steps = 1) {
  const n = state.players.length;
  return (((from + state.direction * steps) % n) + n) % n;
}

function advance(state, steps = 1) {
  state.current = nextIndex(state, state.current, steps);
}

/* Passt die Karte auf den Ablagestapel? */
export function isPlayable(state, card) {
  if (state.phase === 'drawn' && state.drawnCard && card.id !== state.drawnCard.id) return false;
  const top = topCard(state);

  // Bei aktiver Stapel-Hausregel darf nur eine gleichwertige Zieh-Karte folgen.
  if (state.pendingDraw > 0) {
    if (top.kind === 'draw2') return card.kind === 'draw2' || card.kind === 'wild4';
    if (top.kind === 'wild4') return card.kind === 'wild4';
  }

  if (card.kind === 'wild') return true;
  if (card.kind === 'wild4') return state.options.challenge ? true : !hasActiveColor(state, state.current);
  if (card.color === state.activeColor) return true;
  return !isWild(top) && card.kind === top.kind;
}

/* Haelt die Person eine Karte in der aktiven Farbe? Entscheidet darueber,
 * ob eine Zieh-Vier regelkonform war. */
export function hasActiveColor(state, playerIdx) {
  return state.players[playerIdx].hand.some((c) => c.color === state.activeColor);
}

export function playableCards(state, playerIdx) {
  if (playerIdx !== state.current) return [];
  if (state.phase !== 'play' && state.phase !== 'drawn') return [];
  return state.players[playerIdx].hand.filter((c) => isPlayable(state, c));
}

function refillDrawPile(state) {
  if (state.drawPile.length > 0) return true;
  if (state.discard.length <= 1) return false;
  const top = state.discard.pop();
  const rest = state.discard.splice(0, state.discard.length);
  for (const card of rest) {
    // Gewuenschte Farben werden beim Zurueckmischen wieder neutral.
    if (card.kind === 'wild' || card.kind === 'wild4') card.color = 'wild';
  }
  state.drawPile = shuffleState(state, rest);
  state.discard = [top];
  log(state, 'Der Ablagestapel wird neu gemischt.');
  return state.drawPile.length > 0;
}

export function drawCards(state, playerIdx, count) {
  const player = state.players[playerIdx];
  const drawn = [];
  for (let i = 0; i < count; i++) {
    if (!refillDrawPile(state) && state.drawPile.length === 0) break;
    drawn.push(state.drawPile.pop());
  }
  player.hand.push(...drawn);
  if (player.hand.length > 1) player.saidUno = false;
  if (state.unoVulnerable === playerIdx) state.unoVulnerable = null;
  return drawn;
}

/* ----------------------------------------------------------------- Aktionen */

/* Alle Zuege laufen ueber diese eine Funktion. Rueckgabe:
 * { ok: true, events } oder { ok: false, error: 'Text' }. */
export function applyAction(state, playerIdx, action) {
  if (state.phase === 'game-over') return fail('Die Partie ist beendet.');
  const player = state.players[playerIdx];
  if (!player) return fail('Unbekannte Person.');

  // Das Zeitfenster fuers Erwischen endet, sobald die betroffene Person
  // wieder selbst am Zug ist.
  if (state.unoVulnerable === playerIdx && (action.type === 'play' || action.type === 'draw')) {
    state.unoVulnerable = null;
  }

  switch (action.type) {
    case 'uno':      return actUno(state, playerIdx);
    case 'catch':    return actCatch(state, playerIdx, action);
    case 'color':    return actColor(state, playerIdx, action);
    case 'challenge':return actChallenge(state, playerIdx, action);
    case 'play':     return actPlay(state, playerIdx, action);
    case 'draw':     return actDraw(state, playerIdx);
    case 'pass':     return actPass(state, playerIdx);
    case 'next-round': return actNextRound(state, playerIdx);
    default:         return fail('Unbekannter Zug.');
  }
}

function fail(error) {
  return { ok: false, error };
}

function ok(state) {
  return { ok: true };
}

/* "UNO!" rufen – erlaubt, sobald nur noch zwei Karten auf der Hand liegen
 * (also beim Ablegen der vorletzten Karte) und bis zur Ueberfuehrung. */
function actUno(state, playerIdx) {
  const player = state.players[playerIdx];
  if (player.hand.length > 2) return fail('Dafuer hast du noch zu viele Karten.');
  player.saidUno = true;
  if (state.unoVulnerable === playerIdx) state.unoVulnerable = null;
  log(state, `${player.name}: UNO!`);
  return ok(state);
}

/* Jemanden erwischen, der das "UNO!" vergessen hat. */
function actCatch(state, playerIdx, action) {
  const target = action.target;
  if (state.unoVulnerable === null || state.unoVulnerable !== target) {
    return fail('Da gibt es nichts zu erwischen.');
  }
  if (target === playerIdx) return fail('Sich selbst erwischt man nicht.');
  const victim = state.players[target];
  drawCards(state, target, state.options.unoPenalty);
  state.unoVulnerable = null;
  log(state, `${state.players[playerIdx].name} erwischt ${victim.name} – ${state.options.unoPenalty} Strafkarten.`);
  return ok(state);
}

function actColor(state, playerIdx, action) {
  if (state.phase !== 'color') return fail('Gerade ist keine Farbe zu waehlen.');
  if (playerIdx !== state.current) return fail('Du bist nicht dran.');
  if (!COLORS.includes(action.color)) return fail('Diese Farbe gibt es nicht.');

  state.activeColor = action.color;
  log(state, `${state.players[playerIdx].name} waehlt ${COLOR_NAMES[action.color]}.`);

  const top = topCard(state);
  if (top.kind === 'wild' && state.discard.length === 1) {
    // Farbwahl zur Startkarte: die begonnene Person spielt normal weiter.
    state.phase = 'play';
    return ok(state);
  }
  top.color = action.color;
  state.phase = 'play';
  finishTurn(state, top);
  return ok(state);
}

function actChallenge(state, playerIdx, action) {
  if (state.phase !== 'challenge') return fail('Gerade ist nichts anzuzweifeln.');
  const pending = state.pendingWild4;
  if (!pending || pending.target !== playerIdx) return fail('Du bist nicht gefragt.');

  const offender = state.players[pending.by];
  const challenger = state.players[playerIdx];

  if (!action.challenge) {
    drawCards(state, playerIdx, 4);
    log(state, `${challenger.name} akzeptiert und zieht 4.`);
    state.pendingWild4 = null;
    state.phase = 'play';
    state.current = playerIdx; // Wer zieht, setzt aus: weiter hinter ihm.
    advance(state);
    return endTurnChecks(state);
  }

  if (pending.legal === false) {
    drawCards(state, pending.by, 4);
    log(state, `Angezweifelt und erwischt: ${offender.name} zieht 4, ${challenger.name} bleibt dran.`);
    state.pendingWild4 = null;
    state.phase = 'play';
    state.current = playerIdx; // Der Zug bleibt beim Anzweifelnden.
    return endTurnChecks(state);
  }

  drawCards(state, playerIdx, 6);
  log(state, `Zu Unrecht angezweifelt: ${challenger.name} zieht 6 und setzt aus.`);
  state.pendingWild4 = null;
  state.phase = 'play';
  state.current = playerIdx; // Auch hier setzt die anzweifelnde Person aus.
  advance(state);
  return endTurnChecks(state);
}

function actPlay(state, playerIdx, action) {
  if (state.phase !== 'play' && state.phase !== 'drawn') return fail('Gerade bist du nicht am Zug.');
  if (playerIdx !== state.current) return fail('Du bist nicht dran.');

  const player = state.players[playerIdx];
  const idx = player.hand.findIndex((c) => c.id === action.cardId);
  if (idx === -1) return fail('Diese Karte hast du nicht.');
  const card = player.hand[idx];
  if (!isPlayable(state, card)) return fail('Diese Karte passt nicht.');

  const wild4Legal = card.kind === 'wild4' ? !hasActiveColor(state, playerIdx) : null;

  player.hand.splice(idx, 1);
  state.drawnCard = null;
  state.discard.push(card);
  log(state, `${player.name} legt ${cardLabel(card)}.`);

  if (action.sayUno && player.hand.length === 1) {
    player.saidUno = true;
    log(state, `${player.name}: UNO!`);
  }

  if (isWild(card)) {
    state.activeColor = null;
    if (card.kind === 'wild4') state.pendingWild4 = { by: playerIdx, legal: wild4Legal, target: null };
    if (action.color && COLORS.includes(action.color)) {
      state.activeColor = action.color;
      card.color = action.color;
      log(state, `Farbe: ${COLOR_NAMES[action.color]}.`);
      return finishTurn(state, card);
    }
    state.phase = 'color';
    return ok(state);
  }

  state.activeColor = card.color;
  return finishTurn(state, card);
}

/* Wirkung der gelegten Karte, danach ist die naechste Person dran. */
function finishTurn(state, card) {
  const player = currentPlayer(state);
  const two = state.players.length === 2;

  if (player.hand.length === 0) {
    return endRound(state, state.current);
  }

  if (player.hand.length === 1 && !player.saidUno) {
    state.unoVulnerable = state.current;
  } else if (player.hand.length > 1) {
    player.saidUno = false;
  }

  switch (card.kind) {
    case 'skip': {
      const victim = state.players[nextIndex(state)];
      log(state, `${victim.name} setzt aus.`);
      advance(state, 2);
      break;
    }
    case 'reverse':
      if (two) {
        log(state, 'Retour – zu zweit wie Aussetzen.');
        // Richtung bleibt, dieselbe Person ist erneut dran.
      } else {
        state.direction *= -1;
        log(state, 'Die Richtung dreht sich.');
        advance(state);
      }
      break;
    case 'draw2': {
      if (state.options.stacking) {
        state.pendingDraw += 2;
        advance(state);
        return resolveStack(state);
      }
      const victim = state.players[nextIndex(state)];
      drawCards(state, nextIndex(state), 2);
      log(state, `${victim.name} zieht 2 und setzt aus.`);
      advance(state, 2);
      break;
    }
    case 'wild4': {
      if (state.options.stacking) {
        state.pendingDraw += 4;
        advance(state);
        return resolveStack(state);
      }
      const targetIdx = nextIndex(state);
      if (state.options.challenge) {
        state.pendingWild4.target = targetIdx;
        state.phase = 'challenge';
        log(state, `${state.players[targetIdx].name} darf anzweifeln.`);
        return ok(state);
      }
      drawCards(state, targetIdx, 4);
      log(state, `${state.players[targetIdx].name} zieht 4 und setzt aus.`);
      state.pendingWild4 = null;
      advance(state, 2);
      break;
    }
    default:
      advance(state);
      break;
  }
  return endTurnChecks(state);
}

/* Hausregel "weiterreichen": wer nicht nachlegen kann, zieht den Stapel. */
function resolveStack(state) {
  const idx = state.current;
  const canAnswer = state.players[idx].hand.some((c) => isPlayable(state, c));
  if (canAnswer) {
    log(state, `${state.players[idx].name} kann weiterreichen (${state.pendingDraw} liegen an).`);
    return endTurnChecks(state);
  }
  drawCards(state, idx, state.pendingDraw);
  log(state, `${state.players[idx].name} zieht ${state.pendingDraw} und setzt aus.`);
  state.pendingDraw = 0;
  state.pendingWild4 = null;
  advance(state);
  return endTurnChecks(state);
}

function actDraw(state, playerIdx) {
  if (state.phase !== 'play') return fail('Gerade kannst du nicht ziehen.');
  if (playerIdx !== state.current) return fail('Du bist nicht dran.');

  if (state.options.drawUntilPlayable) {
    let drawn = null;
    let guard = 0;
    do {
      const cards = drawCards(state, playerIdx, 1);
      if (cards.length === 0) break;
      drawn = cards[0];
      guard++;
    } while (!isPlayableRaw(state, drawn) && guard < 60);
    log(state, `${state.players[playerIdx].name} zieht, bis es passt (${guard}).`);
    if (drawn && isPlayableRaw(state, drawn)) {
      state.drawnCard = drawn;
      state.phase = 'drawn';
      return ok(state);
    }
    advance(state);
    return endTurnChecks(state);
  }

  const cards = drawCards(state, playerIdx, 1);
  if (cards.length === 0) {
    log(state, 'Keine Karten mehr im Stapel – der Zug geht weiter.');
    advance(state);
    return endTurnChecks(state);
  }
  log(state, `${state.players[playerIdx].name} zieht eine Karte.`);
  state.drawnCard = cards[0];
  state.phase = 'drawn';
  if (!isPlayableRaw(state, cards[0])) {
    // Nichts zu holen: der Zug endet sofort.
    state.drawnCard = null;
    state.phase = 'play';
    advance(state);
    return endTurnChecks(state);
  }
  return ok(state);
}

/* Wie isPlayable, aber ohne die Einschraenkung auf die gezogene Karte. */
function isPlayableRaw(state, card) {
  const saved = state.drawnCard;
  state.drawnCard = null;
  const savedPhase = state.phase;
  state.phase = 'play';
  const result = isPlayable(state, card);
  state.drawnCard = saved;
  state.phase = savedPhase;
  return result;
}

function actPass(state, playerIdx) {
  if (state.phase !== 'drawn') return fail('Passen geht nur nach dem Ziehen.');
  if (playerIdx !== state.current) return fail('Du bist nicht dran.');
  state.drawnCard = null;
  state.phase = 'play';
  log(state, `${state.players[playerIdx].name} spielt die gezogene Karte nicht.`);
  advance(state);
  return endTurnChecks(state);
}

function endTurnChecks(state) {
  state.drawnCard = null;
  if (state.phase === 'drawn') state.phase = 'play';
  return ok(state);
}

/* ------------------------------------------------------------- Rundenende */

function endRound(state, winnerIdx) {
  const winner = state.players[winnerIdx];
  let points = 0;
  const detail = [];
  for (let i = 0; i < state.players.length; i++) {
    if (i === winnerIdx) continue;
    const p = state.players[i];
    const pts = handPoints(p.hand);
    points += pts;
    detail.push({ id: p.id, name: p.name, cards: p.hand.length, points: pts });
  }
  winner.score += points;
  state.lastRound = { winner: winner.id, winnerName: winner.name, points, detail };
  state.unoVulnerable = null;
  state.pendingWild4 = null;
  state.drawnCard = null;
  log(state, `${winner.name} gewinnt die Runde und bekommt ${points} Punkte.`);

  const target = state.options.targetScore;
  if (!target || winner.score >= target) {
    state.phase = 'game-over';
    state.winner = winner.id;
    log(state, `${winner.name} gewinnt die Partie mit ${winner.score} Punkten.`);
  } else {
    state.phase = 'round-over';
  }
  return ok(state);
}

function actNextRound(state) {
  if (state.phase !== 'round-over') return fail('Die Runde laeuft noch.');
  startRound(state);
  return ok(state);
}

/* --------------------------------------------------------------- Sichtbares */

/* Was eine einzelne Person sehen darf: die eigene Hand, von den anderen
 * nur die Kartenzahl. Fuer Online-Partien und fuer Pass & Play. */
export function viewFor(state, playerIdx) {
  return {
    round: state.round,
    phase: state.phase,
    options: state.options,
    you: playerIdx,
    current: state.current,
    direction: state.direction,
    activeColor: state.activeColor,
    top: topCard(state) || null,
    drawPileCount: state.drawPile.length,
    discardCount: state.discard.length,
    pendingDraw: state.pendingDraw,
    drawnCardId: state.current === playerIdx ? state.drawnCard?.id ?? null : null,
    unoVulnerable: state.unoVulnerable,
    pendingWild4: state.pendingWild4 ? { by: state.pendingWild4.by, target: state.pendingWild4.target } : null,
    winner: state.winner,
    lastRound: state.lastRound,
    log: state.log.slice(-40),
    players: state.players.map((p, i) => ({
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      connected: p.connected,
      score: p.score,
      saidUno: p.saidUno,
      count: p.hand.length,
      hand: i === playerIdx ? p.hand : null,
    })),
  };
}
