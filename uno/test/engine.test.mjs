import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDeck, createGame, applyAction, topCard, handPoints, cardPoints,
  playableCards, viewFor, makeRng, COLORS,
} from '../js/engine.js';
import { botAction, botCatch } from '../js/bot.js';

test('Das Deck entspricht dem Original: 108 Karten', () => {
  const deck = createDeck();
  assert.equal(deck.length, 108);
  assert.equal(deck.filter((c) => c.kind === 'wild').length, 4);
  assert.equal(deck.filter((c) => c.kind === 'wild4').length, 4);
  for (const color of COLORS) {
    const inColor = deck.filter((c) => c.color === color);
    assert.equal(inColor.length, 25);
    assert.equal(inColor.filter((c) => c.kind === '0').length, 1);
    assert.equal(inColor.filter((c) => c.kind === '7').length, 2);
    assert.equal(inColor.filter((c) => c.kind === 'skip').length, 2);
    assert.equal(inColor.filter((c) => c.kind === 'reverse').length, 2);
    assert.equal(inColor.filter((c) => c.kind === 'draw2').length, 2);
  }
  // 4x90 Zahlenpunkte + 4x120 Aktionspunkte + 8x50 fuer die Wunschkarten
  assert.equal(deck.reduce((s, c) => s + cardPoints(c), 0), 1240);
});

test('Startaufstellung: 7 Karten je Person, eine offene Karte', () => {
  const game = createGame({ players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], seed: 42 });
  assert.equal(game.players.length, 3);
  for (const p of game.players) assert.equal(p.hand.length, 7);
  assert.equal(game.discard.length, 1);
  assert.notEqual(topCard(game).kind, 'wild4', 'Zieh-Vier darf nicht Startkarte sein');
  assert.equal(game.drawPile.length, 108 - 21 - 1);
});

test('Nur passende Karten sind spielbar', () => {
  const game = createGame({ players: [{ name: 'A' }, { name: 'B' }], seed: 5 });
  for (const card of playableCards(game, game.current)) {
    const matches = card.color === game.activeColor
      || card.color === 'wild'
      || card.kind === topCard(game).kind;
    assert.ok(matches, `unpassende Karte spielbar: ${card.color} ${card.kind}`);
  }
  const wrong = game.players[game.current].hand.find(
    (c) => c.color !== 'wild' && c.color !== game.activeColor && c.kind !== topCard(game).kind,
  );
  if (wrong) {
    const res = applyAction(game, game.current, { type: 'play', cardId: wrong.id });
    assert.equal(res.ok, false);
  }
});

test('Wer nicht am Zug ist, kann nichts legen', () => {
  const game = createGame({ players: [{ name: 'A' }, { name: 'B' }], seed: 11 });
  const other = (game.current + 1) % 2;
  const card = game.players[other].hand[0];
  const res = applyAction(game, other, { type: 'play', cardId: card.id });
  assert.equal(res.ok, false);
});

test('Retour wirkt zu zweit wie Aussetzen', () => {
  const game = createGame({ players: [{ name: 'A' }, { name: 'B' }], seed: 3 });
  const me = game.current;
  const reverse = { id: 'x1', color: game.activeColor || 'red', kind: 'reverse' };
  game.activeColor = reverse.color;
  game.players[me].hand.push(reverse);
  const res = applyAction(game, me, { type: 'play', cardId: 'x1' });
  assert.equal(res.ok, true);
  assert.equal(game.current, me, 'dieselbe Person ist erneut am Zug');
});

test('Zieh-Zwei: zwei Karten und Zug verloren', () => {
  const game = createGame({ players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], seed: 9 });
  const me = game.current;
  const victim = (me + 1) % 3;
  const before = game.players[victim].hand.length;
  const card = { id: 'x2', color: game.activeColor || 'red', kind: 'draw2' };
  game.activeColor = card.color;
  game.players[me].hand.push(card);
  applyAction(game, me, { type: 'play', cardId: 'x2' });
  assert.equal(game.players[victim].hand.length, before + 2);
  assert.equal(game.current, (me + 2) % 3);
});

test('Vergessenes UNO kostet zwei Karten, gerufenes nicht', () => {
  const game = createGame({ players: [{ name: 'A' }, { name: 'B' }], seed: 21 });
  const me = game.current;
  const other = (me + 1) % 2;
  const color = game.activeColor || 'red';
  game.activeColor = color;
  game.players[me].hand = [
    { id: 'y1', color, kind: '5' },
    { id: 'y2', color, kind: '9' },
  ];
  applyAction(game, me, { type: 'play', cardId: 'y1' });
  assert.equal(game.unoVulnerable, me);
  const res = applyAction(game, other, { type: 'catch', target: me });
  assert.equal(res.ok, true);
  assert.equal(game.players[me].hand.length, 3);
  assert.equal(game.unoVulnerable, null);
});

test('Zieh-Vier anzweifeln: zu Unrecht gelegt heisst vier Karten fuer die Legerin', () => {
  const game = createGame({ players: [{ name: 'A' }, { name: 'B' }], seed: 33 });
  const me = game.current;
  const other = (me + 1) % 2;
  const color = 'red';
  game.activeColor = color;
  game.discard.push({ id: 'top', color, kind: '3' });
  game.players[me].hand = [
    { id: 'w4', color: 'wild', kind: 'wild4' },
    { id: 'r7', color, kind: '7' }, // passende Farbe auf der Hand -> unzulaessig
    { id: 'b2', color: 'blue', kind: '2' },
  ];
  const handBefore = game.players[me].hand.length - 1;
  applyAction(game, me, { type: 'play', cardId: 'w4', color: 'green' });
  assert.equal(game.phase, 'challenge');
  applyAction(game, other, { type: 'challenge', challenge: true });
  assert.equal(game.players[me].hand.length, handBefore + 4);
  assert.equal(game.current, other, 'die anzweifelnde Person bleibt am Zug');
});

test('Zu Unrecht angezweifelt kostet sechs Karten', () => {
  const game = createGame({ players: [{ name: 'A' }, { name: 'B' }], seed: 34 });
  const me = game.current;
  const other = (me + 1) % 2;
  game.activeColor = 'red';
  game.discard.push({ id: 'top', color: 'red', kind: '3' });
  game.players[me].hand = [
    { id: 'w4', color: 'wild', kind: 'wild4' },
    { id: 'b2', color: 'blue', kind: '2' },
  ];
  const otherBefore = game.players[other].hand.length;
  applyAction(game, me, { type: 'play', cardId: 'w4', color: 'green' });
  applyAction(game, other, { type: 'challenge', challenge: true });
  assert.equal(game.players[other].hand.length, otherBefore + 6);
  assert.equal(game.current, me, 'nach dem Aussetzen ist wieder A dran');
});

test('Punkte der Runde: die Handkarten der anderen', () => {
  const game = createGame({ players: [{ name: 'A' }, { name: 'B' }], seed: 55, options: { targetScore: 500 } });
  const me = game.current;
  const other = (me + 1) % 2;
  const color = game.activeColor || 'red';
  game.activeColor = color;
  game.phase = 'play';
  game.players[me].hand = [{ id: 'z1', color, kind: '5' }];
  game.players[other].hand = [
    { id: 'z2', color: 'blue', kind: '9' },
    { id: 'z3', color: 'wild', kind: 'wild4' },
  ];
  applyAction(game, me, { type: 'play', cardId: 'z1' });
  assert.equal(game.phase, 'round-over');
  assert.equal(game.players[me].score, 59);
  assert.equal(game.lastRound.points, 59);
});

test('Der Nachziehstapel wird aus dem Ablagestapel neu gemischt', () => {
  const game = createGame({ players: [{ name: 'A' }, { name: 'B' }], seed: 77 });
  game.discard = [...game.drawPile.splice(0, game.drawPile.length), ...game.discard];
  assert.equal(game.drawPile.length, 0);
  const drawn = applyAction(game, game.current, { type: 'draw' });
  assert.equal(drawn.ok, true);
  assert.ok(game.drawPile.length + game.discard.length > 0);
});

test('Sichtbarkeit: fremde Haende bleiben verdeckt', () => {
  const game = createGame({ players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], seed: 8 });
  const view = viewFor(game, 1);
  assert.equal(view.players[1].hand.length, 7);
  assert.equal(view.players[0].hand, null);
  assert.equal(view.players[2].hand, null);
  assert.equal(view.players[0].count, 7);
  assert.ok(!JSON.stringify(view.players[0]).includes('"kind"'));
});

/* Vollstaendige Partien: nur Bots, viele Durchlaeufe. Faengt Haenger,
 * Kartenverluste und Regelfehler ab, die im Einzelfall nicht auffallen. */
for (const [count, seedBase] of [[2, 100], [4, 200], [7, 300], [10, 400]]) {
  test(`${count} Bots spielen eine Partie zu Ende`, () => {
    for (let s = 0; s < 12; s++) {
      const seed = seedBase + s;
      const rnd = makeRng(seed ^ 0x5eed);
      const players = Array.from({ length: count }, (_, i) => ({
        name: `Bot ${i + 1}`,
        isBot: true,
        botLevel: ['easy', 'normal', 'hard'][i % 3],
      }));
      const game = createGame({ players, options: { targetScore: 200 }, seed });

      let steps = 0;
      while (game.phase !== 'game-over' && steps < 40000) {
        steps++;
        if (game.phase === 'round-over') {
          applyAction(game, 0, { type: 'next-round' });
          continue;
        }
        const actorIdx = game.phase === 'challenge' ? game.pendingWild4.target : game.current;
        const action = botAction(game, actorIdx, rnd);
        assert.ok(action, `kein Zug moeglich (Phase ${game.phase})`);
        const res = applyAction(game, actorIdx, action);
        assert.ok(res.ok, `ungueltiger Botzug: ${res.error} (Phase ${game.phase})`);

        if (game.unoVulnerable !== null) {
          for (let i = 0; i < game.players.length; i++) {
            const c = botCatch(game, i, rnd);
            if (c) { applyAction(game, i, c); break; }
          }
        }

        const total = game.drawPile.length + game.discard.length
          + game.players.reduce((sum, p) => sum + p.hand.length, 0);
        assert.equal(total, 108, `Karten verloren oder verdoppelt (${total})`);
      }
      assert.equal(game.phase, 'game-over', `Partie haengt (Seed ${seed}, ${steps} Zuege)`);
      assert.ok(game.players.some((p) => p.score >= 200));
    }
  });
}

/* --------------------------------------------------- Adresse des Servers */

/* Auf einem statischen Hoster (GitHub Pages) laeuft kein Spielserver.
 * Dann muss die Seite eine eigene Adresse annehmen und behalten. */
test('Serveradresse: eigene Angabe schlaegt die Herkunft der Seite', async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.window = { location: { protocol: 'https:', host: 'levithomas15.github.io', hostname: 'levithomas15.github.io' } };

  const net = await import('../js/net.js');
  assert.equal(net.needsOwnServer(), true, 'auf github.io fehlt der Server');
  assert.equal(net.serverUrl(), 'wss://levithomas15.github.io/ws');

  net.saveServer('wss://uno.example.org/ws');
  assert.equal(net.serverUrl(), 'wss://uno.example.org/ws', 'die eigene Adresse gilt');
  assert.equal(net.needsOwnServer(), false, 'mit eigener Adresse ist alles gut');

  net.saveServer('');
  globalThis.window = { location: { protocol: 'http:', host: 'localhost:8080', hostname: 'localhost' } };
  assert.equal(net.needsOwnServer(), false, 'ein eigener Server braucht keine Angabe');
  assert.equal(net.serverUrl(), 'ws://localhost:8080/ws');

  delete globalThis.window;
  delete globalThis.localStorage;
});
