import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useUi } from '../state/UiContext';
import type { ChestProgress, ChestResult, ChestState } from '../chat/autoChest';

const PROGRESS_LINGER_MS = 5000;   // 끝난 뒤 결과 문구를 보여 주는 시간

export interface AutoChest {
  state: ChestState | null;        // 확인 전 null
  progress: ChestProgress | null;  // 진행 중이거나 막 끝난 설치
  busy: boolean;
  enable(): Promise<ChestResult>;
  disable(): Promise<ChestResult>;
  cancel(): void;
}

// 브라우저 dev에는 catTalk가 없어 null을 돌려준다(드로어는 설정값만 바꾼다).
export function useAutoChest(wanted: boolean): AutoChest | null {
  const chest = window.catTalk?.chest;
  const { dispatch } = useUi();
  const [state, setState] = useState<ChestState | null>(null);
  const [progress, setProgress] = useState<ChestProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const linger = useRef<number | undefined>(undefined);
  const reapplied = useRef(false);

  const refresh = useCallback(async (on: boolean) => {
    if (chest) setState((await chest.status(on)).state);
  }, [chest]);

  useEffect(() => {
    if (!chest) return;
    return chest.onProgress((p) => {
      clearTimeout(linger.current);
      setProgress(p);
      // 드로어(z-index가 더 높다)에 카드가 가리지 않게 카운트다운이 시작되면 닫는다
      if (p.phase === 'countdown') dispatch({ type: 'closeOverlays' });
      if (p.phase === 'done' || p.phase === 'failed' || p.phase === 'cancelled') {
        linger.current = window.setTimeout(() => setProgress(null), PROGRESS_LINGER_MS);
      }
    });
  }, [chest, dispatch]);

  // 설정이 ON인데 패치가 사라졌으면(업데이트) 켜기와 같은 카운트다운으로 재적용한다. 취소하면 이 실행에서는 다시 묻지 않는다.
  useEffect(() => {
    if (!chest) return;
    void (async () => {
      const { state: current } = await chest.status(wanted);
      setState(current);
      if (wanted && current === 'needs_reapply' && !reapplied.current) {
        reapplied.current = true;
        setBusy(true);
        try { await chest.reapply(); }
        finally { setBusy(false); await refresh(wanted); }
      }
    })();
  }, [chest, wanted, refresh]);

  const enable = useCallback(async (): Promise<ChestResult> => {
    if (!chest) return { ok: false };
    setBusy(true);
    try { return await chest.enable(); }
    finally { setBusy(false); await refresh(true); }
  }, [chest, refresh]);

  const disable = useCallback(async (): Promise<ChestResult> => {
    if (!chest) return { ok: false };
    setBusy(true);
    try { return await chest.disable(); }
    finally { setBusy(false); await refresh(false); }
  }, [chest, refresh]);

  const cancel = useCallback(() => chest?.cancel(), [chest]);

  return chest ? { state, progress, busy, enable, disable, cancel } : null;
}

export const AutoChestContext = createContext<AutoChest | null>(null);
export const useChest = () => useContext(AutoChestContext);
