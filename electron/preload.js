const { contextBridge, ipcRenderer } = require('electron');
// 렌더러는 window.bridge.request(payloadString) -> Promise<responseString>
// (원본 QWebChannel bridge.request와 역할 동일. 2단계 React 포팅에서 rpc() 래퍼가 감싼다.)
contextBridge.exposeInMainWorld('bridge', {
  request: (payloadString) => ipcRenderer.invoke('bridge-request', payloadString),
});

// 창 제어(끝 도크·높이·작업표시줄·클릭 통과). 브라우저 dev에는 없으므로 렌더러는 존재 여부로 분기한다.
contextBridge.exposeInMainWorld('catTalk', {
  setDockSide: (side) => ipcRenderer.send('window:set-dock-side', side),
  setChatHeight: (pct) => ipcRenderer.send('window:set-chat-height', pct),
  setSkipTaskbar: (hide) => ipcRenderer.send('window:set-skip-taskbar', hide),
  setInteractive: (interactive) => ipcRenderer.send('window:set-interactive', interactive),
});
