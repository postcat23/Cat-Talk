// 앱 자동 업데이트(D-030). 설치본(NSIS)에서만 동작하고 dev(npm start)는 'disabled'다.
// 채널은 GitHub Releases(postcat23/Cat-Talk, package.json build.publish). 켤 때와 6시간마다 확인하고 새 버전은 백그라운드로
// 내려받는다. 적용은 사용자의 [업데이트](재시작)나 다음 정상 종료 때(autoInstallOnAppQuit).
// 레포가 비공개인 동안은 토큰이 없어 확인이 실패한다. 실패는 알리지 않고 'unknown'으로만 둔다 — 화면은 '최신'이라고 단정하지 않는다.
// 서명하지 않은 빌드는 app-update.yml에 publisherName이 없어 electron-updater가 서명 검증을 건너뛴다(6.8.x 실측, 해시 검증은 한다).
// autoUpdater는 주입받아 실제 업데이트 서버 없이 상태 흐름을 시험할 수 있다.
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// state: disabled(설치본 아님) · idle(확인 전) · checking · latest · downloading · ready(내려받음, 적용 대기) · unknown(확인 실패)
function createUpdater({ packaged, autoUpdater, notify, beforeInstall, every = setInterval }) {
  let status = { state: packaged ? 'idle' : 'disabled' };
  if (!packaged) return { status: () => status, start() {}, async install() { return { ok: false, reason: 'disabled' }; } };

  const set = (next) => { status = next; notify(status); };
  const ready = () => status.state === 'ready';
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;   // [업데이트]를 누르지 않아도 다음 정상 종료 때 설치한다
  autoUpdater.on('checking-for-update', () => { if (!ready()) set({ state: 'checking' }); });
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info?.version }));
  autoUpdater.on('update-not-available', () => { if (!ready()) set({ state: 'latest' }); });
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info?.version }));
  // 비공개 레포·오프라인·내려받기 실패. 이미 내려받아 둔 업데이트는 그대로 둔다
  autoUpdater.on('error', () => { if (!ready()) set({ state: 'unknown' }); });

  // 내려받아 둔 업데이트가 있으면 더 확인하지 않는다(적용 전 새 버전은 다음 실행에서 다시 확인한다)
  const check = () => { if (!ready()) autoUpdater.checkForUpdates().catch(() => {}); };
  let installing = false;
  return {
    status: () => status,
    start() { check(); every(check, CHECK_INTERVAL_MS); },
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

module.exports = { createUpdater, CHECK_INTERVAL_MS };
