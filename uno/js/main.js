/* Der Rahmen: Menue, Einstellungen, Warteraum – und der Wechsel zwischen
 * den drei Spielarten. */

import { LocalDriver } from './local.js';
import { NetClient, serverUrl } from './net.js';
import { TableUI, openOverlay, closeOverlay, toast, escapeHtml, actorOf } from './ui.js';
import { DEFAULT_OPTIONS } from './engine.js';

const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------------- Screens */

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('is-active', s.id === id);
  window.scrollTo(0, 0);
}

for (const btn of document.querySelectorAll('[data-goto]')) {
  btn.addEventListener('click', () => show(btn.dataset.goto));
}
for (const btn of document.querySelectorAll('[data-close]')) {
  btn.addEventListener('click', () => btn.closest('.overlay').classList.remove('is-open'));
}
$('btn-rules').addEventListener('click', () => openOverlay('ov-rules'));

/* ------------------------------------------------------------ Einstellungen */

/* Dieselben Schalter erscheinen in allen drei Vorbereitungen. */
function buildOptions(container, { onChange } = {}) {
  container.innerHTML = `
    <h2>Einstellungen</h2>
    <div>
      <label>Spiel geht bis</label>
      <select data-opt="targetScore">
        <option value="500">500 Punkte (Original)</option>
        <option value="300">300 Punkte</option>
        <option value="0">eine einzige Runde</option>
      </select>
    </div>
    <div class="check" style="margin-top:.8rem">
      <input type="checkbox" data-opt="challenge" checked id="${container.id || 'o'}-ch">
      <label for="${container.id || 'o'}-ch">Zieh Vier darf angezweifelt werden</label>
    </div>
    <div class="check">
      <input type="checkbox" data-opt="stacking" id="${container.id || 'o'}-st">
      <label for="${container.id || 'o'}-st">Hausregel: Zieh-Karten weiterreichen</label>
    </div>
    <div class="check">
      <input type="checkbox" data-opt="drawUntilPlayable" id="${container.id || 'o'}-dr">
      <label for="${container.id || 'o'}-dr">Hausregel: ziehen, bis es passt</label>
    </div>`;
  if (onChange) {
    for (const field of container.querySelectorAll('[data-opt]')) {
      field.addEventListener('change', () => onChange(readOptions(container)));
    }
  }
  return container;
}

function readOptions(container) {
  const options = { ...DEFAULT_OPTIONS };
  for (const field of container.querySelectorAll('[data-opt]')) {
    const key = field.dataset.opt;
    options[key] = field.type === 'checkbox' ? field.checked : Number(field.value);
  }
  return options;
}

function writeOptions(container, options) {
  for (const field of container.querySelectorAll('[data-opt]')) {
    const key = field.dataset.opt;
    if (options[key] === undefined) continue;
    if (field.type === 'checkbox') field.checked = !!options[key];
    else field.value = String(options[key]);
  }
}

const optionBoxes = [...document.querySelectorAll('[data-options]')];
optionBoxes.forEach((box, i) => { box.id = box.id || `options-${i}`; buildOptions(box); });
const soloOptions = $('screen-solo').querySelector('[data-options]');
const passOptions = $('screen-pass').querySelector('[data-options]');
const lobbyOptions = $('lobby-options');

/* --------------------------------------------------------------- Auswahlen */

function fillSelect(select, from, to, labelFn, selected) {
  select.innerHTML = '';
  for (let i = from; i <= to; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = labelFn(i);
    if (i === selected) opt.selected = true;
    select.appendChild(opt);
  }
}

fillSelect($('solo-bots'), 1, 9, (i) => `${i} Bot${i > 1 ? 's' : ''}`, 3);
fillSelect($('pass-count'), 2, 10, (i) => `${i} Plätze`, 4);

/* Namensfelder fuer Pass & Play. */
function renderPassNames() {
  const count = Number($('pass-count').value);
  const box = $('pass-names');
  const previous = [...box.querySelectorAll('.name-row')].map((row) => ({
    name: row.querySelector('input').value,
    kind: row.querySelector('select').value,
  }));
  box.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const row = document.createElement('div');
    row.className = 'name-row';
    row.innerHTML = `
      <span class="n">${i + 1}</span>
      <input maxlength="14" value="${escapeHtml(previous[i]?.name ?? `Spieler ${i + 1}`)}" aria-label="Name Platz ${i + 1}">
      <select class="kind" aria-label="Art Platz ${i + 1}">
        <option value="human">Mensch</option>
        <option value="easy">Bot leicht</option>
        <option value="normal">Bot normal</option>
        <option value="hard">Bot schwer</option>
      </select>`;
    if (previous[i]) row.querySelector('select').value = previous[i].kind;
    box.appendChild(row);
  }
}
$('pass-count').addEventListener('change', renderPassNames);
renderPassNames();

/* -------------------------------------------------------------- Spielstart */

let driver = null;
let net = null;
let table = null;
let lastPhase = null;

function handlers() {
  return {
    send: (action) => {
      if (net) { net.action(action); return { ok: true }; }
      return driver ? driver.send(action) : { ok: false, error: 'Kein Spiel.' };
    },
    quit: () => quitGame(),
  };
}

function ensureTable() {
  if (!table) table = new TableUI(handlers());
  return table;
}

function quitGame() {
  if (!confirm('Spiel wirklich beenden?')) return;
  teardown();
  show('screen-menu');
}

function teardown() {
  driver?.stop?.();
  driver = null;
  if (net) { net.leave(); net = null; }
  lastPhase = null;
  for (const ov of document.querySelectorAll('.overlay')) ov.classList.remove('is-open');
}

/* Eine Aktualisierung vom Treiber – lokal wie online derselbe Weg. */
function onUpdate(payload) {
  const ui = ensureTable();
  ui.render(payload);

  if (payload.handoff) {
    $('handoff-name').textContent = payload.handoff.name;
    $('handoff-text').textContent = `Gib das Handy an ${payload.handoff.name} weiter.`;
    openOverlay('ov-handoff');
  } else {
    closeOverlay('ov-handoff');
  }

  const phase = payload.view.phase;
  if ((phase === 'round-over' || phase === 'game-over') && phase !== lastPhase) {
    showRoundEnd(payload.view);
  }
  if (phase !== 'round-over' && phase !== 'game-over') closeOverlay('ov-round');
  lastPhase = phase;
}

$('handoff-ok').addEventListener('click', () => driver?.confirmHandoff());

function showRoundEnd(view) {
  const over = view.phase === 'game-over';
  const last = view.lastRound;
  $('round-title').textContent = over ? 'Partie vorbei!' : 'Runde vorbei';
  $('round-text').textContent = last
    ? `${last.winnerName} ist alle Karten los und bekommt ${last.points} Punkte.`
    : '';
  const rows = view.players
    .map((p, i) => `<tr class="${i === view.you ? 'me' : ''}"><td>${escapeHtml(p.name)}</td>
      <td class="num">${p.count}</td><td class="num">${p.score}</td></tr>`)
    .join('');
  $('round-scores').innerHTML =
    `<tr><th>Spieler</th><th class="num">Karten</th><th class="num">Punkte</th></tr>${rows}`;
  const next = $('round-next');
  next.textContent = over ? 'Neue Partie' : 'Nächste Runde';
  next.onclick = () => {
    closeOverlay('ov-round');
    if (over) { teardown(); show('screen-menu'); return; }
    if (net) net.nextRound();
    else driver?.nextRound();
  };
  $('round-quit').onclick = () => { closeOverlay('ov-round'); teardown(); show('screen-menu'); };
  openOverlay('ov-round');
}

/* Solo -------------------------------------------------------------------- */

$('solo-start').addEventListener('click', () => {
  const name = ($('solo-name').value || 'Du').trim().slice(0, 14);
  const bots = Number($('solo-bots').value);
  const level = $('solo-level').value;
  const players = [{ id: 'me', name, isBot: false }];
  for (let i = 0; i < bots; i++) {
    players.push({ id: `bot${i}`, name: botName(i), isBot: true, botLevel: level });
  }
  startLocal(players, readOptions(soloOptions), 'solo');
});

const BOT_NAMES = ['Ada', 'Bruno', 'Carla', 'Deniz', 'Ella', 'Franz', 'Gina', 'Hakan', 'Ida'];
function botName(i) { return BOT_NAMES[i % BOT_NAMES.length]; }

/* Pass & Play ------------------------------------------------------------- */

$('pass-start').addEventListener('click', () => {
  const rows = [...$('pass-names').querySelectorAll('.name-row')];
  const players = rows.map((row, i) => {
    const kind = row.querySelector('select').value;
    const name = (row.querySelector('input').value || `Spieler ${i + 1}`).trim().slice(0, 14);
    return kind === 'human'
      ? { id: `p${i}`, name, isBot: false }
      : { id: `p${i}`, name, isBot: true, botLevel: kind };
  });
  if (!players.some((p) => !p.isBot)) {
    toast('Mindestens ein Platz muss ein Mensch sein.');
    return;
  }
  startLocal(players, readOptions(passOptions), 'pass');
});

function startLocal(players, options, mode) {
  teardown();
  driver = new LocalDriver({ players, options, mode });
  driver.onUpdate(onUpdate);
  ensureTable();
  show('screen-game');
  driver.start();
}

/* Online ------------------------------------------------------------------ */

const savedName = localStorage.getItem('uno.name');
if (savedName) $('net-name').value = savedName;
const params = new URLSearchParams(location.search);
if (params.get('code')) {
  $('net-code').value = params.get('code').toUpperCase().slice(0, 4);
  show('screen-online');
}

let lobby = { code: null, you: null, host: false, players: [], options: { ...DEFAULT_OPTIONS } };

function netStatus(text, isError = false) {
  const el = $('net-status');
  el.textContent = text;
  el.classList.toggle('err', isError);
}

async function withNet(action) {
  if (!serverUrl()) {
    netStatus('Für das Online-Spiel muss der mitgelieferte Server laufen: npm start, dann die Seite über http://localhost:8080 öffnen.', true);
    return;
  }
  netStatus('Verbinde …');
  net = new NetClient();
  net
    .on('welcome', (msg) => {
      lobby.code = msg.code;
      lobby.you = msg.you;
      sessionStorage.setItem('uno.room', JSON.stringify({ code: msg.code, token: msg.token }));
    })
    .on('lobby', (msg) => {
      lobby.host = msg.host === lobby.you;
      lobby.players = msg.players;
      lobby.options = msg.options;
      renderLobby(msg);
      if (!msg.started) show('screen-lobby');
    })
    .on('state', (msg) => {
      if (!document.getElementById('screen-game').classList.contains('is-active')) show('screen-game');
      onUpdate({ mode: 'online', seat: msg.view.you, actor: actorOf(msg.view), handoff: null, view: msg.view, title: `Raum ${lobby.code} · Runde ${msg.view.round}` });
    })
    .on('error', (message) => { toast(message); netStatus(message, true); $('lobby-status').textContent = message; })
    .on('toast', (message) => toast(message))
    .on('status', (message) => { $('lobby-status').textContent = message; })
    .on('roomClosed', (message) => { toast(message || 'Der Raum wurde geschlossen.'); teardown(); show('screen-menu'); })
    .on('closed', () => { toast('Verbindung beendet.'); teardown(); show('screen-menu'); });

  try {
    await net.connect();
    netStatus('');
    action(net);
  } catch (err) {
    net = null;
    netStatus(err.message, true);
  }
}

$('net-create').addEventListener('click', () => {
  const name = playerName();
  if (!name) return;
  withNet((client) => client.create(name, readOptions(lobbyOptions)));
});

$('net-join').addEventListener('click', () => {
  const name = playerName();
  if (!name) return;
  const code = $('net-code').value.trim().toUpperCase();
  if (code.length !== 4) { netStatus('Der Raum-Code hat vier Zeichen.', true); return; }
  withNet((client) => client.join(code, name));
});

function playerName() {
  const name = $('net-name').value.trim().slice(0, 14);
  if (!name) { netStatus('Trag bitte einen Namen ein.', true); return null; }
  localStorage.setItem('uno.name', name);
  return name;
}

function renderLobby(msg) {
  $('lobby-code').textContent = msg.code;
  $('lobby-players').innerHTML = msg.players.map((p) => `
    <li>
      <span class="${p.id === lobby.you ? 'me' : ''}">${escapeHtml(p.name)}${p.isBot ? ' 🤖' : ''}</span>
      ${p.id === msg.host ? '<span class="host">Gastgeber</span>' : ''}
      ${p.connected === false ? '<span class="off">offline</span>' : ''}
    </li>`).join('');
  writeOptions(lobbyOptions, msg.options);
  const isHost = msg.host === lobby.you;
  $('lobby-host-tools').hidden = !isHost;
  $('lobby-start').disabled = !isHost || msg.players.length < 2;
  $('lobby-start').textContent = isHost
    ? (msg.players.length < 2 ? 'Warten auf Mitspieler …' : 'Spiel starten')
    : 'Der Gastgeber startet';
  for (const field of lobbyOptions.querySelectorAll('[data-opt]')) field.disabled = !isHost;
}

buildOptions(lobbyOptions, {
  onChange: (options) => { if (net && lobby.host) net.setOptions(options); },
});

$('lobby-addbot').addEventListener('click', () => net?.addBot('normal'));
$('lobby-rmbot').addEventListener('click', () => net?.removeBot());
$('lobby-start').addEventListener('click', () => net?.startGame());
$('lobby-leave').addEventListener('click', () => { teardown(); show('screen-menu'); });
$('lobby-copy').addEventListener('click', async () => {
  const link = `${location.origin}${location.pathname}?code=${lobby.code}`;
  try {
    await navigator.clipboard.writeText(link);
    toast('Link kopiert.');
  } catch {
    prompt('Diesen Link teilen:', link);
  }
});

/* Beim Verlassen der Seite sauber abmelden. */
window.addEventListener('beforeunload', () => { net?.leave(); });
