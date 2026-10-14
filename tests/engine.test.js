import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../js/engine.js';
import { tileId } from '../js/game.js';

const seats = () => [0, 1, 2, 3].map((i) => ({ kind: 'human', name: `J${i}`, online: true }));

test('a visão de um lugar só mostra a própria mão', () => {
  const engine = new GameEngine({ seats: seats() });
  engine.begin();
  engine.pause();
  const view = engine.view(1);
  assert.equal(view.seat, 1);
  assert.deepEqual(view.hand.map(tileId), engine.match.round.hands[1].map(tileId).sort());
  assert.deepEqual(view.counts, [7, 7, 7, 7]);
  assert.equal(JSON.stringify(view).includes('"hands"'), false);
});

test('só aceita jogada de quem tem a vez e da rodada atual', () => {
  const engine = new GameEngine({ seats: seats() });
  engine.begin();
  engine.pause();
  const round = engine.match.round;
  const turn = round.turn;
  const move = { tile: [6, 6], side: 'center' };
  assert.equal(engine.play((turn + 1) % 4, move), false);
  assert.equal(engine.play(turn, move, round.seq + 1), false);
  assert.equal(engine.play(turn, move, round.seq), true);
  engine.pause();
  assert.equal(engine.play(turn, move, 0), false); // clique repetido
});

test('robô joga no lugar de quem caiu, depois da tolerância', async () => {
  const s = seats();
  const engine = new GameEngine({ seats: s, delay: 5, offlineGrace: 30 });
  engine.begin();
  const turn = engine.match.round.turn;
  engine.setOnline(turn, false);
  await new Promise((r) => setTimeout(r, 80));
  engine.pause();
  assert.ok(engine.match.round.seq >= 1);
});

test('modo teste: redistribui com as pedras escolhidas sem pontuar a rodada descartada', () => {
  const engine = new GameEngine({ seats: seats() });
  engine.begin();
  engine.pause();
  engine.redeal(0, ['3-3', '2-5', '1-4']);
  engine.pause();
  const view = engine.view(0);
  assert.equal(view.roundNo, 1);
  assert.equal('test' in view, false); // nada indica aos outros que as pedras foram escolhidas
  for (const id of ['3-3', '2-5', '1-4']) assert.ok(view.hand.map(tileId).includes(id));
  assert.deepEqual(view.scores, [0, 0]);
});
