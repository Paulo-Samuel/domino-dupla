// Regras do dominó em dupla (estilo brasileiro, 4 jogadores, sem monte).
// Este módulo é puro: não toca em DOM nem em armazenamento.

export const TARGET_SCORE = 4;
export const PLAYER_COUNT = 4;
export const HAND_SIZE = 7;
export const TOTAL_PIPS = 168;

export const POINTS = {
  simples: 1,
  bucha: 2,
  duasPontas: 2,
  gambuada: 4,
  trancado: 1,
};

export const teamOf = (player) => player % 2;
export const partnerOf = (player) => (player + 2) % PLAYER_COUNT;
export const nextPlayer = (player) => (player + 1) % PLAYER_COUNT;

export const isDouble = (tile) => tile[0] === tile[1];
export const pipsOf = (tile) => tile[0] + tile[1];
export const tileId = (tile) => `${Math.min(tile[0], tile[1])}-${Math.max(tile[0], tile[1])}`;
export const sameTile = (a, b) => tileId(a) === tileId(b);
export const handPips = (hand) => hand.reduce((sum, tile) => sum + pipsOf(tile), 0);

export function createDeck() {
  const deck = [];
  for (let a = 0; a <= 6; a++) {
    for (let b = a; b <= 6; b++) deck.push([a, b]);
  }
  return deck;
}

export function shuffle(items, rng = Math.random) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function sortHand(hand) {
  return hand.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
}

export function createMatch() {
  return {
    scores: [0, 0],
    roundNo: 0,
    // null = a primeira rodada começa com quem tiver a bucha de sena (6-6).
    starter: null,
    round: null,
    winner: null,
  };
}

// preset (modo teste): { seat, tiles: ['6-6', '3-5', ...] } escolhe as
// pedras de um jogador; o que faltar até 7 e as outras mãos saem no sorteio.
export function startRound(match, rng = Math.random, { preset = null } = {}) {
  let deck = shuffle(createDeck(), rng);
  const hands = [[], [], [], []];
  if (preset) {
    const wanted = new Set(preset.tiles.slice(0, HAND_SIZE));
    hands[preset.seat] = deck.filter((t) => wanted.has(tileId(t)));
    deck = deck.filter((t) => !wanted.has(tileId(t)));
  }
  for (let p = 0; p < PLAYER_COUNT; p++) {
    while (hands[p].length < HAND_SIZE) hands[p].push(deck.pop());
    hands[p] = sortHand(hands[p]);
  }

  let turn = match.starter;
  let mustOpenWith = null;
  if (turn === null) {
    turn = hands.findIndex((hand) => hand.some((t) => t[0] === 6 && t[1] === 6));
    mustOpenWith = '6-6';
  }

  match.roundNo += 1;
  match.round = {
    hands,
    board: null,
    turn,
    mustOpenWith,
    passed: [[], [], [], []],
    lastAction: null,
    result: null,
    // Conta as ações da rodada; a interface usa para saber o que é novidade.
    seq: 0,
    test: !!preset,
  };
  return match;
}

export function boardEnds(board) {
  if (!board) return null;
  const left = board.left.length ? board.left[board.left.length - 1].outer : board.center[0];
  const right = board.right.length ? board.right[board.right.length - 1].outer : board.center[1];
  return [left, right];
}

export function boardTiles(board) {
  if (!board) return [];
  return [board.center, ...board.left.map((p) => p.tile), ...board.right.map((p) => p.tile)];
}

export function legalMoves(round, player) {
  return legalMovesFor(round.hands[player], round.board, round.mustOpenWith);
}

export function legalMovesFor(hand, board, mustOpenWith = null) {
  if (!board) {
    return hand
      .filter((tile) => !mustOpenWith || tileId(tile) === mustOpenWith)
      .map((tile) => ({ tile, side: 'center' }));
  }

  const [left, right] = boardEnds(board);
  const moves = [];
  for (const tile of hand) {
    const fitsLeft = tile.includes(left);
    const fitsRight = tile.includes(right);
    if (left === right) {
      // As duas pontas são iguais: o lado não muda o jogo, só o desenho da mesa.
      if (fitsLeft) {
        const side = board.left.length < board.right.length ? 'left' : 'right';
        moves.push({ tile, side });
      }
      continue;
    }
    if (fitsLeft) moves.push({ tile, side: 'left' });
    if (fitsRight) moves.push({ tile, side: 'right' });
  }
  return moves;
}

export function canPlay(round, player) {
  return legalMoves(round, player).length > 0;
}

function placeTile(board, tile, side) {
  if (side === 'center') return { center: tile.slice(), left: [], right: [] };
  const [left, right] = boardEnds(board);
  const end = side === 'left' ? left : right;
  const outer = tile[0] === end ? tile[1] : tile[0];
  board[side].push({ tile: tile.slice(), inner: end, outer });
  return board;
}

// Classifica a batida a partir das pontas ANTES da última pedra:
// bucha (pedra dobrada) vale 2; bucha que serve nas duas pontas é gambuada (4);
// pedra comum que encaixa nas duas pontas (pontas 3 e 5, bate com 3|5) vale 2.
export function classifyFinish(ends, tile) {
  if (!ends) return 'simples';
  const [left, right] = ends;
  if (isDouble(tile)) return tile[0] === left && tile[0] === right ? 'gambuada' : 'bucha';
  if (left !== right && tile.includes(left) && tile.includes(right)) return 'duasPontas';
  return 'simples';
}

function isBlocked(round) {
  for (let p = 0; p < PLAYER_COUNT; p++) {
    if (round.hands[p].length && canPlay(round, p)) return false;
  }
  return true;
}

export function playMove(match, player, move) {
  const round = match.round;
  if (!round || round.result) throw new Error('Rodada encerrada');
  if (round.turn !== player) throw new Error('Não é a vez deste jogador');

  const legal = legalMoves(round, player).some(
    (m) => sameTile(m.tile, move.tile) && m.side === move.side,
  );
  if (!legal) throw new Error('Jogada inválida');

  const hand = round.hands[player];
  const index = hand.findIndex((t) => sameTile(t, move.tile));
  const tile = hand[index];
  const endsBefore = boardEnds(round.board);

  hand.splice(index, 1);
  round.board = placeTile(round.board, tile, move.side);
  round.mustOpenWith = null;
  round.lastAction = { player, type: 'play', tile: tile.slice(), side: move.side };
  round.seq += 1;

  if (hand.length === 0) {
    finishRound(match, {
      type: classifyFinish(endsBefore, tile),
      player,
      team: teamOf(player),
      tile: tile.slice(),
    });
    return match;
  }

  if (isBlocked(round)) {
    finishBlocked(match, player);
    return match;
  }

  round.turn = nextPlayer(player);
  return match;
}

export function passTurn(match, player) {
  const round = match.round;
  if (!round || round.result) throw new Error('Rodada encerrada');
  if (round.turn !== player) throw new Error('Não é a vez deste jogador');
  if (canPlay(round, player)) throw new Error('Jogador tem pedra para jogar');

  for (const end of new Set(boardEnds(round.board) ?? [])) {
    if (!round.passed[player].includes(end)) round.passed[player].push(end);
  }
  round.lastAction = { player, type: 'pass' };
  round.seq += 1;
  round.turn = nextPlayer(player);
  return match;
}

function finishBlocked(match, lockedBy) {
  const hands = match.round.hands;
  const teamPips = [0, 1].map((team) => handPips(hands[team]) + handPips(hands[team + 2]));
  let team = null;
  if (teamPips[0] < teamPips[1]) team = 0;
  else if (teamPips[1] < teamPips[0]) team = 1;

  let player = lockedBy;
  if (team !== null) {
    // Quem começa a próxima é o jogador com menos pontos na dupla vencedora.
    player = handPips(hands[team]) <= handPips(hands[team + 2]) ? team : team + 2;
  }
  finishRound(match, { type: 'trancado', player, team, teamPips, lockedBy });
}

function finishRound(match, result) {
  const points = result.team === null ? 0 : POINTS[result.type];
  if (result.team !== null) match.scores[result.team] += points;
  match.round.result = { ...result, points };
  match.round.turn = null;
  match.starter = result.player;
  if (match.scores[0] >= TARGET_SCORE) match.winner = 0;
  else if (match.scores[1] >= TARGET_SCORE) match.winner = 1;
  return match;
}
