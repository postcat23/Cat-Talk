const { contextBridge, ipcRenderer } = require('electron');
// 렌더러는 window.bridge.request(payloadString) -> Promise<responseString>
// (원본 QWebChannel bridge.request와 역할 동일. 2단계 React 포팅에서 rpc() 래퍼가 감싼다.)
contextBridge.exposeInMainWorld('bridge', {
  request: (payloadString) => ipcRenderer.invoke('bridge-request', payloadString),
});

// 창 제어(끝 도크·높이·작업표시줄·클릭 통과). 브라우저 dev에는 없으므로 렌더러는 존재 여부로 분기한다.
contextBridge.exposeInMainWorld('catTalk', {
  // 디스크에 저장된 창 설정(도크·높이·작업표시줄 숨김). 렌더러 초기 상태로 쓴다.
  initial: ipcRenderer.sendSync('window:get-initial'),
  // 앱 버전(main의 app.getVersion() = package.json). 드로어 '앱 업데이트'에 표시한다.
  version: ipcRenderer.sendSync('app:get-version'),
  // 앱 자동 업데이트(D-030). 설치본에서만 동작하고 dev는 state 'disabled'. install은 내려받아 둔 업데이트를 재시작으로 적용한다.
  // check는 드로어를 열 때(manual=false)와 [다시 시도](manual=true) 확인 요청이다.
  update: {
    status: () => ipcRenderer.invoke('update:status'),
    check: (manual) => ipcRenderer.invoke('update:check', manual === true),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: (cb) => {
      const listener = (_e, status) => cb(status);
      ipcRenderer.on('update:status', listener);
      return () => ipcRenderer.removeListener('update:status', listener);
    },
  },
  // 버그 신고·요청 사항(D-050). available은 빌드에 웹훅이 들어 있는지. preview는 첨부될 로그 목록·크기,
  // openPreview는 첨부될 내용(식별자 지운 뒤)을 임시 파일로 연다. submit({kind:'bug'|'request', title, body, conn})
  report: {
    available: ipcRenderer.sendSync('report:available'),
    preview: () => ipcRenderer.invoke('report:preview'),
    openPreview: () => ipcRenderer.invoke('report:open-preview'),
    submit: (args) => ipcRenderer.invoke('report:submit', args),
  },
  // 트레이 '열기/펼치기'·두 번째 실행 시 접힌 패널을 펼친다. 해제 함수를 돌려준다.
  onExpand: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('window:expand', listener);
    return () => ipcRenderer.removeListener('window:expand', listener);
  },
  // 드로어 '디스플레이 선택'(사용자 명세, 2026-11-18). info·onChange는 {count, current}(디스플레이 수, 지금 창이 있는 디스플레이 번호 1부터).
  // 번호는 왼쪽부터(bounds.x, 같으면 y) 센 순번이고 식별 오버레이 번호와 같다. select(n)는 그 디스플레이로 창을 옮기고, identify는 번호를 띄운다.
  display: {
    info: () => ipcRenderer.invoke('display:info'),
    select: (n) => ipcRenderer.send('display:select', n),
    identify: () => ipcRenderer.send('display:identify'),
    onChange: (cb) => {
      const listener = (_e, info) => cb(info);
      ipcRenderer.on('display:changed', listener);
      return () => ipcRenderer.removeListener('display:changed', listener);
    },
  },
  setDockSide: (side) => ipcRenderer.send('window:set-dock-side', side),
  setChatHeight: (pct) => ipcRenderer.send('window:set-chat-height', pct),
  setSkipTaskbar: (hide) => ipcRenderer.send('window:set-skip-taskbar', hide),
  setInteractive: (interactive) => ipcRenderer.send('window:set-interactive', interactive),
  // 안 읽은 수({count, toast, taskbar}). 수와 토글은 렌더러가 정하고, 표시는 main이 맡는다.
  setUnread: (alert) => ipcRenderer.send('alert:unread', alert),
  // 상자 자동 오픈(D-019)·모든 고양이 투명화(D-028). status는 판정만(쓰기 없음), wanted = 어느 기능이든 설정 ON 여부.
  // feature = 'chest' | 'transparent', reapply는 설정이 켜진 기능 목록. restore는 원본 복원 토스트(D-038).
  chest: {
    status: (wanted) => ipcRenderer.invoke('chest:status', wanted),
    enable: (feature) => ipcRenderer.invoke('chest:enable', feature),
    disable: (feature) => ipcRenderer.invoke('chest:disable', feature),
    reapply: (features) => ipcRenderer.invoke('chest:reapply', features),
    restore: () => ipcRenderer.invoke('chest:restore'),
    cancel: () => ipcRenderer.send('chest:cancel'),
    onProgress: (cb) => {
      const listener = (_e, progress) => cb(progress);
      ipcRenderer.on('chest:progress', listener);
      return () => ipcRenderer.removeListener('chest:progress', listener);
    },
    // 원본 복원 제안 판정이 바뀌었을 수 있음(숨김 목록 변경). 렌더러는 상태를 다시 묻는다
    onChanged: (cb) => {
      const listener = () => cb();
      ipcRenderer.on('chest:changed', listener);
      return () => ipcRenderer.removeListener('chest:changed', listener);
    },
  },
  // 드로어 '게임 재시작'·'게임 실행'. status는 {found, running}. restart는 켜져 있으면 카운트다운 뒤 재시작, 꺼져 있으면 실행만 한다.
  // 진행·취소는 chest.onProgress·chest.cancel을 같이 쓴다(action 'restart' | 'launch').
  game: {
    status: () => ipcRenderer.invoke('game:status'),
    restart: () => ipcRenderer.invoke('game:restart'),
  },
});
