// 안 읽은 수 표시용 아이콘. 메인 프로세스에는 캔버스가 없어 BGRA 픽셀을 직접 칠한다(프리멀티플라이드 기준).
const { nativeImage } = require('electron');

const SIZE = 32;
const RED = [0x2f, 0x2f, 0xe5];     // BGR
const WHITE = [0xff, 0xff, 0xff];
const TRAY_DOT_RADIUS = 8;          // 16px로 줄면 지름 8px. 숫자는 읽히지 않아 점만 쓴다
const MAX_COUNT = 99;
const TEXT_SCALE = 2;              // 5×7 글자를 2배로. 16px로 줄면 원래 5×7이 된다

// 5×7 글자
const GLYPHS = {
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
};
// 3×5 글자. '99+'는 5×7로 원에 들어가지 않는다
const SMALL_GLYPHS = {
  9: ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000'],
};

function blend(pixels, x, y, color, alpha) {
  const i = (y * SIZE + x) * 4;
  for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(color[c] * alpha + pixels[i + c] * (1 - alpha));
  pixels[i + 3] = Math.round(255 * alpha + pixels[i + 3] * (1 - alpha));
}

function circle(pixels, center, radius) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const alpha = Math.min(1, Math.max(0, radius + 0.5 - Math.hypot(x + 0.5 - center, y + 0.5 - center)));
      if (alpha > 0) blend(pixels, x, y, RED, alpha);
    }
  }
}

function text(pixels, label) {
  const glyphs = label.length > 2 ? SMALL_GLYPHS : GLYPHS;
  const glyphWidth = glyphs['+'][0].length, advance = glyphWidth + 1;
  const width = (label.length * advance - 1) * TEXT_SCALE;
  const left = Math.floor((SIZE - width) / 2), top = Math.floor((SIZE - glyphs['+'].length * TEXT_SCALE) / 2);
  [...label].forEach((char, index) => {
    glyphs[char].forEach((row, y) => {
      [...row].forEach((bit, x) => {
        if (bit !== '1') return;
        for (let dy = 0; dy < TEXT_SCALE; dy++) {
          for (let dx = 0; dx < TEXT_SCALE; dx++) blend(pixels, left + (index * advance + x) * TEXT_SCALE + dx, top + y * TEXT_SCALE + dy, WHITE, 1);
        }
      });
    });
  });
}

const toImage = (pixels) => nativeImage.createFromBitmap(pixels, { width: SIZE, height: SIZE });

// 작업표시줄 오버레이 배지. 100 이상은 '99+'
function countBadge(count) {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  circle(pixels, SIZE / 2, SIZE / 2);
  text(pixels, count > MAX_COUNT ? `${MAX_COUNT}+` : String(count));
  return toImage(pixels);
}

// 트레이 아이콘 오른쪽 아래에 빨간 점
function dotIcon(iconPath) {
  const pixels = Buffer.from(nativeImage.createFromPath(iconPath).resize({ width: SIZE, height: SIZE }).toBitmap());
  circle(pixels, SIZE - TRAY_DOT_RADIUS, TRAY_DOT_RADIUS);
  return toImage(pixels);
}

module.exports = { countBadge, dotIcon };
