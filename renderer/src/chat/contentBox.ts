import { useEffect, useState } from 'react';

// 아바타(256px 합성) 안 비투명 콘텐츠의 bbox. 이미지 크기 대비 비율(0~1).
export interface ContentBox { l: number; r: number; t: number; b: number }

// 스캔 전·실패 시 쓰는 실측 공통값(x 31~242, 위 y≈40, 몸 아래 끝 y≈210)
export const DEFAULT_BOX: ContentBox = { l: 31 / 256, r: 242 / 256, t: 40 / 256, b: 210 / 256 };

const ALPHA_MIN = 16;   // 안티앨리어싱 가장자리는 콘텐츠로 치지 않는다
const MAX_CACHE = 256;  // 사이드카 아바타 캐시 상한과 같다
const cache = new Map<string, ContentBox>();

function scan(img: HTMLImageElement): ContentBox | null {
  const { naturalWidth: w, naturalHeight: h } = img;
  if (!w || !h) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;
  let l = w, r = -1, t = -1, b = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > ALPHA_MIN) {
        if (x < l) l = x;
        if (x > r) r = x;
        if (t < 0) t = y;
        b = y;
      }
    }
  }
  return r < 0 ? null : { l: l / w, r: (r + 1) / w, t: t / h, b: (b + 1) / h };
}

// data URI는 같은 출처라 캔버스가 오염되지 않는다. 결과는 URI별로 메모리에만 둔다.
export function useContentBox(src: string | undefined): ContentBox {
  const [box, setBox] = useState<ContentBox>(() => (src && cache.get(src)) || DEFAULT_BOX);
  useEffect(() => {
    if (!src) return;
    const hit = cache.get(src);
    if (hit) { setBox(hit); return; }
    let live = true;
    const img = new Image();
    img.onload = () => {
      const found = scan(img) ?? DEFAULT_BOX;
      cache.set(src, found);
      if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
      if (live) setBox(found);
    };
    img.src = src;
    return () => { live = false; };
  }, [src]);
  return box;
}
