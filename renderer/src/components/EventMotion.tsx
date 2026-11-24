import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useChat } from '../hooks/useChatView';
import { useHeldPlayback, usePageVisible } from '../hooks/useHeldPlayback';
import { useUi } from '../state/UiContext';
import { EVENT_DURATION_MS } from '../chat/events';
import treeImage from '../assets/white-tree.png';
import { garlandTile, pixelBow, pixelGift, pixelStar, pixelText } from './christmasArt';
import styles from './EventMotion.module.css';

// 문구 트리거 이벤트 효과(1.0.10, chat/events.ts): 패널 전체 위에 약 4초(3.4초 재생 + 0.6초 페이드아웃) 띄운다. 클릭은 아래로 통과한다.
// 채팅 투명도는 적용하지 않는다(패널 본체 밖 형제). 화면이 가려진 동안(접힘·드로어·참여자 목록·창 최소화)은 공개수배처럼
// 최대 1분 보류했다가 보이면 처음부터 재생한다(hooks/useHeldPlayback). 재생을 시작하면 쿨다운(10초)이 시작된다.
// 플레이 > 이벤트 모션이 꺼져 있으면 useChatView가 받지 않으므로 여기 올 것이 없다.
export default function EventMotion() {
  const { event, eventStarted, dismissEvent } = useChat();
  const { overlays } = useUi();
  const visible = usePageVisible();
  const hidden = overlays.collapsed || overlays.drawerOpen || overlays.modalOpen || !visible;
  const held = useMemo(() => (event ? { id: event.id, target: '', at: event.at } : null), [event]);
  const dismiss = useCallback((id: string) => dismissEvent(id), [dismissEvent]);
  const playing = useHeldPlayback(held, true, hidden, dismiss, EVENT_DURATION_MS);
  useEffect(() => { if (playing) eventStarted(playing); }, [playing, eventStarted]);
  if (!event || hidden || playing !== event.id) return null;
  return <Christmas key={event.id} />;
}

// ── 크리스마스: (라이트 모드만 반투명 검정 막) + 도트 눈 + 상단바 바로 아래 두툼한 가랜드(가운데 줄무늬 리본) + 채팅창 가운데 'MERRY CHRISTMAS'와
// 트리(반짝이는 별·전구, 양옆에서 통통 튀는 선물상자). 배치는 beta에서 조정한다(사용자 명세)
const GARLAND = garlandTile(3);   // 처음 모양을 두툼하게(타일 repeat-x). 이음매(갈고리) 하나를 패널 가운데에 맞춰 리본이 거기 걸린다
const BOW = pixelBow(3);          // 각진 줄무늬 리본(사용자 승인 2026-11-24), 약 159×114px
// 글자 테두리는 조금 밝은 적·녹(사용자 결정 2026-11-24 — 처음 #3a0a10·#0b2a12는 다크 배경에 묻혀 글자가 가늘어 보였다, 두 테마 공통)
const MERRY = pixelText('MERRY', { light: '#ff7a7f', base: '#d7263d', outline: '#6e1420', snow: '#ffffff' }, 4);
const CHRISTMAS = pixelText('CHRISTMAS', { light: '#7ee08a', base: '#2f9e44', outline: '#155a2b', snow: '#ffffff' }, 4);
const STAR = pixelStar(3);
// 선물상자 모양을 다르게(사용자 결정 2026-11-24): 왼쪽 빨강 = 정사각형 56×56, 오른쪽 파랑 = 세로로 긴 직사각형 48×64(점 4px, 가로를 조금 늘림)
const GIFTS = [
  pixelGift({ box: '#d7263d', boxShade: '#9e1b2a', boxLight: '#ff7a7f', lid: '#e8333c', lidShade: '#a8141f', ribbon: '#ffd23f', ribbonShade: '#c99a10', outline: '#3a0a10' }, 'square'),
  pixelGift({ box: '#3b7be0', boxShade: '#24509b', boxLight: '#8cb8ff', lid: '#4a8af0', lidShade: '#2a5aa8', ribbon: '#f4f6fa', ribbonShade: '#b9c3d1', outline: '#0f2347' }, 'tall'),
];
// 트리 그림(1024×1536) 기준 위치(%): 꼭대기 = (50.2, 11.6). 전구 = 장식볼·눈에서 떨어진 초록 가지(그림 픽셀에서 골랐다)
const APEX = { x: 50.2, y: 11.6 };
const LIGHTS: [number, number][] = [[60.9, 36.2], [49.2, 37], [58.6, 48.7], [43.4, 53.4], [64.5, 60.4], [51.6, 63.5], [70.3, 69.8],
  [46.9, 71.4], [52.7, 78.4], [71.5, 81.5], [23.4, 82.3]];
const LIGHT_COLORS = ['#ffe066', '#ff5a5f', '#6fc3ff', '#fff6d6'];

// 눈송이: 같은 배치가 늘 나오게 고정 난수(그릴 때마다 바뀌지 않게)
const FLAKES = (() => {
  let seed = 20261224;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  return Array.from({ length: 56 }, () => ({
    left: rand() * 100, size: [3, 4, 4, 6][Math.floor(rand() * 4)], delay: rand() * 1.4, fall: 2.2 + rand() * 1.3,
    drift: (rand() < 0.5 ? -1 : 1) * (4 + Math.round(rand() * 8)),
  }));
})();

// 배치(그리기 전에 잰다): 가랜드·리본 = 상단바(.panel-body 첫 줄 header) 바로 아래(사용자 결정 2026-11-24).
// 문구·트리 = 패널 정가운데. 단, 정가운데에 두면 리본이나 입력창(.panel-body 마지막 줄)과 겹치는 낮은 채팅 높이(예: 50%)에서는
// 리본 아래 ~ 입력창 위 공간의 가운데에 두고 그 공간에 들어가게 줄인다(사용자 확인 2026-11-24 — 50%에서 약 68%)
const GAP = 8;
function useLayout() {
  const ref = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ top: number; sceneStyle?: CSSProperties }>({ top: 0 });
  useLayoutEffect(() => {
    const layer = ref.current, el = scene.current, body = layer?.parentElement?.querySelector('.panel-body');
    const bar = body?.firstElementChild, composer = body?.lastElementChild?.getBoundingClientRect();
    if (!layer || !el || !bar) return;
    const box = layer.getBoundingClientRect();
    const top = Math.round(bar.getBoundingClientRect().bottom - box.top);
    const from = top + BOW.height + GAP, to = (composer && composer.height > 0 ? composer.top - box.top : box.height) - GAP;
    const h = el.offsetHeight, mid = box.height / 2;
    if (mid - h / 2 >= from && mid + h / 2 <= to) { setLayout({ top }); return; }
    const scale = Math.max(0.3, Math.min(1, (to - from) / h));
    setLayout({ top, sceneStyle: { top: Math.round((from + to) / 2), transform: `translate(-50%, -50%) scale(${scale.toFixed(3)})` } });
  }, []);
  return { ref, scene, top: layout.top, sceneStyle: layout.sceneStyle };
}

function Christmas() {
  const { ref, scene, top, sceneStyle } = useLayout();
  return (
    <div ref={ref} className={styles.layer} role="img" aria-label="메리 크리스마스">
      <div className={styles.snow} aria-hidden="true">
        {FLAKES.map((f, i) => (
          <span key={i} className={styles.fall} style={{ left: `${f.left}%`, animationDelay: `${f.delay}s`, animationDuration: `${f.fall}s` }}>
            <span className={styles.flake} style={{ width: f.size, height: f.size, '--drift': `${f.drift}px` } as CSSProperties} />
          </span>
        ))}
      </div>
      <div className={styles.garlandClip} style={{ top, height: GARLAND.height }} aria-hidden="true">
        <div className={styles.garland} style={{ backgroundImage: `url("${GARLAND.uri}")`, backgroundSize: `${GARLAND.width}px ${GARLAND.height}px`,
          backgroundPosition: `calc(50% - ${GARLAND.width / 2}px) 0` }} />
      </div>
      <img className={styles.bow} src={BOW.uri} width={BOW.width} height={BOW.height} alt="" draggable={false} style={{ top }} aria-hidden="true" />
      <div ref={scene} className={styles.scene} style={sceneStyle} aria-hidden="true">
        <img className={`${styles.title} ${styles.merry}`} src={MERRY.uri} width={MERRY.width} height={MERRY.height} alt="" draggable={false} />
        <img className={`${styles.title} ${styles.christmas}`} src={CHRISTMAS.uri} width={CHRISTMAS.width} height={CHRISTMAS.height} alt=""
          draggable={false} />
        <div className={styles.tree}>
          <img className={styles.treeImg} src={treeImage} alt="" draggable={false} />
          {LIGHTS.map(([x, y], i) => (
            <span key={i} className={styles.light}
              style={{ left: `${x}%`, top: `${y}%`, '--c': LIGHT_COLORS[i % LIGHT_COLORS.length], animationDelay: `${(i * 0.17) % 0.9}s` } as CSSProperties} />
          ))}
          <img className={styles.star} src={STAR.uri} width={STAR.width} height={STAR.height} alt="" draggable={false}
            style={{ left: `${APEX.x}%`, top: `${APEX.y}%` }} />
          {GIFTS.map((gift, i) => (
            <span key={i} className={`${styles.gift} ${i ? styles.giftRight : styles.giftLeft}`}>
              <img className={styles.giftImg} src={gift.uri} width={gift.width} height={gift.height} alt="" draggable={false} />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
