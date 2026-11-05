const { app, BrowserWindow, ipcMain, screen, shell, Tray, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const windowState = require('./window-state');
const { createAutoChest, defaultSys } = require('./auto-chest');

const REQUEST_TIMEOUT_MS = 5000;
const DEV = process.env.CATTALK_DEV === '1';
const DEV_URL = 'http://localhost:5173';   // vite.config.mts의 DEV_PORT와 맞춘다
const ICON = path.join(__dirname, 'app-icon.ico');

let win = null, tray = null, sidecar = null, nextId = 1, stdoutBuf = '';
const pending = new Map();   // id -> {resolve, reject, timer}

// 끝 도크 창: 패널 390 + 접기 탭 거터 34 + 탭 drop-shadow 여유 8(거터 쪽). 높이는 작업영역 비율.
const WIN_WIDTH = 432;
const MOVE_SETTLE_MS = 200;
// side·heightPct·hideTaskbar·display({id,bounds}). 시작 시 디스크에서 읽고 바뀔 때마다 저장한다.
const state = windowState.load();

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => openAndExpand());
process.stderr.on('error', () => {});   // 콘솔 없이 실행되면 쓰기가 실패할 수 있다. 사이드카는 계속 돈다.

function settle(id) {
  const p = pending.get(id);
  if (p) { pending.delete(id); clearTimeout(p.timer); }
  return p;
}

// prod는 창 없는 인터프리터로 띄운다. 콘솔 앱(python.exe)은 콘솔 없는 부모 밑에서 새 콘솔을 만들고,
// 그 아래 multiprocessing worker도 sys.executable(콘솔 앱)로 떠서 창을 하나 더 띄운다.
function windowlessPython(exe) {
  const w = path.join(path.dirname(exe), 'pythonw.exe');
  return path.basename(exe).toLowerCase() === 'python.exe' && fs.existsSync(w) ? w : exe;
}

function startSidecar() {
  // upstream 소스는 3.10+ 문법(`dict | None`)이라 기본은 py 런처의 3.11. CATTALK_PYTHON으로 override.
  // dev는 로그 확인용으로 콘솔을 유지한다(py.exe + stderr 상속).
  const custom = process.env.CATTALK_PYTHON;
  const [py, ...pyArgs] = DEV
    ? (custom ? [custom] : ['py', '-3.11'])
    : (custom ? [windowlessPython(custom)] : ['pyw', '-3.11']);
  // libuv는 상속 stdio가 하나도 없을 때만 CREATE_NO_WINDOW를 붙인다. 그래서 prod는 stderr를 상속 대신
  // 파이프로 받아 Electron stderr로 넘긴다(사이드카가 fd2를 fd1로 복제하므로 버리면 안 된다).
  const child = spawn(py, [...pyArgs, path.join(__dirname, '..', 'sidecar', 'server.py')], {
    stdio: ['pipe', 'pipe', DEV ? 'inherit' : 'pipe'],
    windowsHide: !DEV,
  });
  if (child.stderr) child.stderr.on('data', (chunk) => { try { process.stderr.write(chunk); } catch (e) { /* 콘솔 없음 */ } });
  sidecar = child;
  stdoutBuf = '';
  // 사이드카가 없거나 죽어도 창은 살아 있어야 한다. 대기 요청을 끊어 렌더러가 bridge_down을 표시하게 한다.
  const down = (reason) => {
    for (const id of [...pending.keys()]) settle(id).reject(new Error(reason));
    if (sidecar === child) sidecar = null;
  };
  // 실행 파일이 없으면(ENOENT) exit 없이 error만 온다. 정리하지 않으면 요청마다 타임아웃까지 기다린다.
  child.on('error', () => down('sidecar_spawn_failed'));
  child.stdin.on('error', () => down('sidecar_exited'));   // 종료 직후 write의 EPIPE
  child.stdout.setEncoding('utf-8');
  child.stdout.on('data', (chunk) => {
    stdoutBuf += chunk;
    let nl;
    while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, nl); stdoutBuf = stdoutBuf.slice(nl + 1);
      if (!line.trim()) continue;
      let msg; try { msg = JSON.parse(line); } catch (e) { continue; }
      const p = settle(msg.id);
      if (p) p.resolve(JSON.stringify(msg.result));
    }
  });
  child.on('exit', () => down('sidecar_exited'));
}

// 강제 kill은 사이드카의 종료 정리(stop → worker join/terminate)를 건너뛰어 worker를 오펀으로 남긴다.
// stdin EOF로 스스로 정리하게 하고, 정리 상한(join 3s + 2s)을 넘길 때만 kill한다.
const SIDECAR_EXIT_GRACE_MS = 8000;

function stopSidecar() {
  return new Promise((resolve) => {
    if (!sidecar) { resolve(); return; }
    const child = sidecar;
    const force = setTimeout(() => child.kill(), SIDECAR_EXIT_GRACE_MS);
    child.once('exit', () => { clearTimeout(force); resolve(); });
    child.stdin.end();
  });
}

function sidecarRequest(payloadString) {
  return new Promise((resolve, reject) => {
    if (!sidecar) { reject(new Error('sidecar_down')); return; }
    let args; try { args = JSON.parse(payloadString); } catch (e) { reject(e); return; }
    const id = nextId++;
    // 응답이 없거나 id가 매칭되지 않으면 영구 대기 대신 타임아웃으로 정리한다.
    const timer = setTimeout(() => { if (settle(id)) reject(new Error('sidecar_timeout')); }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    sidecar.stdin.write(JSON.stringify({ id, args }) + '\n');
  });
}

// ── 도크 ──
// 저장된 디스플레이를 id로, 없으면 같은 bounds로 찾는다(id는 재부팅·드라이버 변경에 바뀔 수 있다).
// 둘 다 없으면(분리·최초 실행) 주 모니터로 폴백한다.
function savedDisplay() {
  const all = screen.getAllDisplays();
  const saved = state.display;
  if (!saved) return screen.getPrimaryDisplay();
  const same = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  return all.find((d) => d.id === saved.id) || all.find((d) => same(d.bounds, saved.bounds)) || screen.getPrimaryDisplay();
}

// 상단 기준: y = 작업영역 위, 높이만 비율로. 가로는 도크 쪽 작업영역 끝에 밀착.
function dockBounds(display) {
  const wa = display.workArea;
  const height = Math.round(wa.height * state.heightPct / 100);
  const x = state.side === 'right' ? wa.x + wa.width - WIN_WIDTH : wa.x;
  return { x, y: wa.y, width: WIN_WIDTH, height };
}

const sameBounds = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

function rememberDisplay(display) {
  state.display = { id: display.id, bounds: display.bounds };
  windowState.save(state);
}

// 지정 디스플레이 끝에 도크한다. 배율이 다른 모니터로 넘어갈 때 첫 setBounds가 이전 배율로
// 환산돼 어긋날 수 있어, 결과가 다르면 한 번 더 맞춘다.
function dockTo(display) {
  if (!win || win.isDestroyed()) return;
  const target = dockBounds(display);
  if (!sameBounds(win.getBounds(), target)) {
    win.setBounds(target);
    if (!sameBounds(win.getBounds(), target)) win.setBounds(target);
  }
  rememberDisplay(display);
}

// 창이 지금 올라가 있는 디스플레이. 배율·해상도·작업표시줄이 바뀌어도 주 모니터로 끌고 오지 않는다.
const currentDisplay = () => screen.getDisplayMatching(win.getBounds());

// 사용자가 창을 다른 모니터로 옮기면(Win+Shift+방향키 등) 그 모니터 끝으로 재도크하고 저장한다.
// 우리 setBounds도 move를 내므로, 이동이 멈춘 뒤 목표 bounds와 다를 때만 다시 맞춘다.
let moveTimer = null;
function onMove() {
  clearTimeout(moveTimer);
  moveTimer = setTimeout(() => { if (win && !win.isDestroyed()) dockTo(currentDisplay()); }, MOVE_SETTLE_MS);
}

// ── 트레이(작업표시줄 숨김 연동) ──
function openAndExpand() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  win.webContents.send('window:expand');
}

function setTaskbarHidden(hide) {
  state.hideTaskbar = hide;
  windowState.save(state);
  if (!win) return;
  win.setSkipTaskbar(hide);
  // 작업표시줄에서 숨기면 종료·복귀 수단이 없어지므로 트레이가 대신한다.
  if (hide && !tray) {
    tray = new Tray(ICON);
    tray.setToolTip('Cat Talk');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '열기/펼치기', click: openAndExpand },
      { type: 'separator' },
      { label: '종료', click: () => win && win.close() },
    ]));
    tray.on('click', openAndExpand);
  } else if (!hide && tray) {
    tray.destroy(); tray = null;
  }
}

function createWindow() {
  const display = savedDisplay();
  win = new BrowserWindow({
    ...dockBounds(display), title: 'Cat Talk',
    icon: ICON,   // 창·작업표시줄 아이콘
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    alwaysOnTop: true, resizable: false, maximizable: false, fullscreenable: false, skipTaskbar: state.hideTaskbar,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  // 생성 직후에도 한 번 맞춘다(혼합 배율에서 생성 좌표가 어긋날 수 있다).
  dockTo(display);
  // 작업표시줄로 최소화했다 복원한 뒤 최상위가 풀린다는 보고가 있어 복원·표시 때마다 다시 건다.
  // 생성 옵션(alwaysOnTop: true)과 같은 기본 레벨. Windows에선 레벨과 무관하게 HWND_TOPMOST다.
  const keepOnTop = () => { if (win && !win.isDestroyed()) win.setAlwaysOnTop(true); };
  win.on('restore', keepOnTop);
  win.on('show', keepOnTop);
  setTaskbarHidden(state.hideTaskbar);
  win.on('move', onMove);
  // 투명 영역은 기본 클릭 통과. 렌더러가 패널·탭 위 커서를 알리면 그때만 클릭을 받는다.
  win.setIgnoreMouseEvents(true, { forward: true });
  // dev: Vite dev server(HMR). prod: vite build 산출물(renderer/dist)을 file://로 로딩.
  if (DEV) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'renderer', 'dist', 'index.html'));
}

ipcMain.handle('bridge-request', async (_e, payloadString) => {
  try { return await sidecarRequest(payloadString); }
  catch (e) { return JSON.stringify({ error: 'bridge_down' }); }
});

// 상자 자동 오픈(D-019). 설치는 Steam 재실행 전에 worker를 내려야 하므로 사이드카째 끄고 다시 켠다.
const chest = createAutoChest({
  dataDir: windowState.dataDir(),
  patcherExe: path.join(__dirname, '..', 'artifacts', 'auto_chest', 'AutoChestPatcher.exe'),
  sys: defaultSys((url) => shell.openExternal(url)),
  stopWorker: stopSidecar,
  startWorker: async () => { startSidecar(); },
  notify: (progress) => { if (win && !win.isDestroyed()) win.webContents.send('chest:progress', progress); },
});
ipcMain.handle('chest:status', (_e, wanted) => chest.status(wanted === true));
ipcMain.handle('chest:enable', () => chest.enable());
ipcMain.handle('chest:disable', () => chest.disable());
ipcMain.handle('chest:reapply', () => chest.reapply());
ipcMain.on('chest:cancel', () => chest.cancel());

// 렌더러가 저장된 값으로 시작하도록(기본값이 복원된 창을 덮어쓰지 않게) preload가 동기로 읽는다.
ipcMain.on('window:get-initial', (e) => {
  e.returnValue = { side: state.side, heightPct: state.heightPct, hideTaskbar: state.hideTaskbar };
});

// 렌더러 설정 ↔ 창. 값은 화이트리스트로 검증하고 범위 밖이면 무시한다.
ipcMain.on('window:set-dock-side', (_e, side) => {
  if (side !== 'left' && side !== 'right') return;
  state.side = side; dockTo(currentDisplay());
});
ipcMain.on('window:set-chat-height', (_e, pct) => {
  if (!windowState.HEIGHT_PCTS.includes(pct)) return;
  state.heightPct = pct; dockTo(currentDisplay());
});
ipcMain.on('window:set-skip-taskbar', (_e, hide) => {
  if (typeof hide === 'boolean') setTaskbarHidden(hide);
});
ipcMain.on('window:set-interactive', (_e, interactive) => {
  if (typeof interactive !== 'boolean' || !win) return;
  if (interactive) win.setIgnoreMouseEvents(false);
  else win.setIgnoreMouseEvents(true, { forward: true });
});

app.whenReady().then(() => {
  startSidecar(); createWindow();
  // 해상도·배율·작업표시줄 변화: 현재 디스플레이 기준으로 재도크. 그 디스플레이가 빠지면 남은 쪽으로.
  const redock = () => { if (win && !win.isDestroyed()) dockTo(currentDisplay()); };
  screen.on('display-metrics-changed', redock);
  screen.on('display-removed', redock);
});
app.on('window-all-closed', () => {
  windowState.flush(state);
  if (tray) { tray.destroy(); tray = null; }
  stopSidecar().then(() => app.quit());
});
