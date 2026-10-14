import {
  HAND_SIZE,
  boardEnds,
  createDeck,
  legalMovesFor,
  handPips,
  teamOf,
  tileId,
} from './game.js';
import { BOT_NAMES, GameEngine } from './engine.js';
import { boardSvg, singleTileSvg } from './board.js';

const KEYS = {
  match: 'domino-dupla.match.v2',
  settings: 'domino-dupla.settings.v1',
  name: 'domino-dupla.name',
  id: 'domino-dupla.id',
  keys: 'domino-dupla.keys',
  session: 'domino-dupla.online.v1',
  seenRules: 'domino-dupla.seen-rules',
  admin: 'domino-dupla.admin',
};
const FINISH_LABEL = {
  simples: 'batida simples',
  bucha: 'batida de bucha',
  duasPontas: 'batida nas duas pontas',
  gambuada: 'gambuada',
  trancado: 'jogo trancado',
};

const $ = (sel) => document.querySelector(sel);
const screens = { home: $('#home'), lobby: $('#lobby'), table: $('#app') };
const boardEl = $('#board');
const handEl = $('#hand');
const statusEl = $('#status');
const modal = $('#modal');
const modalBody = $('#modal-body');

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ---------- Armazenamento ----------
function loadJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveJson(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Armazenamento indisponível (aba privada): o jogo segue sem salvar.
  }
}

const settings = { sound: true, speed: 'normal', level: 2, ...loadJson(KEYS.settings) };
const saveSettings = () => saveJson(KEYS.settings, settings);
const delay = () => (settings.speed === 'fast' ? 450 : 900);

function deviceId() {
  let id = loadJson(KEYS.id);
  if (typeof id !== 'string') {
    id = Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(36).padStart(2, '0')).join('');
    saveJson(KEYS.id, id);
  }
  return id;
}

// ---------- Estado da tela ----------
// mode: 'home' | 'local' | 'online'
let mode = 'home';
let localEngine = null;
let session = null;
let selectedId = null;
let lastActionKey = null;
let resultShownFor = null;
const bubbles = new Map();

function show(name) {
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
}

// ---------- Som ----------
let audioCtx = null;
function clack() {
  if (!settings.sound) return;
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const len = Math.floor(audioCtx.sampleRate * 0.07);
    const buffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1800 + Math.random() * 600;
    filter.Q.value = 1.2;
    const gain = audioCtx.createGain();
    gain.gain.value = 0.9;
    src.connect(filter).connect(gain).connect(audioCtx.destination);
    src.start();
  } catch {
    // Sem áudio, sem problema.
  }
}
document.addEventListener('pointerdown', () => audioCtx?.resume?.(), { passive: true });

// Mantém a tela acesa no jogo online (o celular derruba a conexão quando apaga).
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null;
  }
}

// ---------- Controle comum ----------
function currentView() {
  if (mode === 'local') return localEngine?.view(0) ?? null;
  if (mode === 'online') return session?.view() ?? null;
  return null;
}

function sendPlay(move) {
  const view = currentView();
  selectedId = null;
  if (mode === 'local') localEngine.play(0, move, view.seq);
  else session.play(move, view.seq);
}

function sendNext(roundNo) {
  if (mode === 'local') localEngine.next(roundNo);
  else session.next(roundNo);
}

// ---------- Jogo local ----------
function startLocal(resume) {
  mode = 'local';
  const name = myName();
  const saved = resume ? loadJson(KEYS.match) : null;
  const seats = [
    { kind: 'human', name, online: true },
    { kind: 'bot', name: BOT_NAMES[0], online: true },
    { kind: 'bot', name: BOT_NAMES[1], online: true },
    { kind: 'bot', name: BOT_NAMES[2], online: true },
  ];
  localEngine = new GameEngine({
    match: saved?.round?.hands?.length === 4 ? saved : null,
    seats,
    botLevel: settings.level,
    delay: delay(),
    onChange: (engine) => {
      saveJson(KEYS.match, engine.match);
      renderGame();
    },
  });
  resultShownFor = null;
  lastActionKey = null;
  show('table');
  localEngine.begin();
  if (!loadJson(KEYS.seenRules)) {
    saveJson(KEYS.seenRules, true);
    localEngine.pause();
    showRules(() => localEngine.resume());
  }
}

// ---------- Jogo online ----------
let onlineModule = null;
async function online() {
  onlineModule ??= await import('./online.js');
  return onlineModule;
}

async function startOnline(role, code = null) {
  const net = await online();
  if (!window.crypto?.subtle) {
    homeMessage('O jogo online precisa do site em https.');
    return;
  }
  homeMessage(role === 'host' ? 'Criando sala…' : 'Entrando na sala…');
  const keys = await net.loadOrCreateKeys({ get: () => loadJson(KEYS.keys), set: (v) => saveJson(KEYS.keys, v) });
  const me = { id: deviceId(), name: myName() };
  const saved = loadJson(KEYS.session);
  const common = {
    me,
    keys,
    onUpdate: () => renderOnline(),
    onSave: (data) => saveJson(KEYS.session, data),
  };

  if (role === 'host') {
    const resume = saved?.role === 'host' && (!code || saved.code === code) ? saved : null;
    session = new net.HostSession({ ...common, saved: resume, delay: 900 });
  } else {
    session = new net.ClientSession({ ...common, code });
  }

  try {
    await session.start();
  } catch {
    session = null;
    homeMessage('Não consegui conectar ao servidor. Confira a internet e tente de novo.');
    return;
  }
  mode = 'online';
  resultShownFor = null;
  lastActionKey = null;
  homeMessage('');
  history.replaceState(null, '', `${location.pathname}${brokerQuery()}`);
  renderOnline();
}

function brokerQuery() {
  const broker = new URLSearchParams(location.search).get('broker');
  return broker ? `?broker=${encodeURIComponent(broker)}` : '';
}

function inviteLink(code) {
  const params = new URLSearchParams(location.search);
  params.set('sala', code);
  return `${location.origin}${location.pathname}?${params}`;
}

function leaveOnline() {
  session?.close();
  session = null;
  mode = 'home';
  keepAwake(false);
  closeModal();
  showHome();
}

function renderOnline() {
  if (mode !== 'online' || !session) return;
  const status = session.status;
  if (status === 'not-found' || status === 'closed') {
    const msg = status === 'closed' ? 'A sala foi encerrada pelo anfitrião.' : 'Sala não encontrada. Confira o código.';
    session.close();
    session = null;
    mode = 'home';
    closeModal();
    showHome(msg);
    return;
  }

  const view = session.view();
  if (view) {
    keepAwake(true);
    show('table');
    renderGame();
  } else {
    if (resultShownFor !== null) closeModal();
    show('lobby');
    renderLobby();
  }
}

function renderLobby() {
  const lobby = session.lobby();
  const seatCard = (i) => {
    const s = lobby.seats[i];
    let body;
    let actions = '';
    if (s.kind === 'human') {
      body = `<b>${esc(s.name)}</b>${s.isMe ? ' <small>(você)</small>' : ''}${s.online ? '' : ' <small class="off">fora</small>'}`;
      if (lobby.isHost && !s.isMe && lobby.phase === 'lobby') actions = `<button data-act="clear" data-seat="${i}">Tirar</button>`;
    } else if (s.kind === 'bot') {
      body = `🤖 <b>${esc(s.name)}</b> <small>robô</small>`;
      if (lobby.phase === 'lobby') {
        actions = `<button data-act="sit" data-seat="${i}">Sentar aqui</button>`;
        if (lobby.isHost) actions += `<button data-act="clear" data-seat="${i}">Tirar</button>`;
      }
    } else {
      body = '<span class="empty">Lugar vazio</span>';
      if (lobby.phase === 'lobby') {
        actions = `<button data-act="sit" data-seat="${i}">Sentar aqui</button>`;
        if (lobby.isHost) actions += `<button data-act="bot" data-seat="${i}">+ Robô</button>`;
      }
    }
    return `<div class="lobby-seat ${s.isMe ? 'is-me' : ''}"><span class="seat-no">Lugar ${i + 1}</span><div>${body}</div><div class="lobby-actions">${actions}</div></div>`;
  };

  const statusLine = {
    connecting: 'Conectando…',
    reconnecting: 'Sem conexão, tentando de novo…',
    'host-offline': 'O anfitrião saiu do ar. Aguardando ele voltar…',
    online: '',
  }[session.status] ?? '';

  let footer;
  if (lobby.phase === 'game') {
    footer = lobby.mySeat >= 0
      ? '<p class="hint">Carregando a mesa…</p>'
      : '<p class="hint">A partida já começou e os lugares estão ocupados.</p>';
  } else if (lobby.isHost) {
    footer = `<button class="big-btn primary" id="start-btn" ${lobby.canStart ? '' : 'disabled'}>Começar partida</button>
      <p class="hint">${lobby.canStart ? 'Tudo pronto!' : lobby.mySeat < 0 ? 'Escolha um lugar para você.' : 'Preencha os lugares vazios com amigos ou robôs.'}</p>`;
  } else {
    footer = `<p class="hint">${lobby.mySeat < 0 ? 'Escolha um lugar.' : 'Aguardando o anfitrião começar…'}</p>`;
  }

  screens.lobby.innerHTML = `
    <div class="lobby-head">
      <p class="lobby-label">Sala</p>
      <p class="lobby-code">${esc(lobby.code)}</p>
      <button class="big-btn" id="invite-btn">📲 Convidar amigos</button>
      ${statusLine ? `<p class="lobby-status">${statusLine}</p>` : ''}
    </div>
    <div class="lobby-teams">
      <div class="lobby-team"><h3>Dupla 1</h3>${seatCard(0)}${seatCard(2)}</div>
      <div class="lobby-team"><h3>Dupla 2</h3>${seatCard(1)}${seatCard(3)}</div>
    </div>
    <p class="hint small">Parceiros sentam frente a frente: lugares 1 e 3 contra 2 e 4.</p>
    ${footer}
    <button class="link-btn" id="leave-btn">${lobby.isHost ? 'Encerrar sala' : 'Sair da sala'}</button>`;

  screens.lobby.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const seat = Number(btn.dataset.seat);
      if (btn.dataset.act === 'sit') session.sitMe(seat);
      else if (btn.dataset.act === 'bot') session.addBot(seat);
      else if (btn.dataset.act === 'clear') session.clearSeat(seat);
    });
  });
  $('#start-btn')?.addEventListener('click', () => session.startGame());
  $('#invite-btn').addEventListener('click', () => invite(lobby.code));
  $('#leave-btn').addEventListener('click', () => {
    if (lobby.isHost && !confirm('Encerrar a sala para todos?')) return;
    leaveOnline();
  });
}

async function invite(code) {
  const url = inviteLink(code);
  const text = `Bora jogar dominó em dupla? Entra na minha sala ${code}: ${url}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Dominó em Dupla', text, url });
      return;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(text);
    alert('Convite copiado! Cole no WhatsApp.');
  } catch {
    prompt('Copie o convite:', text);
  }
}

// ---------- Mesa ----------
const relOf = (view, seat) => (seat - view.seat + 4) % 4;
const nameOf = (view, seat) => (seat === view.seat ? 'Você' : view.players[seat].name);

function boardShape() {
  const rect = boardEl.getBoundingClientRect();
  const aspect = rect.width && rect.height ? rect.width / rect.height : 1;
  // Mesa alta e estreita → fileiras curtas e mais pedras grandes.
  const halfWidth = Math.max(5, Math.min(12, Math.round((1 + Math.sqrt(1 + 90 * aspect)) / 2)));
  return { aspect, halfWidth };
}

function myLegalMoves(view) {
  if (view.result || view.turn !== view.seat) return [];
  return legalMovesFor(view.hand, view.board, view.mustOpenWith);
}

function noteNewAction(view) {
  const key = `${view.roundNo}:${view.seq}`;
  if (key === lastActionKey) return;
  const first = lastActionKey === null;
  lastActionKey = key;
  selectedId = null;
  const last = view.lastAction;
  if (first || !last) return;
  if (last.type === 'play') clack();
  else {
    const rel = relOf(view, last.player);
    const text = rel === 0 ? 'Passei' : 'Passo!';
    bubbles.set(rel, text);
    setTimeout(() => {
      if (bubbles.get(rel) === text) {
        bubbles.delete(rel);
        const v = currentView();
        if (v) renderSeats(v);
      }
    }, 1400);
  }
}

function renderGame() {
  const view = currentView();
  if (!view) return;
  noteNewAction(view);

  const myTeam = teamOf(view.seat);
  $('#score-us').textContent = view.scores[myTeam];
  $('#score-them').textContent = view.scores[1 - myTeam];
  $('#round-tag').textContent = `Rodada ${view.roundNo} · até ${view.target}`;

  const banner = $('#net-banner');
  const netText = mode === 'online' ? {
    reconnecting: 'Sem conexão, tentando de novo…',
    'host-offline': 'O anfitrião saiu do ar. Aguardando…',
  }[session.status] : null;
  banner.hidden = !netText;
  banner.textContent = netText ?? '';

  renderSeats(view);
  renderBoard(view);
  renderHand(view);
  renderStatus(view);

  if (view.result) {
    const key = `${view.roundNo}`;
    if (resultShownFor !== key) {
      resultShownFor = key;
      setTimeout(() => {
        const v = currentView();
        if (v?.result && `${v.roundNo}` === key) showRoundEnd(v);
      }, 700);
    }
  } else if (resultShownFor !== null) {
    resultShownFor = null;
    closeModal();
  }
}

function renderBoard(view) {
  const last = view.lastAction?.type === 'play' ? tileId(view.lastAction.tile) : null;
  const anchors = selectedId && view.board ? ['left', 'right'] : null;
  if (!view.board) {
    const opener = view.mustOpenWith ? 'Quem tem a bucha de sena <b>6|6</b> abre o jogo' : 'Mesa vazia';
    boardEl.innerHTML = `<div class="board-empty">${opener}</div>`;
    return;
  }
  boardEl.innerHTML = boardSvg(view.board, { ...boardShape(), freshId: last, anchors });
  boardEl.querySelectorAll('.anchor').forEach((el) => {
    el.addEventListener('click', () => onSidePick(el.dataset.side));
  });
}

function renderSeats(view) {
  document.querySelectorAll('.seat').forEach((seatEl) => {
    const rel = Number(seatEl.dataset.rel);
    const seat = (view.seat + rel) % 4;
    const player = view.players[seat];
    const count = view.counts[seat];
    const backs = Array.from({ length: count }, () => '<span class="back"></span>').join('');
    const bubble = bubbles.get(rel);
    const tag = rel === 2 ? 'sua dupla' : mode === 'online' && player.kind === 'bot' ? 'robô' : '';
    seatEl.classList.toggle('team-us', teamOf(seat) === teamOf(view.seat));
    seatEl.classList.toggle('team-them', teamOf(seat) !== teamOf(view.seat));
    seatEl.classList.toggle('active', view.turn === seat && !view.result);
    seatEl.classList.toggle('away', !player.online);
    seatEl.innerHTML = `
      <div class="seat-head">
        <span class="avatar">${esc([...player.name][0] ?? '?')}</span>
        <span class="seat-name">${esc(player.name)}${tag ? ` <small>${tag}</small>` : ''}${player.online ? '' : ' <small class="off">fora</small>'}</span>
        <span class="seat-count">${count}</span>
      </div>
      <div class="backs">${backs}</div>
      ${bubble ? `<div class="bubble">${bubble}</div>` : ''}`;
  });
  document.querySelector('.me').dataset.bubble = bubbles.get(0) ?? '';
}

function renderHand(view) {
  const moves = myLegalMoves(view);
  const myTurn = view.turn === view.seat && !view.result;
  const playable = new Set(moves.map((m) => tileId(m.tile)));
  handEl.innerHTML = view.hand
    .map((tile) => {
      const id = tileId(tile);
      const cls = [
        'hand-tile',
        playable.has(id) ? 'playable' : myTurn ? 'dim' : '',
        selectedId === id ? 'selected' : '',
      ].join(' ');
      return `<button class="${cls}" data-id="${id}" aria-label="Pedra ${tile[0]} e ${tile[1]}">${singleTileSvg(tile)}</button>`;
    })
    .join('');
  handEl.querySelectorAll('.hand-tile').forEach((el) => {
    el.addEventListener('click', () => onTileTap(el.dataset.id));
  });
}

function renderStatus(view) {
  let text = '';
  if (view.result) {
    text = 'Fim da rodada';
  } else if (view.turn === view.seat) {
    if (!myLegalMoves(view).length) text = 'Sem pedra para jogar… você passa';
    else if (selectedId) {
      const [l, r] = boardEnds(view.board);
      text = `Escolha a ponta:
        <button class="side-btn" data-side="left">◀ ponta ${l}</button>
        <button class="side-btn" data-side="right">ponta ${r} ▶</button>`;
    } else if (!view.board && view.mustOpenWith) text = 'Sua vez: abra com a bucha de sena 6|6';
    else text = 'Sua vez';
  } else {
    const last = view.lastAction;
    let lastText = '';
    if (last) {
      lastText = last.type === 'pass'
        ? `${esc(nameOf(view, last.player))} passou · `
        : `${esc(nameOf(view, last.player))} jogou ${last.tile[0]}|${last.tile[1]} · `;
    }
    text = `${lastText}vez de ${esc(nameOf(view, view.turn))}…`;
  }
  statusEl.innerHTML = text;
  statusEl.querySelectorAll('.side-btn').forEach((el) => {
    el.addEventListener('click', () => onSidePick(el.dataset.side));
  });
}

function onTileTap(id) {
  const view = currentView();
  if (!view) return;
  const moves = myLegalMoves(view).filter((m) => tileId(m.tile) === id);
  if (!moves.length) {
    const el = handEl.querySelector(`[data-id="${id}"]`);
    el?.classList.remove('shake');
    void el?.offsetWidth;
    el?.classList.add('shake');
    return;
  }
  if (moves.length === 1) {
    sendPlay(moves[0]);
    return;
  }
  selectedId = selectedId === id ? null : id;
  renderGame();
}

function onSidePick(side) {
  const view = currentView();
  if (!view || !selectedId) return;
  const move = myLegalMoves(view).find((m) => tileId(m.tile) === selectedId && m.side === side);
  if (move) sendPlay(move);
}

// ---------- Janelas ----------
function openModal(html, onReady) {
  modalBody.innerHTML = html;
  if (!modal.open) modal.showModal();
  onReady?.();
}

function closeModal() {
  if (modal.open) modal.close();
}

function miniHand(hand) {
  if (!hand.length) return '<span class="empty-hand">bateu</span>';
  return hand.map((t) => `<span class="mini-tile">${singleTileSvg(t, false)}</span>`).join('');
}

function showRoundEnd(view) {
  const res = view.result;
  const myTeam = teamOf(view.seat);
  const usWon = res.team === myTeam;
  const teamWord = (team) => (team === myTeam ? 'Nós' : 'Eles');

  let title;
  if (res.type === 'trancado') {
    title = res.team === null ? 'Jogo trancado — empate!' : `Jogo trancado — ${usWon ? 'nós' : 'eles'} com menos pontos`;
  } else if (res.player === view.seat) {
    title = `Você bateu! (${FINISH_LABEL[res.type]})`;
  } else {
    title = `${esc(nameOf(view, res.player))} bateu — ${FINISH_LABEL[res.type]}`;
  }
  const gain = res.team === null
    ? 'Ninguém pontua.'
    : `<b class="${usWon ? 'us-text' : 'them-text'}">+${res.points} ${res.points > 1 ? 'pontos' : 'ponto'}</b> para ${teamWord(res.team)}`;
  const pipsLine = res.type === 'trancado'
    ? `<p class="small">Pontos na mão: Nós ${res.teamPips[myTeam]} · Eles ${res.teamPips[1 - myTeam]}</p>`
    : '';

  const order = [0, 1, 2, 3].map((rel) => (view.seat + rel) % 4);
  const hands = order
    .map((p) => `<div class="reveal-row ${teamOf(p) === myTeam ? 'team-us' : 'team-them'}">
      <span class="reveal-name">${esc(nameOf(view, p))} <small>${handPips(res.hands[p])}</small></span>
      <span class="reveal-tiles">${miniHand(res.hands[p])}</span>
    </div>`)
    .join('');

  const over = view.winner !== null;
  const overHtml = over
    ? `<h2 class="${view.winner === myTeam ? 'us-text' : 'them-text'}">${view.winner === myTeam ? 'Vocês venceram a partida! 🎉' : 'Eles venceram a partida'}</h2>`
    : '';

  openModal(`
    ${overHtml}
    <h3>${title}</h3>
    <p>${gain}</p>
    ${pipsLine}
    <div class="reveal">${hands}</div>
    <p class="final-score">Nós <b>${view.scores[myTeam]}</b> × <b>${view.scores[1 - myTeam]}</b> Eles</p>
    <button class="primary" id="next-btn">${over ? 'Nova partida' : 'Próxima rodada'}</button>
  `, () => {
    $('#next-btn').addEventListener('click', (e) => {
      e.currentTarget.disabled = true;
      e.currentTarget.textContent = 'Aguardando…';
      sendNext(view.roundNo);
    });
  });
}

function showMenu() {
  const isLocal = mode === 'local';
  const isHost = mode === 'online' && session?.role === 'host';
  if (isLocal) localEngine.pause();

  const resumeGame = () => {
    closeModal();
    if (isLocal) localEngine.resume();
    const view = currentView();
    if (view?.result) {
      resultShownFor = null;
      renderGame();
    }
  };

  openModal(`
    <h3>Menu</h3>
    <div class="menu-list">
      <label class="toggle"><span>Som</span><input type="checkbox" id="opt-sound" ${settings.sound ? 'checked' : ''}></label>
      ${isLocal ? `
      <label class="toggle"><span>Jogadas rápidas</span><input type="checkbox" id="opt-fast" ${settings.speed === 'fast' ? 'checked' : ''}></label>
      <label class="toggle"><span>Adversários espertos</span><input type="checkbox" id="opt-level" ${settings.level >= 2 ? 'checked' : ''}></label>` : `
      <p class="small">Sala <b>${esc(session.code)}</b></p>
      <button id="invite-menu-btn">📲 Convidar</button>`}
      ${canPickTiles() ? '<button id="pick-btn">🧪 Escolher minhas pedras</button>' : ''}
      <button id="rules-btn">Regras</button>
      ${isLocal ? '<button id="new-btn" class="danger">Nova partida</button>' : ''}
      <button id="exit-btn" class="danger">${isLocal ? 'Sair para o início' : isHost ? 'Encerrar sala' : 'Sair da sala'}</button>
      <button id="close-btn" class="primary">Voltar ao jogo</button>
    </div>
  `, () => {
    $('#opt-sound').addEventListener('change', (e) => { settings.sound = e.target.checked; saveSettings(); });
    $('#opt-fast')?.addEventListener('change', (e) => {
      settings.speed = e.target.checked ? 'fast' : 'normal';
      localEngine.delay = delay();
      saveSettings();
    });
    $('#opt-level')?.addEventListener('change', (e) => {
      settings.level = e.target.checked ? 2 : 1;
      localEngine.botLevel = settings.level;
      saveSettings();
    });
    $('#invite-menu-btn')?.addEventListener('click', () => invite(session.code));
    $('#rules-btn').addEventListener('click', () => showRules(resumeGame));
    $('#pick-btn')?.addEventListener('click', () => showTilePicker(resumeGame));
    $('#close-btn').addEventListener('click', resumeGame);
    $('#new-btn')?.addEventListener('click', () => {
      if (!confirm('Começar uma nova partida? O placar atual será perdido.')) return;
      closeModal();
      saveJson(KEYS.match, null);
      startLocal(false);
    });
    $('#exit-btn').addEventListener('click', () => {
      if (isLocal) {
        closeModal();
        localEngine.pause();
        localEngine = null;
        mode = 'home';
        showHome();
        return;
      }
      if (isHost && !confirm('Encerrar a sala para todos?')) return;
      leaveOnline();
    });
  });
}

// ---------- Modo teste (administrador) ----------
// Liberado abrindo o site com ?teste=1 (e desligado com ?teste=0).
const isAdmin = () => loadJson(KEYS.admin) === true;

function canPickTiles() {
  if (!isAdmin()) return false;
  if (mode === 'local') return true;
  return mode === 'online' && session?.role === 'host' && !!session.view();
}

function showTilePicker(onClose) {
  const chosen = new Set();
  const deck = createDeck();
  const paint = () => {
    modalBody.querySelectorAll('.pick-tile').forEach((el) => {
      el.classList.toggle('on', chosen.has(el.dataset.id));
    });
    $('#pick-count').textContent = `${chosen.size}/${HAND_SIZE}`;
  };
  openModal(`
    <h3>🧪 Escolher minhas pedras</h3>
    <p class="small">Toque nas pedras que você quer receber (até ${HAND_SIZE}). As que faltarem e as mãos dos outros são sorteadas. A rodada atual é descartada sem pontuar e a nova vale normalmente.</p>
    <p class="pick-count">Escolhidas: <b id="pick-count">0/${HAND_SIZE}</b></p>
    <div class="pick-grid">${deck.map((t) => `<button class="pick-tile" data-id="${tileId(t)}" aria-label="Pedra ${t[0]} e ${t[1]}">${singleTileSvg(t, false)}</button>`).join('')}</div>
    <button class="primary" id="deal-btn">Dar as pedras</button>
    <button id="pick-cancel">Cancelar</button>
  `, () => {
    modalBody.querySelectorAll('.pick-tile').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        if (chosen.has(id)) chosen.delete(id);
        else if (chosen.size < HAND_SIZE) chosen.add(id);
        paint();
      });
    });
    $('#pick-cancel').addEventListener('click', () => (onClose ? onClose() : closeModal()));
    $('#deal-btn').addEventListener('click', () => {
      const tiles = [...chosen];
      selectedId = null;
      resultShownFor = null;
      if (mode === 'local') localEngine.redeal(0, tiles);
      else session.redealMe(tiles);
      closeModal();
      if (mode === 'local') localEngine.resume();
    });
  });
}

function showRules(onClose) {
  openModal(`
    <h3>Como jogar</h3>
    <div class="rules">
      <p>Quatro jogadores em duas duplas. Seu parceiro senta à sua frente. Cada um recebe 7 pedras e não há monte.</p>
      <p>A primeira rodada começa com quem tem a <b>bucha de sena (6|6)</b>. Nas seguintes, quem venceu a rodada anterior começa com qualquer pedra. A vez passa para quem está à sua direita.</p>
      <p>Na sua vez, encaixe uma pedra numa das pontas. Sem pedra que sirva, você passa.</p>
      <p><b>Pontos</b> de quem bate (fica sem pedras):</p>
      <ul>
        <li>Batida simples — 1 ponto</li>
        <li>De bucha (bater com pedra dobrada) — 2 pontos</li>
        <li>Nas duas pontas (pedra comum que encaixa nas duas pontas, ex.: pontas 3 e 5, bate com 3|5) — 2 pontos</li>
        <li>Gambuada (bucha que serve nas duas pontas) — 4 pontos</li>
      </ul>
      <p><b>Jogo trancado:</b> se ninguém consegue jogar, somam-se os pontos das pedras de cada dupla e quem tiver menos ganha 1 ponto. Empate não pontua.</p>
      <p>Vence a dupla que fizer <b>4 pontos</b> primeiro.</p>
      <p class="small">Toque numa pedra para jogar. Se ela servir nas duas pontas, escolha o lado nas setas da mesa ou nos botões.</p>
    </div>
    <button class="primary" id="back-btn">Entendi</button>
  `, () => {
    $('#back-btn').addEventListener('click', () => {
      closeModal();
      onClose?.();
    });
  });
}

modal.addEventListener('cancel', (e) => {
  // O fim de rodada precisa do botão; o resto fecha normalmente.
  if (currentView()?.result) e.preventDefault();
});

// ---------- Início ----------
function myName() {
  const input = $('#name-input');
  const name = input.value.replace(/\s+/g, ' ').trim().slice(0, 14);
  if (name) saveJson(KEYS.name, name);
  return name || 'Você';
}

function homeMessage(text) {
  $('#home-msg').textContent = text;
}

function showHome(message = '') {
  show('home');
  homeMessage(message);
  $('#name-input').value = loadJson(KEYS.name) ?? '';

  const saved = loadJson(KEYS.session);
  const resumeBtn = $('#resume-btn');
  const localSaved = loadJson(KEYS.match);
  if (saved?.code) {
    resumeBtn.hidden = false;
    resumeBtn.textContent = `↩ Voltar para a sala ${saved.code}`;
    resumeBtn.onclick = () => startOnline(saved.role, saved.code);
  } else if (localSaved?.round && localSaved.winner === null) {
    resumeBtn.hidden = false;
    resumeBtn.textContent = '↩ Continuar partida contra o computador';
    resumeBtn.onclick = () => startLocal(true);
  } else {
    resumeBtn.hidden = true;
  }
}

function requireName() {
  const input = $('#name-input');
  if (input.value.trim()) return true;
  homeMessage('Escreva seu nome para jogar online.');
  input.focus();
  return false;
}

$('#local-btn').addEventListener('click', () => {
  saveJson(KEYS.match, null);
  startLocal(false);
});
$('#host-btn').addEventListener('click', () => {
  if (!requireName()) return;
  saveJson(KEYS.session, null);
  startOnline('host');
});
$('#join-btn').addEventListener('click', async () => {
  if (!requireName()) return;
  const net = await online();
  const code = net.normalizeCode($('#code-input').value);
  if (!code) {
    homeMessage('Código inválido: são 5 letras/números.');
    return;
  }
  startOnline('client', code);
});
$('#name-input').addEventListener('input', () => myName());
$('#code-input').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase();
});
$('#home-rules-btn').addEventListener('click', () => showRules());
$('#menu-btn').addEventListener('click', showMenu);

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const view = currentView();
    if (view) renderBoard(view);
  }, 120);
});

document.addEventListener('visibilitychange', () => {
  const visible = document.visibilityState === 'visible';
  if (mode === 'online') {
    session?.setPaused?.(!visible);
    if (visible) keepAwake(true);
  }
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Link de convite: ?sala=CODIGO
const params = new URLSearchParams(location.search);
const invited = params.get('sala');
if (params.has('teste')) {
  saveJson(KEYS.admin, params.get('teste') === '1' ? true : null);
  params.delete('teste');
  history.replaceState(null, '', `${location.pathname}${params.toString() ? `?${params}` : ''}`);
}
showHome(isAdmin() ? '🧪 Modo teste ativado (menu ☰ → Escolher minhas pedras)' : '');
if (invited) {
  $('#code-input').value = invited.toUpperCase().slice(0, 5);
  if ($('#name-input').value.trim()) $('#join-btn').click();
  else homeMessage('Escreva seu nome e toque em Entrar.');
}
