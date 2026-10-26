import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardSvg, layoutBoard } from '../js/board.js';

// Braços aleatórios: só o formato importa (duplas ocupam meia largura).
function randomBoard(rnd) {
  const arm = (len) => Array.from({ length: len }, () => {
    const a = Math.floor(rnd() * 7);
    return { inner: a, outer: rnd() < 0.2 ? a : (a + 1 + Math.floor(rnd() * 6)) % 7 };
  });
  const c = Math.floor(rnd() * 7);
  return { center: [c, rnd() < 0.3 ? c : (c + 1) % 7], left: arm(Math.floor(rnd() * 14)), right: arm(Math.floor(rnd() * 14)) };
}

function seeded(seed) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

test('a cobra nunca sobrepõe pedras, em qualquer largura de fileira', () => {
  const rnd = seeded(7);
  for (let k = 0; k < 500; k++) {
    const board = randomBoard(rnd);
    for (let hw = 3; hw <= 10; hw++) {
      const { tiles } = layoutBoard(board, hw);
      for (let i = 0; i < tiles.length; i++) {
        for (let j = i + 1; j < tiles.length; j++) {
          const A = tiles[i], B = tiles[j];
          const overlap = A.x < B.x + B.w - 1e-6 && B.x < A.x + A.w - 1e-6
            && A.y < B.y + B.h - 1e-6 && B.y < A.y + A.h - 1e-6;
          assert.ok(!overlap, `hw=${hw}: ${JSON.stringify(A)} x ${JSON.stringify(B)}`);
        }
      }
    }
  }
});

test('a mesa desenha todas as pedras e enquadra tudo', () => {
  const board = randomBoard(seeded(3));
  const svg = boardSvg(board, { halfWidth: 4, aspect: 0.7 });
  const count = (svg.match(/class="tile /g) ?? []).length;
  assert.equal(count, 1 + board.left.length + board.right.length);
  assert.match(svg, /viewBox="[-\d. ]+"/);
});
