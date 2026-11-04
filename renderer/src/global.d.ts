// electron/preload.js가 contextBridge로 노출하는 bridge (원본 QWebChannel bridge.request와 같은 역할).
interface Window {
  bridge: {
    request(payload: string): Promise<string>;
  };
}
