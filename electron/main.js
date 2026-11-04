const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

const REQUEST_TIMEOUT_MS = 5000;
const DEV = process.env.CATTALK_DEV === '1';
const DEV_URL = 'http://localhost:5173';   // vite.config.mts의 DEV_PORT와 맞춘다

let win = null, sidecar = null, nextId = 1, stdoutBuf = '';
const pending = new Map();   // id -> {resolve, reject, timer}

// 끝 도크 창: 패널 390 + 접기 탭 거터 34 + 탭 drop-shadow 여유 8(거터 쪽). 높이는 작업영역 비율.
const WIN_WIDTH = 432;
const HEIGHT_PCTS = [100, 70, 50];
const dock = { side: 'right', heightPct: 100 };

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
});

function settle(id) {
  const p = pending.get(id);
  if (p) { pending.delete(id); clearTimeout(p.timer); }
  return p;
}

function startSidecar() {
  // upstream 소스는 3.10+ 문법(`dict | None`)이라 기본은 py 런처의 3.11. CATTALK_PYTHON으로 override.
  const [py, ...pyArgs] = process.env.CATTALK_PYTHON ? [process.env.CATTALK_PYTHON] : ['py', '-3.11'];
  sidecar = spawn(py, [...pyArgs, path.join(__dirname, '..', 'sidecar', 'server.py')], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  sidecar.stdout.setEncoding('utf-8');
  sidecar.stdout.on('data', (chunk) => {
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
  sidecar.on('exit', () => {
    for (const id of [...pending.keys()]) settle(id).reject(new Error('sidecar_exited'));
    sidecar = null;
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

// 상단 기준: y = 작업영역 위, 높이만 비율로. 가로는 도크 쪽 작업영역 끝에 밀착.
function dockBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  const height = Math.round(wa.height * dock.heightPct / 100);
  const x = dock.side === 'right' ? wa.x + wa.width - WIN_WIDTH : wa.x;
  return { x, y: wa.y, width: WIN_WIDTH, height };
}

function applyDock() {
  if (win && !win.isDestroyed()) win.setBounds(dockBounds());
}

function createWindow() {
  win = new BrowserWindow({
    ...dockBounds(), title: 'Cat-Talk (dev)',
    icon: path.join(__dirname, 'app-icon.ico'),   // 창·작업표시줄 아이콘
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    alwaysOnTop: true, resizable: false, maximizable: false, fullscreenable: false, skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
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

// 렌더러 설정 ↔ 창. 값은 화이트리스트로 검증하고 범위 밖이면 무시한다.
ipcMain.on('window:set-dock-side', (_e, side) => {
  if (side !== 'left' && side !== 'right') return;
  dock.side = side; applyDock();
});
ipcMain.on('window:set-chat-height', (_e, pct) => {
  if (!HEIGHT_PCTS.includes(pct)) return;
  dock.heightPct = pct; applyDock();
});
ipcMain.on('window:set-skip-taskbar', (_e, hide) => {
  if (typeof hide === 'boolean' && win) win.setSkipTaskbar(hide);
});
ipcMain.on('window:set-interactive', (_e, interactive) => {
  if (typeof interactive !== 'boolean' || !win) return;
  if (interactive) win.setIgnoreMouseEvents(false);
  else win.setIgnoreMouseEvents(true, { forward: true });
});

app.whenReady().then(() => {
  startSidecar(); createWindow();
  // 작업표시줄 이동·해상도 변경 시 작업영역이 바뀌므로 도크를 다시 맞춘다.
  screen.on('display-metrics-changed', applyDock);
});
// 강제 kill은 사이드카의 종료 정리(stop → worker join/terminate)를 건너뛰어 worker를 오펀으로 남긴다.
// stdin EOF로 스스로 정리하게 하고, 정리 상한(join 3s + 2s)을 넘길 때만 kill한다.
const SIDECAR_EXIT_GRACE_MS = 8000;

app.on('window-all-closed', () => {
  if (!sidecar) { app.quit(); return; }
  const child = sidecar;
  const force = setTimeout(() => child.kill(), SIDECAR_EXIT_GRACE_MS);
  child.once('exit', () => { clearTimeout(force); app.quit(); });
  child.stdin.end();
});
