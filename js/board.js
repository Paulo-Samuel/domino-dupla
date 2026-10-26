// Desenho da mesa em "cobra": a pedra inicial fica no centro, o braço direito
// cresce para a direita e desce, o esquerdo cresce para a esquerda e sobe.
// Unidade: 1 = largura de uma pedra deitada / 2.

const PIP_SPOTS = {
  0: [],
  1: [[0.5, 0.5]],
  2: [[0.25, 0.25], [0.75, 0.75]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]],
  5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.25, 0.22], [0.75, 0.22], [0.25, 0.5], [0.75, 0.5], [0.25, 0.78], [0.75, 0.78]],
};

// Estilos de pedra. "marfim": pedra clara com pintas coloridas escuras.
// "caramelo": igual ao jogo de bar, pedra cor de caramelo, risco branco com
// pino de metal e pintas 1 branca, 2 preta, 3 azul, 4 verde, 5 amarela e
// 6 vermelha. `pips[0]` é só a cor do número 0 nos selos (não tem pinta).
export const TILE_THEMES = {
  marfim: {
    body: '#fbf7ec', edge: '#d9d0b8', fresh: '#fff3c4', divider: '#9b917a', pin: null, plain: '#1d1b18',
    pips: { 0: '#1d1b18', 1: '#d62839', 2: '#1e63c4', 3: '#1f8a4c', 4: '#e07a00', 5: '#7b3fb8', 6: '#7a4a1e' },
  },
  caramelo: {
    body: '#b98858', edge: '#8a5f36', fresh: '#d9a874', divider: '#f4efe4', pin: '#c9ccd2', plain: '#1b1b1b',
    pips: { 0: '#3a2614', 1: '#f7f4ec', 2: '#1b1b1b', 3: '#1f5fd6', 4: '#2fb84a', 5: '#f5b70f', 6: '#c8102e' },
  },
};
export const PIP_COLORS = TILE_THEMES.marfim.pips;
let theme = TILE_THEMES.marfim;
let coloredPips = true;
export function setColoredPips(on) {
  coloredPips = !!on;
}
export function setTileTheme(name) {
  theme = TILE_THEMES[name] ?? TILE_THEMES.marfim;
  return theme;
}
export const pipColor = (value) => (coloredPips ? theme.pips[value] : theme.plain);

function layoutArm(arm, opts) {
  const { xMin, xMax, vdir } = opts;
  let { x, y, dir } = opts;
  let afterTurn = false;
  const placed = [];

  for (const piece of arm) {
    const { inner, outer } = piece;
    const dbl = inner === outer;
    const w = dbl && !afterTurn ? 1 : 2;
    const fits = dir > 0 ? x + w <= xMax - 1 : x - w >= xMin + 1;

    if (!fits && !afterTurn) {
      // Pedra de curva: em pé, encostada na ponta da fileira.
      const tx = dir > 0 ? x : x - 1;
      const top = vdir > 0 ? y - 0.5 : y - 1.5;
      placed.push({
        piece, x: tx, y: top, w: 1, h: 2,
        a: vdir > 0 ? inner : outer,
        b: vdir > 0 ? outer : inner,
      });
      y += vdir * 2;
      dir = -dir;
      x = dir < 0 ? tx + 1 : tx;
      afterTurn = true;
      continue;
    }

    if (dbl && !afterTurn) {
      placed.push({ piece, x: dir > 0 ? x : x - 1, y: y - 1, w: 1, h: 2, a: inner, b: outer });
    } else {
      placed.push({
        piece, x: dir > 0 ? x : x - 2, y: y - 0.5, w: 2, h: 1,
        a: dir > 0 ? inner : outer,
        b: dir > 0 ? outer : inner,
      });
    }
    x += dir * w;
    afterTurn = false;
  }

  return { placed, anchor: { x: x + dir * 0.75, y } };
}

export function layoutBoard(board, halfWidth = 7) {
  if (!board) return { tiles: [], anchors: null, bbox: { x: -3, y: -2, w: 6, h: 4 } };

  const [c0, c1] = board.center;
  const centerDouble = c0 === c1;
  const center = centerDouble
    ? { x: -0.5, y: -1, w: 1, h: 2, a: c0, b: c1 }
    : { x: -1, y: -0.5, w: 2, h: 1, a: c0, b: c1 };
  const edge = centerDouble ? 0.5 : 1;

  const right = layoutArm(board.right, { x: edge, y: 0, dir: 1, vdir: 1, xMin: -halfWidth, xMax: halfWidth });
  const left = layoutArm(board.left, { x: -edge, y: 0, dir: -1, vdir: -1, xMin: -halfWidth, xMax: halfWidth });

  const tiles = [center, ...left.placed, ...right.placed];
  const anchors = { left: left.anchor, right: right.anchor };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x0, y0, x1, y1) => {
    minX = Math.min(minX, x0); minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1); maxY = Math.max(maxY, y1);
  };
  for (const t of tiles) grow(t.x, t.y, t.x + t.w, t.y + t.h);
  for (const a of Object.values(anchors)) grow(a.x - 0.6, a.y - 0.6, a.x + 0.6, a.y + 0.6);

  return { tiles, anchors, bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}

function pipsSvg(value, x, y, size) {
  const r = size * 0.1;
  const fill = pipColor(value);
  return PIP_SPOTS[value]
    .map(([px, py]) => `<circle class="pip" fill="${fill}" cx="${x + px * size}" cy="${y + py * size}" r="${r}"/>`)
    .join('');
}

// Desenha uma pedra no sistema de coordenadas atual (a = metade esquerda/de cima).
// As cores vão também como atributos do SVG, para a pedra aparecer mesmo se o
// CSS falhar; a sombra é um retângulo (o Safari pode sumir com elementos SVG
// que usam filter: drop-shadow).
export function tileSvg({ x, y, w, h, a, b }, extraClass = '') {
  const vertical = h > w;
  const half = vertical ? w : h;
  const inset = half * 0.06;
  const ax = x, ay = y;
  const bx = vertical ? x : x + half;
  const by = vertical ? y + half : y;
  const divider = vertical
    ? `<line class="divider" stroke="${theme.divider}" stroke-width="${half * 0.045}" x1="${x + half * 0.15}" y1="${y + half}" x2="${x + w - half * 0.15}" y2="${y + half}"/>`
    : `<line class="divider" stroke="${theme.divider}" stroke-width="${half * 0.045}" x1="${x + half}" y1="${y + half * 0.15}" x2="${x + half}" y2="${y + h - half * 0.15}"/>`;
  const pin = theme.pin
    ? `<circle class="pin" fill="${theme.pin}" stroke="#6b6f76" stroke-width="${half * 0.02}" cx="${vertical ? x + w / 2 : x + half}" cy="${vertical ? y + half : y + h / 2}" r="${half * 0.08}"/>`
    : '';
  const fresh = extraClass.includes('fresh');
  const body = `x="${x + inset / 2}" y="${y + inset / 2}" width="${w - inset}" height="${h - inset}" rx="${half * 0.14}"`;
  return `<g class="tile ${extraClass}">
    <rect class="tile-shadow" fill="rgba(0,0,0,.35)" transform="translate(0 ${half * 0.05})" ${body}/>
    <rect class="tile-body" fill="${fresh ? theme.fresh : theme.body}" stroke="${fresh ? '#ffd166' : theme.edge}" stroke-width="${half * (fresh ? 0.06 : 0.04)}" ${body}/>
    ${divider}${pin}
    ${pipsSvg(a, ax, ay, half)}${pipsSvg(b, bx, by, half)}
  </g>`;
}

// anchors: lados ('left'/'right') onde a pedra escolhida pode encaixar; cada
// um mostra o número da ponta. ends: [esquerda, direita] da mesa.
// Quantas meias-pedras cabem em cada fileira da cobra, e o enquadramento.
function frame(board, halfWidth, aspect) {
  const layout = layoutBoard(board, halfWidth);
  const pad = 0.25;
  const { bbox } = layout;
  // Enquadra a cobra com folga: no começo as pedras ficam grandes e a mesa
  // vai afastando a câmera conforme cresce (nunca mais perto que ~3 pedras).
  const minW = Math.min(halfWidth * 2, 6) + pad * 2;
  const needW = Math.max(minW, bbox.w + pad * 2);
  const needH = bbox.h + pad * 2;
  const vw = Math.max(needW, needH * aspect);
  return { layout, vw, vh: vw / aspect };
}

export function boardSvg(board, { halfWidth = 7, aspect = 1, freshId, anchors: showAnchors, ends = null } = {}) {
  // Escolhe a largura de fileira que deixa as pedras maiores na mesa atual
  // (no empate, fica a mais perto da sugerida, para a cobra mudar pouco).
  let best = null;
  for (let hw = 3; hw <= 10; hw++) {
    const f = frame(board, hw, aspect);
    const better = !best || f.vw < best.vw - 0.01
      || (Math.abs(f.vw - best.vw) <= 0.01 && Math.abs(hw - halfWidth) < Math.abs(best.hw - halfWidth));
    if (better) best = { ...f, hw };
  }
  const { layout, vw, vh } = best;
  const { bbox } = layout;
  const cx = bbox.x + bbox.w / 2;
  const cy = bbox.y + bbox.h / 2;
  const viewBox = `${cx - vw / 2} ${cy - vh / 2} ${vw} ${vh}`;

  const tiles = layout.tiles
    .map((t) => {
      const id = `${Math.min(t.a, t.b)}-${Math.max(t.a, t.b)}`;
      return tileSvg(t, id === freshId ? 'fresh' : '');
    })
    .join('');

  let anchorMarkup = '';
  if (showAnchors && layout.anchors) {
    anchorMarkup = showAnchors
      .map((side) => {
        const { x, y } = layout.anchors[side];
        const value = ends ? ends[side === 'left' ? 0 : 1] : null;
        const label = value === null ? (side === 'left' ? '◀' : '▶') : value;
        const color = value === null ? '#ffd166' : pipColor(value);
        return `<g class="anchor" data-side="${side}">
          <circle class="anchor-ring" cx="${x}" cy="${y}" r="0.62" stroke="${color}"/>
          <circle class="anchor-dot" cx="${x}" cy="${y}" r="0.42" fill="${color}"/>
          <text x="${x}" y="${y}">${label}</text>
        </g>`;
      })
      .join('');
  }

  return `<svg class="board-svg" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${tiles}${anchorMarkup}</svg>`;
}

export function singleTileSvg(tile, vertical = true) {
  const box = vertical ? { x: 0, y: 0, w: 1, h: 2 } : { x: 0, y: 0, w: 2, h: 1 };
  // width fixo é só o tamanho reserva sem CSS; o CSS usa width 100% e altura automática.
  return `<svg width="${box.w * 20}" viewBox="0 0 ${box.w} ${box.h}" xmlns="http://www.w3.org/2000/svg">${tileSvg({ ...box, a: tile[0], b: tile[1] })}</svg>`;
}
