// 앱 자동 업데이트(D-030). 설치본(NSIS)에서만 동작하고 dev(npm start)는 'disabled'다.
// 채널은 GitHub Releases(postcat23/Cat-Talk, package.json build.publish). 켤 때·2시간마다·드로어를 열 때(check) 확인하고
// 새 버전은 백그라운드로 내려받는다. 적용은 사용자의 [재시작하여 설치]·토스트 [업데이트]나 다음 정상 종료 때(autoInstallOnAppQuit).
// 실패는 확인(check_failed)과 내려받기(download_failed)를 나눠 드로어에 보이고 [다시 시도](check(true))로 다시 묻는다.
// 서명하지 않은 빌드는 app-update.yml에 publisherName이 없어 electron-updater가 서명 검증을 건너뛴다(6.8.x 실측, 해시 검증은 한다).
// autoUpdater는 주입받아 실제 업데이트 서버 없이 상태 흐름을 시험할 수 있다.
const CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000;
// 직전 확인을 시작한 지 이보다 짧으면 드로어 열기·주기 확인은 다시 묻지 않는다([다시 시도]는 예외)
const RECHECK_GAP_MS = 30 * 1000;

// state: disabled(설치본 아님) · idle(확인 전) · checking · latest · downloading(version, percent) · ready(내려받음, 적용 대기)
//        · check_failed(확인 실패) · download_failed(내려받기 실패, version)
function createUpdater({ packaged, autoUpdater, notify, beforeInstall, every = setInterval, now = Date.now }) {
  let status = { state: packaged ? 'idle' : 'disabled' };
  if (!packaged) {
    return {
      status: () => status, start() {},
      check() { return { ok: false, reason: 'disabled' }; },
      async install() { return { ok: false, reason: 'disabled' }; },
    };
  }

  const set = (next) => { status = next; notify(status); };
  const ready = () => status.state === 'ready';
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;   // [업데이트]를 누르지 않아도 다음 정상 종료 때 설치한다
  autoUpdater.on('checking-for-update', () => { if (!ready()) set({ state: 'checking' }); });
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info?.version, percent: 0 }));
  // 진행률은 정수 %로 내림한다(같은 값이면 알리지 않는다). electron-updater는 1초 간격으로 보낸다
  autoUpdater.on('download-progress', (p) => {
    if (status.state !== 'downloading') return;
    const percent = Math.min(100, Math.max(0, Math.floor(Number(p?.percent) || 0)));
    if (percent !== status.percent) set({ ...status, percent });
  });
  autoUpdater.on('update-not-available', () => { if (!ready()) set({ state: 'latest' }); });
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info?.version }));
  // 확인·내려받기 실패는 같은 'error'로 온다 — 내려받는 중이었으면 내려받기 실패다. 이미 내려받아 둔 업데이트는 그대로 둔다
  autoUpdater.on('error', () => {
    if (ready()) return;
    if (status.state === 'downloading') set({ state: 'download_failed', version: status.version });
    else set({ state: 'check_failed' });
  });

  // 확인 중·내려받는 중·준비됨이면 묻지 않는다. 내려받는 중에 다시 물으면 electron-updater가 checking을 다시 보내
  // 화면이 '확인 중'으로 돌아가고, 내려받아 둔 업데이트가 있으면 적용 전 새 버전은 다음 실행에서 다시 확인한다.
  // manual([다시 시도])은 30초 간격만 건너뛴다. 내려받기 실패 뒤 다시 확인하면 autoDownload가 다시 내려받는다
  let lastCheck = -Infinity;
  const check = (manual = false) => {
    if (status.state === 'checking' || status.state === 'downloading' || ready()) return { ok: false, reason: status.state };
    if (!manual && now() - lastCheck < RECHECK_GAP_MS) return { ok: false, reason: 'recent' };
    lastCheck = now();
    // 실패는 'error' 이벤트가 상태로 알린다. autoDownload의 내려받기 promise도 받아 둔다(안 받으면 unhandled rejection 경고)
    autoUpdater.checkForUpdates().then((r) => r?.downloadPromise?.catch(() => {})).catch(() => {});
    return { ok: true };
  };
  let installing = false;
  return {
    status: () => status,
    start() { check(); every(() => check(), CHECK_INTERVAL_MS); },
    check,
    async install() {
      if (!ready()) return { ok: false, reason: status.state };
      if (installing) return { ok: false, reason: 'busy' };
      installing = true;
      // 사이드카(worker)를 정상 종료한다. 강제 종료는 worker를 오펀으로 남긴다. app.quit() 경로는 window-all-closed를 거치지 않는다
      await beforeInstall();
      autoUpdater.quitAndInstall(true, true);   // 조용히 설치하고 다시 실행한다
      return { ok: true };
    },
  };
}

module.exports = { createUpdater, CHECK_INTERVAL_MS, RECHECK_GAP_MS };
