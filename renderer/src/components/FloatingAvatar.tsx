import { useEffect, useRef, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useUi } from '../state/UiContext';
import { useChat } from '../hooks/useChatView';
import { useFloatingWindow } from '../hooks/useFloatingWindow';
import Cat from './Cat';
import styles from './FloatingAvatar.module.css';

// 광선 버스트(사용자 명세·결정 2026-11-23): 삼각 광선 3개 부채꼴, 원형의 화면 안쪽 위 바깥, 노랑.
// 그림 좌표 32×32에서 원점 = 왼쪽 아래(원형 가장자리 바로 바깥), 안쪽이 오른쪽인 모양으로 그리고 왼쪽은 CSS로 뒤집는다.
// 광선 = 원점에서 R0 떨어진 꼭짓점 → 바깥쪽 밑변(len, 반폭 w). 가운데(45°)가 가장 길다.
const R0 = 3;
const RAYS = [{ deg: 20, len: 21, w: 2.6 }, { deg: 45, len: 27, w: 3.2 }, { deg: 70, len: 21, w: 2.6 }];
const f = (v: number) => Math.round(v * 100) / 100;
const RAY_POINTS = RAYS.map(({ deg, len, w }) => {
  const t = (deg * Math.PI) / 180, dx = Math.cos(t), dy = -Math.sin(t), px = Math.sin(t), py = Math.cos(t);
  const bx = len * dx, by = 32 + len * dy;
  return [[R0 * dx, 32 + R0 * dy], [bx + w * px, by + w * py], [bx - w * px, by - w * py]].map(([x, y]) => `${f(x)},${f(y)}`).join(' ');
});

function Burst() {
  return (
    <svg className={styles.burst} viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      {RAY_POINTS.map((points) => <polygon key={points} points={points} />)}
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
      {unread > 0 && <Burst />}
      {name && <span className={styles.label}>{name}</span>}
    </div>,
    host,
  );
}
