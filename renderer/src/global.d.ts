// electron/preload.js가 contextBridge로 노출하는 bridge (원본 QWebChannel bridge.request와 같은 역할).
interface Window {
  // Electron에서만 존재. 브라우저 dev에서는 undefined라 rpc가 목업으로 폴백한다.
  bridge?: {
    request(payload: string): Promise<string>;
  };
  // 창 제어. Electron에서만 존재하고 브라우저 dev(npm run dev)에서는 undefined.
  catTalk?: {
    initial: { side: 'left' | 'right'; heightPct: 100 | 70 | 50; hideTaskbar: boolean };
    onExpand(cb: () => void): () => void;
    setDockSide(side: 'left' | 'right'): void;
    setChatHeight(pct: 100 | 70 | 50): void;
    setSkipTaskbar(hide: boolean): void;
    setInteractive(interactive: boolean): void;
  };
}
