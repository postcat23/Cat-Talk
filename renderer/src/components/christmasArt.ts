// 크리스마스 이벤트 효과(1.0.10)의 도트 그림: 가랜드·'MERRY CHRISTMAS' 글자·트리 별·선물상자. Cat Talk에서 직접 설계한 도트 격자를
// 코드로 그린다(스톡 이미지를 베끼지 않는다 — 사용자 명세. 예시는 '솔가지가 풍성하고 오너먼트가 줄에 늘어진' 구성만 참고했다).
// 트리 본체만 사용자 제공 PNG(assets/white-tree.png)다.
// 각 그림은 SVG data URI(점 하나 = dot px 정사각형, crispEdges)라 크기를 바꿔도 점이 뭉개지지 않는다.

type Grid = (string | null)[][];   // [y][x] = 색(없으면 투명)

function toSvg(grid: Grid, dot: number): { uri: string; width: number; height: number } {
  const h = grid.length, w = grid[0]?.length ?? 0;
  let rects = '';
  grid.forEach((row, y) => {
    for (let x = 0; x < w;) {
      const color = row[x];
      let run = 1;
      while (x + run < w && row[x + run] === color) run++;
      if (color) rects += `<rect x="${x * dot}" y="${y * dot}" width="${run * dot}" height="${dot}" fill="${color}"/>`;
      x += run;
    }
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * dot}" height="${h * dot}" shape-rendering="crispEdges">${rects}</svg>`;
  return { uri: `data:image/svg+xml,${encodeURIComponent(svg)}`, width: w * dot, height: h * dot };
}

const blank = (w: number, h: number): Grid => Array.from({ length: h }, () => Array<string | null>(w).fill(null));
// 같은 입력이면 늘 같은 값(그릴 때마다 모양이 바뀌지 않게)
const hash = (x: number, y: number) => {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
const put = (g: Grid, x: number, y: number, color: string) => { if (g[y] && x >= 0 && x < g[y].length) g[y][x] = color; };
// 밖 1점 테두리(8방향): 비어 있고 이웃이 칠해진 칸
function outline(g: Grid, color: string): Grid {
  const out = g.map((row) => row.slice());
  for (let y = 0; y < g.length; y++) for (let x = 0; x < g[y].length; x++) {
    if (g[y][x]) continue;
    for (let dy = -1; dy <= 1 && !out[y][x]; dy++) for (let dx = -1; dx <= 1; dx++) if (g[y + dy]?.[x + dx]) { out[y][x] = color; break; }
  }
  return out;
}

// ── 가랜드(가장 처음 모양을 두툼하게, 사용자 결정 2026-11-24): 갈고리(타일 양 끝, 위)에서 늘어진 솔가지 한 자락(띠 6~7점) + 붉은 베리 +
// 가운데 빨간 오너먼트 + 이음매의 금빛 방울 + 밖 1점 어두운 테두리(리본처럼 — 사용자 지시 2026-11-24). 타일을 가로로 이어 붙인다(repeat-x).
// 테두리는 타일 좌우를 이어서 계산한다(이음매에 세로 선이 생기지 않게). 위아래 1점은 테두리 자리
const PINE = ['#123f1f', '#174d26', '#22703a', '#2f8f47', '#4fb35a'];   // 어두움 → 밝음
const GW = 32, GH = 16;
export function garlandTile(dot = 3) {
  const g = blank(GW, GH);
  const sag = (x: number) => 2.6 + 4.4 * Math.sin((Math.PI * x) / GW);
  let lowest = 0;
  for (let x = 0; x < GW; x++) {
    const c = sag(x);
    const top = Math.round(c - 2.8 - (hash(x, 1) < 0.4 ? 1 : 0));     // 위 솔잎 끝이 들쭉날쭉
    const bottom = Math.round(c + 3.2 + (hash(x, 2) < 0.45 ? 1 : 0));  // 아래 솔잎 끝
    for (let y = Math.max(0, top); y <= Math.min(GH - 1, bottom); y++) {
      const t = (y - top) / Math.max(1, bottom - top), r = hash(x, y + 7), stroke = (x + y * 2) % 5 === 0;   // t: 0 위(빛) → 1 아래(그늘)
      const shade = t < 0.25 ? (stroke ? 4 : r < 0.5 ? 4 : 3) : t < 0.55 ? (stroke ? 4 : r < 0.4 ? 3 : 2) : t < 0.8 ? (r < 0.45 ? 2 : 1) : (r < 0.5 ? 1 : 0);
      g[y][x] = PINE[shade];
    }
    if (hash(x, 99) < 0.45 && bottom + 1 < GH) g[bottom + 1][x] = PINE[1];   // 아래 솔잎 삐침
    lowest = Math.max(lowest, bottom);
  }
  // 베리 송이(2~3알 + 윤기)
  for (const [bx, dy] of [[6, 0], [7, -1], [7, 0], [8, 0], [24, 0], [25, -1], [25, 0], [26, 0], [12, 1], [13, 1], [20, 1], [19, 1]]) {
    const y = Math.round(sag(bx)) + dy - 1;
    if (y >= 0 && y < GH) g[y][bx] = '#d9252f';
  }
  for (const bx of [7, 25]) { const y = Math.round(sag(bx)) - 2; if (y >= 0) g[y][bx] = '#ff7a7f'; }
  // 가운데 오너먼트(빨강): 금빛 고리 1점 + 3×3 공(왼쪽 위 하이라이트, 아래 그늘)
  const ox = GW / 2, oy = Math.min(lowest, GH - 5) + 1;
  g[oy][ox] = '#f2b632';
  const ball = [['#ff8f8f', '#e8333c', '#c81f2a'], ['#e8333c', '#d7263d', '#a8141f'], ['#c81f2a', '#a8141f', '#7d0d16']];
  ball.forEach((row, y) => row.forEach((color, x) => { if (oy + 1 + y < GH) g[oy + 1 + y][ox - 1 + x] = color; }));
  // 이음매(갈고리) 금빛 방울 2×2
  [['#ffe08a', '#f2b632'], ['#f2b632', '#b97f12']].forEach((row, y) => row.forEach((color, x) => { g[2 + y][x] = color; }));
  // 밖 1점 테두리(좌우는 이어서, 위아래 1점 여백)
  const framed = blank(GW, GH + 2);
  g.forEach((row, y) => row.forEach((color, x) => { framed[y + 1][x] = color; }));
  const out = framed.map((row) => row.slice());
  for (let y = 0; y < GH + 2; y++) for (let x = 0; x < GW; x++) {
    if (framed[y][x]) continue;
    for (let dy = -1; dy <= 1 && !out[y][x]; dy++) for (let dx = -1; dx <= 1; dx++) if (framed[y + dy]?.[(x + dx + GW) % GW]) { out[y][x] = '#0e2614'; break; }
  }
  return toSvg(out, dot);
}

// ── 리본(사용자 예시 이미지의 구성·무늬, 2026-11-24 승인 — 원형으로 그리지 않는다): 초록 테두리·금빛 실선·빨강의 줄무늬 리본으로
// 쐐기 모양 위 고리(바깥으로 넓어지고 위로 들림, 가로 주름 아래는 안쪽 겹 그늘) + 뒤의 작은 아래 고리 + 가운데 매듭 + V자로 자른 꼬리 둘.
// 각 조각 = 매듭 쪽 o에서 바깥 e로 가는 중심선 + 폭(o쪽 hw0 → e쪽 hw1). 줄무늬는 조각 길이 방향을 따른다. 좌우 대칭(홀수 폭)
const BOW_BAND = ['#1f6b34', '#e9b949', '#d7263d', '#d7263d', '#e9b949', '#1f6b34'];   // 띠 단면(6칸)
const darken = (hex: string, k: number) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
interface BowPiece { o: [number, number]; e: [number, number]; hw0: number; hw1: number; shade?: number; fold?: number; cut?: 'v' }
export function pixelBow(dot = 3) {
  const W = 53, H = 38, cx = 26, ky = 12;
  const g = blank(W, H);
  const put2 = (x: number, y: number, color: string) => { put(g, x, y, color); put(g, 2 * cx - x, y, color); };
  const band = (s: number, shade: number) => {
    const c = BOW_BAND[Math.min(5, Math.max(0, Math.floor((s + 1) * 3)))];
    return shade ? darken(c, shade) : c;
  };
  const piece = ({ o, e, hw0, hw1, shade = 0, fold, cut }: BowPiece) => {
    const L = Math.hypot(e[0] - o[0], e[1] - o[1]), dx = (e[0] - o[0]) / L, dy = (e[1] - o[1]) / L;
    for (let y = 0; y < H; y++) for (let x = 0; x <= cx; x++) {
      const px = x - o[0], py = y - o[1], u = px * dx + py * dy, a = -px * dy + py * dx;
      if (u < -0.5 || u > L) continue;
      const hw = hw0 + (hw1 - hw0) * Math.max(0, u) / L;
      if (Math.abs(a) > hw) continue;
      if (cut === 'v' && u > L - 3.2 * (1 - Math.abs(a) / hw)) continue;   // 끝 V자 홈
      const s = a / hw;
      if (fold !== undefined && Math.abs(s - fold) < 0.09) { put2(x, y, '#6b0a16'); continue; }   // 주름선
      put2(x, y, band(s, fold !== undefined && s > fold ? 0.72 : shade));     // 주름 아래 = 안쪽 겹(그늘)
    }
  };
  // 뒤 → 앞: 꼬리, 아래 고리, 위 고리, 매듭
  piece({ o: [cx - 1, ky + 3], e: [cx - 12, ky + 22], hw0: 3, hw1: 3.6, cut: 'v' });
  piece({ o: [cx - 2, ky + 2], e: [cx - 18, ky + 6], hw0: 2.6, hw1: 5.5, shade: 0.8 });
  piece({ o: [cx - 2, ky - 1], e: [cx - 22, ky - 6], hw0: 3.2, hw1: 8.5, fold: 0.38 });
  for (let y = ky - 4; y <= ky + 4; y++) for (let x = cx - 3; x <= cx + 3; x++) put(g, x, y, band((x - cx) / 3.5, y >= ky + 3 ? 0.8 : 0));
  return toSvg(outline(g, '#2a0a0e'), dot);
}

// ── 글자: 5×7 도트 글꼴(필요한 글자만). 밖 1점 어두운 테두리, 위 3줄 밝은 색, 글자마다 맨 위 점에 눈(사용자 결정 2026-11-24 — 이 모양으로 복원)
const FONT: Record<string, string[]> = {
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
};
export interface TextColors { light: string; base: string; outline: string; snow: string }
export function pixelText(text: string, colors: TextColors, dot = 4) {
  const letters = [...text];
  const w = letters.length * 6 - 1 + 2, h = 7 + 2;   // 글자 사이 1점, 테두리 자리 1점씩
  const mask = blank(w, h);
  const snowAt = new Set<string>();
  letters.forEach((ch, i) => {
    const glyph = FONT[ch];
    if (!glyph) return;
    const x0 = 1 + i * 6;
    for (let gx = 0; gx < 5; gx++) {
      const gy = glyph.findIndex((row) => row[gx] === '#');
      if (gy >= 0) snowAt.add(`${x0 + gx},${1 + gy}`);   // 그 열의 맨 위 점 = 눈
    }
    glyph.forEach((row, gy) => [...row].forEach((c, gx) => { if (c === '#') mask[1 + gy][x0 + gx] = 'on'; }));
  });
  const g = blank(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (mask[y][x]) g[y][x] = snowAt.has(`${x},${y}`) ? colors.snow : y <= 3 ? colors.light : colors.base;
  }
  return toSvg(outline(g, colors.outline), dot);
}

// ── 별: 11×11 다섯 꼭지 별(금빛, 가운데 밝게, 밖 1점 테두리). 사용자 지시로 9×9에서 살짝 키움(2026-11-24)
const STAR = ['.....#.....', '.....#.....', '....###....', '....###....', '###########', '.#########.', '..#######..', '...#####...',
  '..###.###..', '..##...##..', '.#.......#.'];
export function pixelStar(dot = 3) {
  const n = STAR.length + 2;
  const g = blank(n, n);
  STAR.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === '#') g[y + 1][x + 1] = (x >= 4 && x <= 6 && y >= 4 && y <= 6) ? '#fff6c2' : y <= 3 ? '#ffe066' : '#f5b800';
  }));
  return toSvg(outline(g, '#9a6a00'), dot);
}

// ── 선물상자(리본 매듭 + 뚜껑 + 상자, 세로·가로 리본, 밖 1점 테두리). 정사각형(12×12)과 세로로 긴 직사각형(10×14) 두 모양
// (사용자 결정 2026-11-24 — 빨강 = 정사각형, 파랑 = 세로로 긴 상자)
// B 리본 b 리본 그늘 L 뚜껑 l 뚜껑 그늘 X 상자 x 상자 그늘 H 윤기
const GIFT_SHAPES = {
  square: [
    '..BB....BB..',
    '.B..B..B..B.',
    '..BBbBBbBB..',
    'LLLLLBBLLLLL',
    'lllllbblllll',
    '.XHXXBBXXXX.',
    '.XXXXBBXXXX.',
    '.BBBBBBBBBB.',
    '.bbbbbbbbbb.',
    '.XXXXBBXXXX.',
    '.XXXXBBXXXx.',
    '.xxxxbbxxxx.',
  ],
  tall: [   // 세로로 긴 상자(가로 10 × 세로 14 — 사용자 지시로 가로 8에서 조금 늘림, 2026-11-24)
    '..BB..BB..',
    '.B..BB..B.',
    '..BBbbBB..',
    'LLLLBBLLLL',
    'llllbbllll',
    'XHXXBBXXXX',
    'XXXXBBXXXX',
    'XXXXBBXXXX',
    'BBBBBBBBBB',
    'bbbbbbbbbb',
    'XXXXBBXXXX',
    'XXXXBBXXXX',
    'XXXXBBXXXx',
    'xxxxbbxxxx',
  ],
};
export interface GiftColors { box: string; boxShade: string; boxLight: string; lid: string; lidShade: string; ribbon: string; ribbonShade: string; outline: string }
export function pixelGift(c: GiftColors, shape: keyof typeof GIFT_SHAPES = 'square', dot = 4) {
  const rows = GIFT_SHAPES[shape];
  const map: Record<string, string> = { B: c.ribbon, b: c.ribbonShade, L: c.lid, l: c.lidShade, X: c.box, x: c.boxShade, H: c.boxLight };
  const g = blank(rows[0].length + 2, rows.length + 2);
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (map[ch]) g[y + 1][x + 1] = map[ch]; }));
  return toSvg(outline(g, c.outline), dot);
}
