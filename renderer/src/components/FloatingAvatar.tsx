import { useEffect, useRef, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useUi } from '../state/UiContext';
import { useChat } from '../hooks/useChatView';
import { useFloatingWindow } from '../hooks/useFloatingWindow';
import Cat from './Cat';
import styles from './FloatingAvatar.module.css';

// 광선 버스트(사용자 명세·결정 2026-11-23): 삼각 광선 3개 부채꼴, 원형의 화면 안쪽 위 바깥, 노랑 + 주황 테두리(예시 이미지).
// 그림 좌표 = 원형 상자(64×64, 원형 중심 (32,32)). 안쪽이 오른쪽인 모양(오른쪽 위)으로 그리고 왼쪽은 CSS로 원형 중심 기준 좌우를 뒤집는다.
// 세 줄은 공통 원점에서 CENTER ± SPREAD 방향으로 뻗고, 각 광선 = 원점에서 R0 떨어진 꼭짓점 → 바깥 밑변(길이 len, 반폭 w).
// 원점을 원형 안쪽에 두고 꼭짓점을 R0만큼 띄워 세 줄이 밑동부터 떨어지게 한다(한 점에 모으면 테두리가 밑동에서 뭉친다).
// 가운데 꼭짓점은 원형 가장자리에서 EDGE 바깥. 값은 후보 그림 비교로 사용자가 골랐다(2026-11-23):
// 길이 = 처음(18/24/18)의 0.55배, 사이 각 32°·밑동 9, 테두리 1(CSS).
// 크기 변화(사용자 결정 2026-11-24)는 광선마다 자기 꼭짓점을 기준점으로 키운다(꼭짓점 고정, 길이·굵기만) — origin = 꼭짓점.
const CENTER = 45, SPREAD = 32, R0 = 9, EDGE = 5;
const RAYS = [{ len: 10, w: 2.6 }, { len: 13, w: 3.2 }, { len: 10, w: 2.6 }];
const f = (v: number) => Math.round(v * 100) / 100;
const dir = (deg: number) => [Math.cos((deg * Math.PI) / 180), -Math.sin((deg * Math.PI) / 180)];
const [OX, OY] = dir(CENTER).map((d) => 32 + (32 + EDGE - R0) * d);
const RAY_SHAPES = RAYS.map(({ len, w }, i) => {
  const [dx, dy] = dir(CENTER + (i - 1) * SPREAD), px = -dy, py = dx;
  const bx = OX + (R0 + len) * dx, by = OY + (R0 + len) * dy;
  const pts = [[OX + R0 * dx, OY + R0 * dy], [bx + w * px, by + w * py], [bx - w * px, by - w * py]];
  return { points: pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' '), origin: `${f(pts[0][0])}px ${f(pts[0][1])}px` };
});

function Burst() {
  return (
    <svg className={styles.burst} viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
      {RAY_SHAPES.map(({ points, origin }) => <polygon key={points} points={points} style={{ transformOrigin: origin }} />)}
    </svg>
  );
}

// 플로팅 아바타 버튼(사용자 명세 2026-11-23). 켜져 있으면 접힘·펼침과 무관하게 늘 보인다.
// 아바타 = 마지막 채팅 사용자(본인 포함), 대화가 없으면 실루엣. 마우스를 올리면 이름(화면 안쪽 라벨).
// 강조 = 안 읽은 타인 메시지가 있으면 광선(기존 안 읽은 수 — 펼쳐 보면 0이라 꺼진다. 내 메시지는 세지 않는다).
// 클릭 = 채팅 펼치기/접기(OPEN 탭과 같음). 펼칠 때만 메인창에 포커스를 준다(접을 때는 주지 않는다 — 사용자 결정).
// 끌면 옮기고 위치를 저장한다(main이 커서를 따라 옮긴다. 4 DIP 넘게 움직이기 전에 놓으면 클릭).
// 채팅 투명도는 적용하지 않는다(패널 본체 밖).
export default function FloatingAvatar({ unread }: { unread: number }) {
  const { settings, overlays, dispatch } = useUi();
  const { lastSpeaker } = useChat();
  const { host, inward } = useFloatingWindow(settings.floatingAvatar, settings.side);
  const shell = window.catTalk;
  const dragging = useRef(false);

  // 원형 밖은 클릭 통과(메인창 useClickThrough와 같은 방식). 팝업 문서의 커서 위치로 판정하고, 끄는 중에는 받는 상태를 유지한다.
  // 팝업 요소는 팝업 창 영역(realm)의 것이라 instanceof 대신 closest 존재로 본다
  useEffect(() => {
    const view = host?.ownerDocument.defaultView;
    if (!shell || !view || view === window) return;
    let interactive = false;
    const update = (next: boolean) => {
      if (next === interactive) return;
      interactive = next;
      shell.floating.setInteractive(next);
    };
    const onMove = (e: MouseEvent) => {
      const target = e.target as Element | null;
      update(dragging.current || !!target?.closest?.('[data-fab]'));
    };
    const onLeave = () => { if (!dragging.current) update(false); };
    view.addEventListener('mousemove', onMove);
    view.document.documentElement.addEventListener('mouseleave', onLeave);
    return () => {
      view.removeEventListener('mousemove', onMove);
      view.document.documentElement.removeEventListener('mouseleave', onLeave);
    };
  }, [shell, host]);

  if (!host) return null;

  const toggle = () => {
    if (overlays.collapsed) {
      dispatch({ type: 'expand' });
      shell?.floating.focusMain();
    } else {
      dispatch({ type: 'toggleCollapsed' });
    }
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    shell?.floating.dragStart();
  };
  // click = 놓아서 끝난 경우(취소·캡처 잃음은 클릭이 아니다). 움직였으면(main 판정) 드래그였으므로 클릭으로 치지 않는다
  const finish = async (click: boolean) => {
    if (!dragging.current) return;
    dragging.current = false;
    const result = shell ? await shell.floating.dragEnd() : { moved: false };
    if (click && !result.moved) toggle();
  };

  const name = lastSpeaker?.name;
  return createPortal(
    <div className={styles.stage} data-inward={inward}>
      <div className={styles.fab} data-fab="" role="button" aria-label={name ? `${name} · 채팅 열기/닫기` : '채팅 열기/닫기'}
        onPointerDown={onPointerDown} onPointerUp={() => void finish(true)}
        onPointerCancel={() => void finish(false)} onLostPointerCapture={() => void finish(false)}>
        <Cat src={lastSpeaker?.avatar} framing="face" />
      </div>
      {/* 안 읽은 수가 바뀌면(새 메시지) 다시 그려 크기 변화를 처음부터 한다(사용자 결정 2026-11-24 — CSS .burst polygon) */}
      {unread > 0 && <Burst key={unread} />}
      {name && <span className={styles.label}>{name}</span>}
    </div>,
    host,
  );
}
