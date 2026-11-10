// electron/preload.js가 contextBridge로 노출하는 bridge (원본 QWebChannel bridge.request와 같은 역할).
interface Window {
  // Electron에서만 존재. 브라우저 dev에서는 undefined라 rpc가 목업으로 폴백한다.
  bridge?: {
    request(payload: string): Promise<string>;
  };
  // 창 제어. Electron에서만 존재하고 브라우저 dev(npm run dev)에서는 undefined.
  catTalk?: {
    initial: { side: 'left' | 'right'; heightPct: 100 | 70 | 50; hideTaskbar: boolean };
    version: string;   // app.getVersion() — package.json의 version
    update: {
      status(): Promise<import('./hooks/useAppUpdate').UpdateStatus>;
      install(): Promise<{ ok: boolean; reason?: string }>;
      onStatus(cb: (status: import('./hooks/useAppUpdate').UpdateStatus) => void): () => void;
    };
    onExpand(cb: () => void): () => void;
    setDockSide(side: 'left' | 'right'): void;
    setChatHeight(pct: 100 | 70 | 50): void;
    setSkipTaskbar(hide: boolean): void;
    setInteractive(interactive: boolean): void;
    setUnread(alert: { count: number; toast: boolean; taskbar: boolean }): void;
    chest: {
      status(wanted: boolean): Promise<import('./chat/autoChest').ChestStatus>;
      enable(feature: import('./chat/autoChest').Feature): Promise<import('./chat/autoChest').ChestResult>;
      disable(feature: import('./chat/autoChest').Feature): Promise<import('./chat/autoChest').ChestResult>;
      reapply(features: import('./chat/autoChest').Feature[]): Promise<import('./chat/autoChest').ChestResult>;
      restore(): Promise<import('./chat/autoChest').ChestResult>;
      cancel(): void;
      onProgress(cb: (progress: import('./chat/autoChest').ChestProgress) => void): () => void;
      onChanged(cb: () => void): () => void;
    };
  };
}
