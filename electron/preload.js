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
  // 트레이 '열기/펼치기'·두 번째 실행 시 접힌 패널을 펼친다. 해제 함수를 돌려준다.
  onExpand: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('window:expand', listener);
    return () => ipcRenderer.removeListener('window:expand', listener);
  },
  setDockSide: (side) => ipcRenderer.send('window:set-dock-side', side),
  setChatHeight: (pct) => ipcRenderer.send('window:set-chat-height', pct),
  setSkipTaskbar: (hide) => ipcRenderer.send('window:set-skip-taskbar', hide),
  setInteractive: (interactive) => ipcRenderer.send('window:set-interactive', interactive),
  // 안 읽은 수({count, toast, taskbar}). 수와 토글은 렌더러가 정하고, 표시는 main이 맡는다.
  setUnread: (alert) => ipcRenderer.send('alert:unread', alert),
  // 상자 자동 오픈(D-019). status는 판정만(쓰기 없음), wanted = 설정 ON 여부.
  chest: {
    status: (wanted) => ipcRenderer.invoke('chest:status', wanted),
    enable: () => ipcRenderer.invoke('chest:enable'),
    disable: () => ipcRenderer.invoke('chest:disable'),
    reapply: () => ipcRenderer.invoke('chest:reapply'),
    cancel: () => ipcRenderer.send('chest:cancel'),
    onProgress: (cb) => {
      const listener = (_e, progress) => cb(progress);
      ipcRenderer.on('chest:progress', listener);
      return () => ipcRenderer.removeListener('chest:progress', listener);
    },
  },
});
