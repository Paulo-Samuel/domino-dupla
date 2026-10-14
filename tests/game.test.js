import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_DOUBLES,
  POINTS,
  canAct,
  countDoubles,
  handOverOpening,
  sanitizePreset,
  TARGET_SCORE,
  boardEnds,
  boardTiles,
  classifyFinish,
  createDeck,
  createMatch,
  legalMoves,
  passTurn,
  playMove,
  startRound,
  tileId,
} from '../js/game.js';
import { chooseMove } from '../js/ai.js';
import { layoutBoard } from '../js/board.js';

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function playRound(match, rng) {
  let guard = 0;
  while (!match.round.result) {
    const p = match.round.turn;
    const move = chooseMove(match.round, p, { rng });
    if (move) playMove(match, p, move);
    else passTurn(match, p);
    if (++guard > 200) throw new Error('rodada não terminou');
  }
  return match.round.result;
}

test('baralho tem 28 pedras únicas e 168 pontos', () => {
  const deck = createDeck();
  assert.equal(deck.length, 28);
  assert.equal(new Set(deck.map(tileId)).size, 28);
  assert.equal(deck.reduce((s, t) => s + t[0] + t[1], 0), 168);
});

test('primeira rodada começa obrigatoriamente com a carroça de sena', () => {
  const match = startRound(createMatch(), seeded(1));
  const { turn, hands } = match.round;
  assert.ok(hands[turn].some((t) => tileId(t) === '6-6'));
  const moves = legalMoves(match.round, turn);
  assert.deepEqual(moves.map((m) => tileId(m.tile)), ['6-6']);
});

test('classificação da batida', () => {
  assert.equal(classifyFinish([2, 5], [5, 4]), 'simples');
  assert.equal(classifyFinish([2, 5], [2, 5]), 'duasPontas');
  assert.equal(classifyFinish([2, 5], [5, 2]), 'duasPontas');
  assert.equal(POINTS.duasPontas, 2);
  assert.equal(classifyFinish([2, 5], [5, 5]), 'bucha');
  assert.equal(classifyFinish([3, 3], [3, 3]), 'gambuada');
  assert.equal(classifyFinish([3, 3], [3, 1]), 'simples');
  assert.equal(POINTS.bucha, 2);
  assert.equal(POINTS.gambuada, 4);
  assert.equal(TARGET_SCORE, 4);
});

test('jogada inválida é recusada', () => {
  const match = startRound(createMatch(), seeded(7));
  const p = match.round.turn;
  const wrong = match.round.hands[p].find((t) => tileId(t) !== '6-6');
  assert.throws(() => playMove(match, p, { tile: wrong, side: 'center' }));
  assert.throws(() => playMove(match, (p + 1) % 4, { tile: [6, 6], side: 'center' }));
});

test('não pode passar tendo pedra que serve', () => {
  const match = startRound(createMatch(), seeded(3));
  assert.throws(() => passTurn(match, match.round.turn));
});

test('pontas acompanham as pedras encaixadas', () => {
  const match = createMatch();
  match.roundNo = 1;
  match.round = {
    hands: [[[6, 6], [6, 2]], [[1, 1], [0, 0]], [[2, 4], [5, 5]], [[3, 3], [4, 4]]],
    board: null, turn: 0, mustOpenWith: null, passed: [[], [], [], []], lastAction: null, result: null, seq: 0,
  };
  playMove(match, 0, { tile: [6, 6], side: 'center' });
  assert.deepEqual(boardEnds(match.round.board), [6, 6]);
  passTurn(match, 1);
  assert.deepEqual(match.round.passed[1], [6]);
});

test('batida pontua para a dupla e define quem começa a próxima', () => {
  const match = createMatch();
  match.roundNo = 1;
  match.round = {
    hands: [[[1, 2]], [[0, 0], [3, 3]], [[4, 4], [5, 5]], [[6, 6], [0, 1]]],
    board: { center: [2, 5], left: [], right: [] },
    turn: 0, mustOpenWith: null, passed: [[], [], [], []], lastAction: null, result: null, seq: 0,
  };
  playMove(match, 0, { tile: [1, 2], side: 'left' });
  assert.equal(match.round.result.type, 'simples');
  assert.deepEqual(match.scores, [POINTS.simples, 0]);
  assert.equal(match.starter, 0);
});

test('jogo trancado: dupla com menos pontos ganha', () => {
  const match = createMatch();
  match.roundNo = 1;
  // Pontas ficam 0 e 0 depois da jogada; ninguém tem 0.
  match.round = {
    hands: [[[4, 0], [1, 1]], [[6, 6], [5, 5]], [[1, 2], [2, 2]], [[3, 3], [5, 6]]],
    board: { center: [0, 4], left: [], right: [] },
    turn: 0, mustOpenWith: null, passed: [[], [], [], []], lastAction: null, result: null, seq: 0,
  };
  playMove(match, 0, { tile: [4, 0], side: 'right' });
  const res = match.round.result;
  assert.equal(res.type, 'trancado');
  assert.equal(res.team, 0);
  assert.deepEqual(match.scores, [1, 0]);
});

test('partidas inteiras simuladas terminam e conservam as 28 pedras', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rng = seeded(seed);
    const match = createMatch();
    let rounds = 0;
    while (match.winner === null) {
      startRound(match, rng);
      playRound(match, rng);
      const onTable = boardTiles(match.round.board).length;
      const inHands = match.round.hands.reduce((s, h) => s + h.length, 0);
      assert.equal(onTable + inHands, 28);
      if (++rounds > 60) throw new Error('partida não terminou');
    }
    assert.ok(Math.max(...match.scores) >= TARGET_SCORE);
  }
});

test('layout da mesa não sobrepõe pedras', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = seeded(seed * 31);
    const match = startRound(createMatch(), rng);
    playRound(match, rng);
    for (const halfWidth of [6, 7, 9, 12]) {
      const { tiles } = layoutBoard(match.round.board, halfWidth);
      for (let i = 0; i < tiles.length; i++) {
        for (let j = i + 1; j < tiles.length; j++) {
          const a = tiles[i], b = tiles[j];
          const overlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-9
            && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-9;
          assert.ok(!overlap, `pedras ${i} e ${j} sobrepostas (seed ${seed}, largura ${halfWidth})`);
        }
      }
    }
  }
});

test('modo teste: o jogador recebe as pedras escolhidas', () => {
  const match = createMatch();
  startRound(match, seeded(5), { preset: { seat: 2, tiles: ['6-6', '5-5', '0-1'] } });
  const ids = match.round.hands[2].map(tileId);
  for (const id of ['6-6', '5-5', '0-1']) assert.ok(ids.includes(id));
  assert.equal(match.round.hands.every((h) => h.length === 7), true);
  const all = match.round.hands.flat().map(tileId);
  assert.equal(new Set(all).size, 28);
  assert.equal(match.round.turn, 2); // tem a 6|6
});

test('ninguém recebe mais de 4 buchas', () => {
  const rng = seeded(99);
  for (let i = 0; i < 3000; i++) {
    const match = startRound(createMatch(), rng);
    for (const hand of match.round.hands) assert.ok(countDoubles(hand) <= MAX_DOUBLES);
  }
});

test('modo teste limita a escolha a 4 buchas e 7 pedras', () => {
  const doubles = ['0-0', '1-1', '2-2', '3-3', '4-4', '5-5', '6-6'];
  assert.deepEqual(sanitizePreset([...doubles, '1-2']), ['0-0', '1-1', '2-2', '3-3', '1-2']);
  assert.equal(sanitizePreset(['2-1', '1-2', 'x', '9-9']).length, 1);
  const match = createMatch();
  startRound(match, seeded(4), { preset: { seat: 0, tiles: doubles } });
  assert.equal(countDoubles(match.round.hands[0]), MAX_DOUBLES);
});

test('depois da primeira rodada, a dupla vencedora sai com qualquer um dos parceiros', () => {
  const match = createMatch();
  match.starter = 1; // Beto bateu na rodada anterior
  startRound(match, seeded(8));
  const round = match.round;
  assert.deepEqual(round.openers, [1, 3]);
  assert.ok(canAct(round, 1) && canAct(round, 3));
  assert.ok(!canAct(round, 0) && !canAct(round, 2));
  assert.throws(() => playMove(match, 0, { tile: round.hands[0][0], side: 'center' }));
  // O parceiro (3) sai; depois a vez segue para a direita dele (0).
  playMove(match, 3, { tile: round.hands[3][0], side: 'center' });
  assert.equal(round.turn, 0);
  assert.equal(round.openers, null);
  assert.ok(!canAct(round, 1));
});

test('na saída, um parceiro pode deixar o outro sair', () => {
  const match = createMatch();
  match.starter = 2;
  startRound(match, seeded(9));
  handOverOpening(match, 2);
  assert.equal(match.round.turn, 0);
  assert.equal(match.round.openers, null);
  assert.ok(!canAct(match.round, 2));
});
