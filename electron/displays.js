// 디스플레이 선택(사용자 명세, 2026-11-18): 모니터 번호 매기기와 [식별] 오버레이.
// 번호 = screen.getAllDisplays()를 bounds.x 오름차순(같은 x면 bounds.y 오름차순)으로 정렬한 순번 + 1.
// 드로어 버튼 번호·식별 오버레이 번호·window-state.json의 displayIndex가 모두 이 번호다.

function ordered(screen) {
  return [...screen.getAllDisplays()].sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
}

// 디스플레이의 번호(1부터). 목록에 없으면 0.
function numberOf(screen, display) {
  return ordered(screen).findIndex((d) => d.id === display.id) + 1;
}

// 번호의 디스플레이. 없으면 null.
function byNumber(screen, n) {
  return (Number.isInteger(n) && ordered(screen)[n - 1]) || null;
}

// 식별 오버레이: 각 디스플레이 좌측 하단에 그 번호를 띄우고 IDENTIFY_MS 뒤 닫는다(Windows 디스플레이 설정의 '식별'과 같은 역할).
// 모양은 사용자 결정(2026-11-18): 상자 154×154 DIP · 모서리 18 · 배경 검정 60% · 숫자 흰색 105px Bold(처음 220·24·150에서 약 70%로 축소).
// 위치도 사용자 결정(2026-11-18): 작업영역(작업표시줄 제외)의 왼쪽·아래 끝에서 각각 MARGIN 안쪽.
const IDENTIFY_MS = 2500;
const BOX = 154;
const MARGIN = 24;
// 숫자는 글꼴 위아래 여백을 잘라(text-box: cap ~ 기준선) 글자 자체가 상자 가운데 오게 한다(자르지 않으면 아래로 약 4% 치우친다).
const page = (n) => 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
div{width:100%;height:100%;display:flex;align-items:center;justify-content:center;border-radius:18px;background:rgba(0,0,0,.6);
  color:#fff;font:700 105px/1 "Segoe UI",sans-serif;user-select:none}
span{text-box:trim-both cap alphabetic}
</style><div><span>${n}</span></div>`);

const sameBounds = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

function createIdentifier({ BrowserWindow, screen, level }) {
  let windows = [], timer = null;

  function close() {
    clearTimeout(timer); timer = null;
    for (const w of windows) if (!w.isDestroyed()) w.destroy();
    windows = [];
  }

  // 다시 누르면 떠 있던 오버레이를 닫고 처음부터 다시 띄운다.
  function show() {
    close();
    ordered(screen).forEach((d, i) => {
      const wa = d.workArea;
      const target = { x: wa.x + MARGIN, y: wa.y + wa.height - MARGIN - BOX, width: BOX, height: BOX };
      // 클릭 통과·포커스 안 뺏음(focusable:false — Windows에선 작업표시줄에서도 빠진다)·항상 위. 스크립트 없는 정적 페이지라 JS를 끈다.
      const w = new BrowserWindow({
        ...target, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
        resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
        focusable: false, skipTaskbar: true, alwaysOnTop: true,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
      });
      w.setIgnoreMouseEvents(true);
      w.setAlwaysOnTop(true, level);
      // 배율이 다른 모니터에서는 생성 좌표가 이전 배율로 환산돼 어긋날 수 있어(main.js dockTo와 같은 이유) 결과가 다르면 다시 맞춘다.
      const fit = () => { if (!w.isDestroyed() && !sameBounds(w.getBounds(), target)) w.setBounds(target); };
      fit();
      w.once('ready-to-show', () => { fit(); if (!w.isDestroyed()) w.showInactive(); });
      w.loadURL(page(i + 1));
      windows.push(w);
    });
    timer = setTimeout(close, IDENTIFY_MS);
  }

  return { show, close };
}

module.exports = { ordered, numberOf, byNumber, createIdentifier, IDENTIFY_MS };
