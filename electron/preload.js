const { contextBridge, ipcRenderer } = require('electron');
// 렌더러는 window.bridge.request(payloadString) -> Promise<responseString>
// (원본 QWebChannel bridge.request와 역할 동일. 2단계 React 포팅에서 rpc() 래퍼가 감싼다.)
contextBridge.exposeInMainWorld('bridge', {
  request: (payloadString) => ipcRenderer.invoke('bridge-request', payloadString),
});
