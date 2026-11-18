const { app, BrowserWindow, ipcMain, nativeImage, net, Notification, screen, shell, Tray, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const windowState = require('./window-state');
const displays = require('./displays');
const { createAutoChest, defaultSys } = require('./auto-chest');
const { countBadge, dotIcon } = require('./badge');
const { attachImeMemory } = require('./ime-memory');
const { createUpdater } = require('./updater');
const { createLogger } = require('./logger');
const { createReporter } = require('./report');
const { createPlaylistLinks } = require('./playlist');
const os = require('os');

const REQUEST_TIMEOUT_MS = 5000;
const DEV = process.env.CATTALK_DEV === '1';
const DEV_URL = 'http://localhost:5173';   // vite.config.mts의 DEV_PORT와 맞춘다
const ICON = path.join(__dirname, 'app-icon.ico');
// 설치본은 실행·읽기 파일(사이드카·Python 소스·패처·호환성 도구)을 asar 밖 resources에 둔다(package.json build.extraResources).
// dev는 레포 루트. 두 경우 모두 sidecar·src·artifacts의 상대 위치가 같아 사이드카(Python)는 경로를 바꾸지 않는다.
const RES = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
const APP_ID = 'CatTalk.Desktop';   // Windows 토스트 발신자
const WINDOW_APP_ID = 'CatTalk.Window';   // 작업표시줄용. 레지스트리에 등록하지 않는다(registerToastIdentity 참고)
// 항상 위 레벨. Windows Electron은 기본값 'floating'(~'status')이면 창이 활성화될 때마다 주 작업표시줄(Shell_TrayWnd) 바로 뒤로
// 옮긴다(native_window_views.cc MoveBehindTaskBarIfNeeded). 주 작업표시줄이 일반 창보다 아래에 놓인 상태(다중 모니터 등)에서는
// 열기(OPEN) 클릭 한 번에 Cat Talk가 일반 창 밑으로 내려갔다(실측 2026-11-16). 'pop-up-menu' 이상은 이 이동을 하지 않는다.
const TOPMOST_LEVEL = 'pop-up-menu';
// 디스플레이 [식별] 오버레이는 Cat Talk 창보다도 위(좌측 하단이라 왼쪽에 붙인 채팅 창과 겹칠 수 있다).
const IDENTIFY_LEVEL = 'screen-saver';

let win = null, tray = null, sidecar = null, nextId = 1, stdoutBuf = '';
const pending = new Map();   // id -> {resolve, reject, timer}

// 끝 도크 창: 패널 390 + 접기 탭 거터 34 + 탭 drop-shadow 여유 8(거터 쪽). 높이는 작업영역 비율.
const WIN_WIDTH = 432;
const MOVE_SETTLE_MS = 200;
// side·heightPct·hideTaskbar·displayIndex(디스플레이 번호, displays.js). 시작 시 디스크에서 읽고 바뀔 때마다 저장한다.
const state = windowState.load();

// dev(electron .)와 설치본이 같은 사용자 폴더를 쓰게 해 단일 실행 잠금을 공유한다. 기본값은 dev = package name('cat-talk'),
// 설치본 = productName('Cat Talk') 폴더라 그대로 두면 둘이 함께 켜져 게임에 사이드카가 둘 붙는다(D-030).
// 이름은 productName에 맞춘 %APPDATA%\Cat Talk(D-041. 전에는 cat-talk — 옮기지 않는다). 데이터 폴더(%LOCALAPPDATA%\CatTalk)도 공유한다.
app.setPath('userData', path.join(app.getPath('appData'), 'Cat Talk'));
// 잠금을 못 얻은 두 번째 실행은 첫 실행에 알리고(second-instance → 펼치기) 아무것도 시작하지 않고 끝난다(whenReady 참고).
// quit()만 부르면 whenReady의 시작 작업이 그대로 돌아, 꺼지기 전에 사이드카(와 worker)가 잠깐 뜬다(D-041 실측).
// 진단 로그(관측 전용, D-050). 동작은 바꾸지 않는다.
const log = createLogger(path.join(windowState.dataDir(), 'logs'));
log.main('start', { version: app.getVersion(), packaged: app.isPackaged, dev: DEV, pid: process.pid,
  electron: process.versions.electron, os: `${os.platform()} ${os.release()} ${os.arch()}` });
const primary = app.requestSingleInstanceLock();
log.main('instance_lock', { primary });
if (!primary) app.quit();
app.on('child-process-gone', (_e, d) => log.main('child_process_gone', { type: d.type, reason: d.reason, exitCode: d.exitCode, name: d.name || d.serviceName }));
app.on('gpu-info-update', () => log.main('gpu_info_update', app.getGPUFeatureStatus()));
app.on('will-quit', () => log.main('will_quit'));
const METRICS_MS = 60 * 1000;   // 사용자 결정
const logMetrics = () => log.main('metrics', app.getAppMetrics().map((m) => ({ type: m.type, pid: m.pid,
  cpu: Math.round(m.cpu.percentCPUUsage * 10) / 10, memKB: m.memory.workingSetSize })));
app.setAppUserModelId(APP_ID);
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
  // 설치본(app.isPackaged)은 PyInstaller 번들(resources/sidecar-bin, 창 없는 exe, D-036)을 띄운다 — 기기에 Python이 없어도 된다.
  // 소스 실행(dev·빌드 후 npm start)은 그대로 Python: upstream 소스는 3.10+ 문법(`dict | None`)이라 기본은 py 런처의 3.11,
  // CATTALK_PYTHON으로 override. dev는 로그 확인용으로 콘솔을 유지한다(py.exe + stderr 상속).
  const custom = process.env.CATTALK_PYTHON;
  const script = path.join(RES, 'sidecar', 'server.py');
  const [cmd, ...args] = app.isPackaged
    ? [path.join(RES, 'sidecar-bin', 'cattalk-sidecar.exe')]
    : DEV
      ? [...(custom ? [custom] : ['py', '-3.11']), script]
      : [...(custom ? [windowlessPython(custom)] : ['pyw', '-3.11']), script];
  // libuv는 상속 stdio가 하나도 없을 때만 CREATE_NO_WINDOW를 붙인다. 그래서 prod는 stderr를 상속 대신
  // 파이프로 받아 Electron stderr로 넘긴다(사이드카가 fd2를 fd1로 복제하므로 버리면 안 된다).
  // stderr는 dev도 파이프로 받아 진단 로그(sidecar.log)에 남기고 콘솔에도 그대로 넘긴다(D-050).
  const child = spawn(cmd, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: !DEV,
    // 설정 DB(settings.sqlite3)가 창 상태·패처 백업과 같은 데이터 폴더에 생기도록 main이 정한 폴더를 넘긴다(D-041).
    // CATTALK_LOG_DIR: 사이드카·worker의 faulthandler 파일 위치
    env: { ...process.env, CATTALK_DATA: windowState.dataDir(), CATTALK_LOG_DIR: log.dir },
  });
  log.main('sidecar_spawn', { pid: child.pid, cmd: path.basename(cmd) });
  child.stderr.on('data', (chunk) => {
    log.sidecar(chunk);
    try { process.stderr.write(chunk); } catch (e) { /* 콘솔 없음 */ }
  });
  child.on('error', (e) => log.main('sidecar_error', { code: e.code }));
  child.on('exit', (code, signal) => log.main('sidecar_exit', { pid: child.pid, code, signal }));
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
      // 사이드카 알림(요청 응답 아님, D-033 3단계): 게임 고양이 숨김 목록. 렌더러로 보내지 않고 main이 게임 폴더 파일에 쓴다.
      if (msg.event === 'hidden_ids') { chest.setHidden(msg.ids).catch(() => {}); continue; }
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
// 저장된 디스플레이 번호(사용자 명세, 2026-11-18). 그 번호 디스플레이가 없으면(분리·최초 실행) 주 모니터로 폴백하되 저장값은 그대로 둔다.
// 번호가 아직 없고 이전 버전이 남긴 {id,bounds}가 있으면 첫 실행 1회만 그걸로 찾아 그 번호를 저장한다(이어받기, 사용자 결정 2026-11-18):
// id로, 없으면 같은 bounds로(id는 재부팅·드라이버 변경에 바뀔 수 있다). 못 찾으면 주 모니터이고 저장하지 않는다.
function savedDisplay() {
  if (state.displayIndex) return displays.byNumber(screen, state.displayIndex) || screen.getPrimaryDisplay();
  const legacy = state.legacyDisplay;
  if (!legacy) return screen.getPrimaryDisplay();
  const all = screen.getAllDisplays();
  const found = all.find((d) => d.id === legacy.id) || all.find((d) => sameBounds(d.bounds, legacy.bounds));
  if (found) chooseDisplay(found);
  return found || screen.getPrimaryDisplay();
}

// 상단 기준: y = 작업영역 위, 높이만 비율로. 가로는 도크 쪽 작업영역 끝에 밀착.
function dockBounds(display) {
  const wa = display.workArea;
  const height = Math.round(wa.height * state.heightPct / 100);
  const x = state.side === 'right' ? wa.x + wa.width - WIN_WIDTH : wa.x;
  return { x, y: wa.y, width: WIN_WIDTH, height };
}

const sameBounds = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

// 저장(사용자 결정, 2026-11-18): displayIndex는 사용자가 고른 디스플레이만 쓴다 — 드로어 버튼과 창을 직접 옮긴 경우(Win+Shift+방향키 등),
// 그리고 이전 버전 저장값 이어받기 1회. 창 위치로 다시 판정하는 재도크(우리 setBounds 뒤 이동 알림, 디스플레이 추가/제거/배치 변경,
// 채팅 위치·높이 변경)는 저장하지 않는다. 전에는 모든 재도크가 getDisplayMatching 결과로 저장값을 덮어써,
// 버튼으로 고른 번호도 200ms 뒤 이동 알림 재도크가 다시 썼고 종료 때 마지막 재판정 값이 남았다(2026-11-18 조사).
function chooseDisplay(display) {
  const n = displays.numberOf(screen, display);
  if (!n) return;
  state.displayIndex = n;
  windowState.save(state);
}

// 창이 도크된 디스플레이 id(display-removed에서 창이 있던 곳인지 가린다)와 도크 직후 실제 bounds(직접 이동 판정).
let dockedId = null, dockedBounds = null;
// 이 시각 전의 이동은 직접 이동으로 보지 않는다: 우리 setBounds 뒤 늦게 오는 배율 보정(WM_DPICHANGED)·디스플레이 변경 때 OS의 창 재배치.
let autoMoveUntil = 0;
const AUTO_MOVE_GRACE_MS = 1000;
function autoMove() { autoMoveUntil = Date.now() + AUTO_MOVE_GRACE_MS; }

// 지정 디스플레이 끝에 도크한다(저장은 하지 않는다 — chooseDisplay). 배율이 다른 모니터로 넘어갈 때 첫 setBounds가 이전 배율로
// 환산돼 어긋날 수 있어, 결과가 다르면 한 번 더 맞춘다.
function dockTo(display) {
  if (!win || win.isDestroyed()) return;
  const target = dockBounds(display);
  if (!sameBounds(win.getBounds(), target)) {
    autoMove();
    win.setBounds(target);
    if (!sameBounds(win.getBounds(), target)) win.setBounds(target);
  }
  dockedId = display.id;
  dockedBounds = win.getBounds();
  publishDisplays();
}

// 창이 지금 올라가 있는 디스플레이. 배율·해상도·작업표시줄이 바뀌어도 주 모니터로 끌고 오지 않는다.
const currentDisplay = () => screen.getDisplayMatching(win.getBounds());

// 드로어 '디스플레이 선택'(사용자 명세, 2026-11-18): 디스플레이 수와 지금 창이 있는 디스플레이의 번호.
// 도크할 때마다(선택·창 이동·디스플레이 추가/제거/배치 변경) 렌더러에 다시 알린다 — 버튼 수·하이라이트가 따라온다.
function displayInfo() {
  const count = screen.getAllDisplays().length;
  const current = win && !win.isDestroyed() ? displays.numberOf(screen, currentDisplay()) : 0;
  return { count, current };
}
function publishDisplays() {
  if (win && !win.isDestroyed()) win.webContents.send('display:changed', displayInfo());
}

// 항상 위 레벨은 TOPMOST_LEVEL. 생성 옵션 alwaysOnTop: true는 기본 레벨 'floating'이라 바로 덮어쓴다.
// 작업표시줄로 최소화했다 복원한 뒤 최상위가 풀린다는 보고가 있어 복원·표시 때마다, 디스플레이를 옮긴 뒤에도 다시 건다.
function keepOnTop() { if (win && !win.isDestroyed()) win.setAlwaysOnTop(true, TOPMOST_LEVEL); }

const identifier = displays.createIdentifier({ BrowserWindow, screen, level: IDENTIFY_LEVEL });

// 사용자가 창을 다른 모니터로 옮기면(Win+Shift+방향키 등) 그 모니터 끝으로 재도크하고 저장한다(사용자 결정, 2026-11-18).
// 우리 setBounds도 move를 내므로, 이동이 멈춘 뒤 목표 bounds와 다를 때만 다시 맞춘다.
// 직접 이동 = 도크 직후 bounds에서 벗어났고 자동 이동 유예(autoMoveUntil) 밖. 저장은 유예만큼 미뤄, 그사이 디스플레이 변경
// 알림이 오면(OS가 창을 먼저 옮기고 알림이 늦게 온 경우) 취소한다(displayChanged). 미룬 저장은 그때 창이 있는 디스플레이를 쓴다
// (Win+Shift+방향키를 빠르게 두 번 눌러 모니터를 건너뛰면 두 번째 이동은 재도크 유예 안이라 따로 잡히지 않지만, 마지막 모니터가 저장된다).
let moveTimer = null, manualSaveTimer = null;
function onMove() {
  clearTimeout(moveTimer);
  moveTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    const manual = Date.now() >= autoMoveUntil && dockedBounds && !sameBounds(win.getBounds(), dockedBounds);
    dockTo(currentDisplay());
    if (!manual) return;
    clearTimeout(manualSaveTimer);
    manualSaveTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      chooseDisplay(currentDisplay());
      log.main('display_moved', { number: state.displayIndex, count: screen.getAllDisplays().length });
    }, AUTO_MOVE_GRACE_MS);
  }, MOVE_SETTLE_MS);
}
// 디스플레이 추가·제거·배치 변경: 이 무렵의 이동은 OS·재도크 몫이라 직접 이동으로 저장하지 않는다.
function displayChanged() { autoMove(); clearTimeout(manualSaveTimer); }

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
  applyTaskbarAlert();
}

// ── 새 메시지 알림 ──
// 안 읽은 수는 렌더러가 세어 넘긴다(안 보는 동안 받은 타인 메시지. 다시 보면 0).
const TOAST_BODY = '새 메시지가 있습니다';   // 발신자·내용은 넣지 않는다
let unread = 0, showBadge = false, toast = null, trayDot = null;

// 아이콘이 작업표시줄에 있으면 숫자 배지, 숨겼으면 트레이 빨간 점. 읽으면(0) 원래대로.
function applyTaskbarAlert() {
  if (!win || win.isDestroyed()) return;
  const on = showBadge && unread > 0;
  win.setOverlayIcon(on && !state.hideTaskbar ? countBadge(unread) : null, on ? `새 메시지 ${unread}개` : '');
  if (tray) {
    if (on && !trayDot) trayDot = dotIcon(ICON);
    tray.setImage(on ? trayDot : ICON);
  }
}

// 패키징 전 exe는 Windows가 토스트 발신자를 'Electron'으로 표시한다. 앱 ID에 이름·아이콘을 등록한다(HKCU, 관리자 권한 불필요).
function registerToastIdentity() {
  if (process.platform !== 'win32') return;
  const key = `HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}`;
  const iconFile = path.join(windowState.dataDir(), 'toast-icon.png');
  try {
    fs.mkdirSync(path.dirname(iconFile), { recursive: true });
    fs.writeFileSync(iconFile, nativeImage.createFromPath(ICON).toPNG());
  } catch (e) { return; }
  for (const [name, value] of [['DisplayName', 'Cat Talk'], ['IconUri', iconFile]]) {
    execFile('reg', ['add', key, '/v', name, '/t', 'REG_EXPAND_SZ', '/d', value, '/f'], { windowsHide: true }, () => {});
  }
}

// 토스트는 다시 볼 때까지 1회만 띄운다.
function showToast() {
  if (toast || !Notification.isSupported()) return;
  toast = new Notification({ title: 'Cat Talk', body: TOAST_BODY, icon: ICON });
  toast.on('click', openAndExpand);
  toast.show();
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
      backgroundThrottling: false,   // 최소화 중에도 폴링이 늦어지지 않아야 알림이 제때 뜬다
    },
  });
  // 등록된 앱 ID를 쓰면 작업표시줄이 창 아이콘 대신 exe 아이콘을 보여 준다. 창에는 등록하지 않은 ID를 따로 준다.
  if (process.platform === 'win32') win.setAppDetails({ appId: WINDOW_APP_ID });
  log.main('window_created', { bounds: win.getBounds() });
  win.webContents.on('render-process-gone', (_e, d) => log.main('render_process_gone', { reason: d.reason, exitCode: d.exitCode }));
  win.webContents.on('did-finish-load', () => log.main('renderer_loaded'));
  win.webContents.on('did-fail-load', (_e, code, desc) => log.main('renderer_load_failed', { code, desc }));
  win.on('unresponsive', () => log.main('window_unresponsive'));
  win.on('responsive', () => log.main('window_responsive'));
  // 생성 직후에도 한 번 맞춘다(혼합 배율에서 생성 좌표가 어긋날 수 있다). 생성 직후의 배율 보정 이동은 직접 이동이 아니다.
  autoMove();
  dockTo(display);
  keepOnTop();
  win.on('restore', keepOnTop);
  win.on('show', keepOnTop);
  win.on('closed', identifier.close);   // 식별 오버레이가 떠 있는 채로 끄면 같이 닫는다(남은 창이 종료를 늦추지 않게)
  attachImeMemory(win);
  setTaskbarHidden(state.hideTaskbar);
  win.on('move', onMove);
  // 투명 영역은 기본 클릭 통과. 렌더러가 패널·탭 위 커서를 알리면 그때만 클릭을 받는다.
  win.setIgnoreMouseEvents(true, { forward: true });
  // dev: Vite dev server(HMR). prod: vite build 산출물(renderer/dist)을 file://로 로딩.
  if (DEV) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'renderer', 'dist', 'index.html'));
}

// 프로필 열기·교환 페이지 열기: 사이드카가 대상을 검증해 준 URI를 main이 형식을 다시 확인하고 연다.
// URI는 렌더러로 넘기지 않는다. 둘 다 Steam 클라이언트에서 열린다(교환은 전용 딥링크가 없어 https 페이지를 steam://openurl/로 감싼다).
const STEAM_LINKS = new Map([
  ['open_steam_profile', { pattern: /^steam:\/\/url\/SteamIDPage\/[0-9]+$/, failed: 'steam_profile_failed' }],
  ['open_steam_trade', { pattern: /^steam:\/\/openurl\/https:\/\/steamcommunity\.com\/tradeoffer\/new\/\?partner=[0-9]+$/, failed: 'steam_trade_failed' }],
]);
async function openSteamLink(payloadString, link) {
  const result = JSON.parse(await sidecarRequest(payloadString));
  if (result.error) return JSON.stringify(result);
  if (!link.pattern.test(result.uri)) return JSON.stringify({ error: link.failed });
  try { await shell.openExternal(result.uri); }
  catch (e) { return JSON.stringify({ error: link.failed }); }
  return JSON.stringify({ ok: true });
}

ipcMain.handle('bridge-request', async (_e, payloadString) => {
  try {
    const link = STEAM_LINKS.get(JSON.parse(payloadString).action);
    if (link) return await openSteamLink(payloadString, link);
    return await sidecarRequest(payloadString);
  }
  catch (e) { return JSON.stringify({ error: 'bridge_down' }); }
});

// 상자 자동 오픈(D-019)·모든 고양이 투명화(D-028). 설치는 Steam 재실행 전에 worker를 내려야 하므로 사이드카째 끄고 다시 켠다.
// 기능 이름('chest' | 'transparent')은 auto-chest가 검증한다. 차단 멤버 고양이 숨김 목록(D-033 3단계)은 사이드카 알림을 받아 auto-chest가 쓴다.
const chest = createAutoChest({
  dataDir: windowState.dataDir(),
  patcherExe: path.join(RES, 'artifacts', 'auto_chest', 'AutoChestPatcher.exe'),
  // 설치 사전 점검이 패치 결과의 Cat Talk 연결 호환성 지문을 원본과 비교한다(D-033 3단계). 사이드카가 쓰는 것과 같은 도구·계약이다.
  probeExe: path.join(RES, 'artifacts', 'compatibility', 'FeatureProbe.exe'),
  featureContract: path.join(RES, 'src', 'bongo_chat', 'feature-contract.json'),
  sys: defaultSys((url) => shell.openExternal(url)),
  stopWorker: stopSidecar,
  startWorker: async () => { startSidecar(); },
  notify: (progress) => { if (win && !win.isDestroyed()) win.webContents.send('chest:progress', progress); },
  // 숨김 목록이 바뀌면 렌더러가 원본 복원 제안을 다시 판정한다(D-038)
  changed: () => { if (win && !win.isDestroyed()) win.webContents.send('chest:changed'); },
});
ipcMain.handle('chest:status', (_e, wanted) => chest.status(wanted === true));
ipcMain.handle('chest:enable', (_e, feature) => chest.enable(feature));
ipcMain.handle('chest:disable', (_e, feature) => chest.disable(feature));
ipcMain.handle('chest:reapply', (_e, features) => chest.reapply(features));
ipcMain.handle('chest:restore', () => chest.restore());
ipcMain.on('chest:cancel', () => chest.cancel());
// 드로어 '게임 재시작'·'게임 실행'. 상자 흐름과 같은 게임 조작·카운트다운(chest:cancel)·진행 알림(chest:progress, action 'restart'|'launch')을 쓴다.
// 사이드카는 내리지 않는다(대화 기록 유지): 게임이 꺼지면 사이드카가 Steam을 놓은 worker를 새로 띄워 Steam의 '실행 중'이 풀린다.
ipcMain.handle('game:status', () => chest.gameStatus());
ipcMain.handle('game:restart', () => chest.restartGame());

// 앱 자동 업데이트(D-030). 설치본에서만 확인·내려받기를 한다(dev는 electron-updater를 읽지도 않는다).
// 적용 전에 사이드카를 정상 종료해 worker를 남기지 않는다.
const updater = createUpdater({
  packaged: app.isPackaged,
  autoUpdater: app.isPackaged ? require('electron-updater').autoUpdater : null,
  notify: (status) => { if (win && !win.isDestroyed()) win.webContents.send('update:status', status); },
  beforeInstall: async () => { windowState.flush(state); await stopSidecar(); },
});
ipcMain.handle('update:status', () => updater.status());
// 드로어를 열 때(manual=false)와 [다시 시도](manual=true). 진행 중·준비됨·직전 확인 30초 이내(manual 제외)면 묻지 않는다
ipcMain.handle('update:check', (_e, manual) => updater.check(manual === true));
ipcMain.handle('update:install', () => updater.install());

// 버그 신고·요청 사항(D-050). 웹훅 URL·태그·첨부는 main만 다룬다(렌더러는 제목·내용·연결 상태만 넘긴다).
const reporter = createReporter({ logDir: log.dir, log, openPath: (p) => shell.openPath(p) });
ipcMain.on('report:available', (e) => { e.returnValue = reporter.available(); });
ipcMain.handle('report:preview', () => reporter.preview());
ipcMain.handle('report:open-preview', () => reporter.openPreview());
ipcMain.handle('report:submit', (_e, args) => reporter.submit(args));

// 플레이리스트 공유(D-053, /플리): 영상 제목 조회(oEmbed → og:title)와 외부 브라우저 재생. 렌더러는 영상 ID만 넘기고 URL은 main이 만든다
const playlistLinks = createPlaylistLinks({ net, openExternal: (url) => shell.openExternal(url), log: (event, data) => log.main(event, data) });
ipcMain.handle('playlist:title', (_e, id) => playlistLinks.title(id));
ipcMain.handle('playlist:open', (_e, ids) => playlistLinks.open(ids));

// 앱 버전(package.json의 version). 드로어 표시용이며, 업데이트를 붙이면 electron-updater도 이 값을 기준으로 비교한다.
ipcMain.on('app:get-version', (e) => { e.returnValue = app.getVersion(); });

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
// 드로어 '디스플레이 선택'(사용자 명세, 2026-11-18). 번호는 displays.js 순번(1부터)이고, 없는 번호는 무시한다.
// 옮길 때 채팅 위치(좌/우)·높이 비율은 그대로(dockBounds: 대상 작업영역 그쪽 끝·맨 위). 옮긴 뒤 항상 위를 다시 건다.
// 저장은 고른 번호 그대로(창 위치로 다시 판정하지 않는다). 직전 직접 이동의 미뤄 둔 저장은 버린다.
ipcMain.handle('display:info', () => displayInfo());
ipcMain.on('display:select', (_e, n) => {
  const target = displays.byNumber(screen, n);
  if (!target || !win || win.isDestroyed()) return;
  clearTimeout(manualSaveTimer);
  dockTo(target);
  chooseDisplay(target);
  keepOnTop();
  log.main('display_selected', { number: n, count: screen.getAllDisplays().length, scale: target.scaleFactor });
});
ipcMain.on('display:identify', () => identifier.show());
ipcMain.on('alert:unread', (_e, alert) => {
  if (!Number.isInteger(alert?.count) || alert.count < 0) return;
  const grew = alert.count > unread;
  unread = alert.count;
  showBadge = alert.taskbar === true;
  if (grew && alert.toast === true) showToast();
  if (unread === 0 && toast) { toast.close(); toast = null; }
  applyTaskbarAlert();
});
ipcMain.on('window:set-interactive', (_e, interactive) => {
  if (typeof interactive !== 'boolean' || !win) return;
  if (interactive) win.setIgnoreMouseEvents(false);
  else win.setIgnoreMouseEvents(true, { forward: true });
});

app.whenReady().then(() => {
  if (!primary) return;   // 두 번째 실행: 사이드카·창·업데이트 확인·토스트 등록을 하지 않는다
  registerToastIdentity();
  log.main('ready', { gpu: app.getGPUFeatureStatus() });
  logMetrics();
  setInterval(logMetrics, METRICS_MS).unref?.();
  startSidecar(); createWindow();
  updater.start();
  // 해상도·배율·작업표시줄·배치 변화와 디스플레이 추가: 현재 디스플레이 기준으로 재도크(창은 그 자리)하고 드로어 버튼을 갱신한다.
  // 번호가 밀려도 저장값은 고른 번호 그대로다(사용자 결정, 2026-11-18).
  const redock = () => { displayChanged(); if (win && !win.isDestroyed()) dockTo(currentDisplay()); };
  screen.on('display-metrics-changed', redock);
  screen.on('display-added', () => { log.main('display_added', { count: screen.getAllDisplays().length }); redock(); });
  // 창이 있던 디스플레이가 빠지면 주 디스플레이로 옮긴다(사용자 명세). 다른 디스플레이가 빠지면 그 자리에서 버튼만 갱신한다.
  // 어느 쪽이든 저장값은 고른 번호 그대로라, 그 모니터를 다시 연결하고 재실행하면 원래 모니터로 돌아간다(사용자 결정, 2026-11-18).
  screen.on('display-removed', (_e, old) => {
    displayChanged();
    if (!win || win.isDestroyed()) return;
    const active = old.id === dockedId;
    log.main('display_removed', { count: screen.getAllDisplays().length, active });
    dockTo(active ? screen.getPrimaryDisplay() : currentDisplay());
    if (active) keepOnTop();
  });
});
app.on('window-all-closed', () => {
  windowState.flush(state);
  if (tray) { tray.destroy(); tray = null; }
  stopSidecar().then(() => app.quit());
});
