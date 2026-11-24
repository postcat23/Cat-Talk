// 플로팅 아바타 버튼(사용자 명세, 2026-11-23, 1.0.10).
// 창은 메인 렌더러의 window.open 팝업이다(이름 NAME, about:blank). 메인 렌더러 프로세스를 같이 써서 별도 BrowserWindow(새 렌더러,
// 약 80MB)보다 가볍다(사전 실측 +2.6MB). 내용(원형 버튼·이름 라벨·광선)은 메인 렌더러가 React 포털로 그리고, 이 모듈은 창만 다룬다:
// 배치(기본·저장 위치), 항상 위(메인창보다 위), 클릭 통과(원형 밖), 드래그 이동·저장, 정리.
//
// 창 = 원형(SIZE) 둘레에 여백을 붙인 투명 사각형. 좌우 SIDE에는 이름 라벨(원형에서 8 띄움, 최대 폭 180)이, 위 TOP에는 광선이 들어간다.
// 라벨·광선은 화면 안쪽으로 그리므로(사용자 결정 2026-11-23) 좌우를 같게 둔다 — 원형을 끌어 화면 가운데를 넘어도 창 크기를 바꾸지 않는다.
// 원형 밖은 클릭 통과라 여백이 다른 창을 막지 않는다. 렌더러 FloatingAvatar.module.css의 배치 값과 같게 맞춘다.
const NAME = 'cattalk-floating';
const SIZE = 64;      // 원형 지름(사용자 명세)
const SIDE = 188;     // 원형 좌우 여백: 라벨 간격 8 + 최대 폭 180
const TOP = 28;       // 원형 위 여백: 광선 자리. 광선을 줄인 뒤(2026-11-23)에는 원형 위로 약 8(테두리 포함)만 쓴다 — 여백이 투명·클릭 통과라 그대로 둔다
const BOTTOM = 16;    // 원형 아래 여백: 그림자(접기 탭과 같은 4px 아래·10px 흐림)
const WIDTH = SIDE * 2 + SIZE;
const HEIGHT = TOP + SIZE + BOTTOM;
// 기본 위치(사용자 결정 2026-11-23): 메인창이 있는 디스플레이의 작업영역(작업표시줄 제외) 하단, 메인창 반대편 끝에서 각각 MARGIN 안쪽
// (식별 오버레이와 같은 값). 메인 오른쪽 → 좌하단, 왼쪽 → 우하단.
const MARGIN = 24;
// 메인창(TOPMOST_LEVEL 'pop-up-menu')보다 위. Windows는 항상 위 창끼리 마지막으로 올린 창이 위라, 메인창이 활성화·재설정될 때마다 다시 올린다(raise).
const LEVEL = 'screen-saver';
// 누른 뒤 이만큼(DIP) 움직이기 전에 놓으면 클릭이다(Windows 기본 드래그 시작 거리 SM_CXDRAG = 4px@96DPI). 그 전에는 창을 옮기지 않는다.
const DRAG_THRESHOLD = 4;
const DRAG_TICK_MS = 16;   // 드래그 중 커서 위치를 읽어 창을 옮기는 간격(약 60Hz). 렌더러 좌표 대신 OS 커서(DIP)를 써서 배율이 다른 모니터를 넘어도 맞는다

const sameBounds = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const round4 = (v) => Math.round(v * 10000) / 10000;

// state: window-state의 상태 객체(side·floating·floatingPos). save(state)로 저장한다.
// mainDisplay(): 메인창이 지금 있는 디스플레이. notifyLayout({inward}): 라벨·광선 방향이 바뀌면 메인 렌더러에 알린다.
// onCloseRequest(): 이 창이 밖에서 닫기 요청을 받았을 때(앱을 닫는다).
function createFloating({ screen, displays, state, save, mainDisplay, notifyLayout, onCloseRequest, log }) {
  let child = null;
  let current = null;   // 지금 원형 왼쪽 위(DIP). 혼합 배율에서 getBounds가 1px 어긋날 수 있어 마지막으로 맞춘 값을 기준으로 쓴다
  let inward = null;    // 'left' | 'right' — 라벨·광선이 나가는 쪽(화면 안쪽)
  let drag = null;

  const alive = () => !!child && !child.isDestroyed();
  const boundsAt = (c) => ({ x: c.x - SIDE, y: c.y - TOP, width: WIDTH, height: HEIGHT });
  const displayAt = (c) => screen.getDisplayNearestPoint({ x: Math.round(c.x + SIZE / 2), y: Math.round(c.y + SIZE / 2) });
  // 원형이 작업영역 밖으로 나가지 않게 한다(드래그로 화면 밖에 잃어버리지 않게)
  const clampTo = (wa, c) => ({ x: clamp(c.x, wa.x, wa.x + wa.width - SIZE), y: clamp(c.y, wa.y, wa.y + wa.height - SIZE) });

  function defaultSpot() {
    const wa = mainDisplay().workArea;
    const x = state.side === 'right' ? wa.x + MARGIN : wa.x + wa.width - MARGIN - SIZE;
    return { x, y: wa.y + wa.height - MARGIN - SIZE };
  }

  // 저장 위치(사용자 명세 + 결정 2026-11-23): 디스플레이 번호(displays.js 순번) + 작업영역 안 비율(0~1, 원형이 움직일 수 있는 범위 기준).
  // 그 번호 디스플레이가 없으면 기본 위치(저장값은 그대로 — 다시 연결하면 돌아간다).
  function savedSpot() {
    const pos = state.floatingPos;
    const d = pos && displays.byNumber(screen, pos.display);
    if (!d) return null;
    const wa = d.workArea;
    return { x: wa.x + Math.round(pos.rx * (wa.width - SIZE)), y: wa.y + Math.round(pos.ry * (wa.height - SIZE)) };
  }

  function publish(c) {
    const wa = displayAt(c).workArea;
    const next = c.x + SIZE / 2 < wa.x + wa.width / 2 ? 'right' : 'left';
    if (next === inward) return;
    inward = next;
    notifyLayout({ inward });
  }

  // 배율이 다른 모니터로 넘어갈 때 첫 setBounds가 이전 배율로 환산돼 어긋날 수 있어 결과가 다르면 한 번 더 맞춘다(main.js dockTo와 같은 이유)
  function moveTo(c) {
    current = c;
    if (alive()) {
      const target = boundsAt(c);
      if (!sameBounds(child.getBounds(), target)) {
        child.setBounds(target);
        if (!sameBounds(child.getBounds(), target)) child.setBounds(target);
      }
    }
    publish(c);
  }

  // 저장·기본 위치로 다시 놓는다: 창을 열 때, 메인창 위치(좌/우)·디스플레이가 바뀔 때, 디스플레이 구성·배율이 바뀔 때. 드래그 중에는 두지 않는다
  function place() {
    if (!alive() || drag) return;
    moveTo(savedSpot() || defaultSpot());
  }

  function raise() {
    if (!alive() || !child.isVisible()) return;
    child.setAlwaysOnTop(true, LEVEL);
    child.moveTop();
  }

  // setWindowOpenHandler의 overrideBrowserWindowOptions. 포커스를 뺏지 않고(focusable:false — 작업표시줄에서도 빠진다) 처음에는 숨겨 둔다(attach가 배치 후 showInactive)
  function windowOptions() {
    return {
      ...boundsAt(savedSpot() || defaultSpot()), title: 'Cat Talk', show: false,
      frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
      focusable: false, skipTaskbar: true, alwaysOnTop: true,
    };
  }

  function attach(w) {
    close();
    child = w;
    inward = null;   // 새 팝업(렌더러 리로드 포함)은 방향을 처음부터 다시 받는다
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (e) => e.preventDefault());
    w.on('closed', () => {
      if (child !== w) return;
      child = null;
      stopDrag();
    });
    // 밖에서 온 닫기 요청(WM_CLOSE)은 앱 닫기 요청으로 본다. 정상 종료 요청(taskkill /F 없이 — 설치·업데이트가 먼저 쓴다)은
    // 프로세스의 맨 위 창 하나에만 닫기를 보내는데, 항상 위인 이 창이 받으면 이 창만 닫히고 앱이 그대로 남았다(실측 2026-11-23).
    // 'close' 이벤트는 밖에서 온 닫기에만 온다 — 렌더러의 popup.close()·토글 끄기·우리 destroy()는 내지 않는다(실측)
    w.on('close', () => {
      log('floating_close_request');
      onCloseRequest();
    });
    // 원형 밖은 클릭 통과. 렌더러가 원형 위 커서를 알리면 그때만 클릭을 받는다(메인창 useClickThrough와 같은 forward 방식)
    w.setIgnoreMouseEvents(true, { forward: true });
    w.setAlwaysOnTop(true, LEVEL);
    place();
    w.showInactive();
    raise();
    log('floating_open', { saved: !!savedSpot() });
  }

  function close() {
    stopDrag();
    if (alive()) child.destroy();
    child = null;
  }

  function setInteractive(interactive) {
    if (!alive() || typeof interactive !== 'boolean') return;
    if (interactive) child.setIgnoreMouseEvents(false);
    else child.setIgnoreMouseEvents(true, { forward: true });
  }

  // 드래그: 렌더러가 원형에서 누르면 시작, 놓으면 끝. 그사이 OS 커서를 따라 원형을 옮긴다(작업영역 안으로).
  // 시작점은 마지막으로 맞춘 위치(current)다. 창이 우리 모르게 옮겨졌으면(OS 재배치 등) 실제 창 위치를 쓴다 —
  // getBounds는 소수 DIP 위치에서 1 어긋날 수 있어 2 DIP 안이면 같은 것으로 본다
  function dragStart() {
    if (!alive() || drag) return;
    const b = child.getBounds(), actual = { x: b.x + SIDE, y: b.y + TOP };
    const from = current && Math.abs(current.x - actual.x) <= 2 && Math.abs(current.y - actual.y) <= 2 ? current : actual;
    drag = { cursor: screen.getCursorScreenPoint(), from, moved: false, timer: setInterval(dragTick, DRAG_TICK_MS) };
  }

  function dragTick() {
    if (!drag) return;
    if (!alive()) { stopDrag(); return; }
    const p = screen.getCursorScreenPoint();
    const dx = p.x - drag.cursor.x, dy = p.y - drag.cursor.y;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    const raw = { x: drag.from.x + dx, y: drag.from.y + dy };
    moveTo(clampTo(displayAt(raw).workArea, raw));
  }

  function stopDrag() {
    if (!drag) return;
    clearInterval(drag.timer);
    drag = null;
  }

  // 끝. moved = 클릭이 아니라 드래그였는지(렌더러가 클릭 처리를 할지 정한다). 옮겼으면 그 위치를 저장한다
  function dragEnd() {
    if (!drag) return { moved: false };
    dragTick();
    const moved = drag.moved;
    stopDrag();
    if (moved && current) savePos(current);
    return { moved };
  }

  function savePos(c) {
    const d = displayAt(c);
    const n = displays.numberOf(screen, d);
    if (!n) return;
    const wa = d.workArea;
    const rx = wa.width > SIZE ? clamp((c.x - wa.x) / (wa.width - SIZE), 0, 1) : 0;
    const ry = wa.height > SIZE ? clamp((c.y - wa.y) / (wa.height - SIZE), 0, 1) : 0;
    state.floatingPos = { display: n, rx: round4(rx), ry: round4(ry) };
    save(state);
    log('floating_moved', { display: n, count: screen.getAllDisplays().length });
  }

  return {
    NAME, windowOptions, attach, close, place, raise, setInteractive, dragStart, dragEnd,
    layout: () => ({ inward: inward || (state.side === 'right' ? 'right' : 'left') }),
    isOpen: alive,
  };
}

module.exports = { createFloating, NAME, SIZE, SIDE, TOP, BOTTOM, MARGIN, LEVEL };
