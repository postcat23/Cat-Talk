import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useUi } from '../state/UiContext';
import type { ChestProgress, ChestResult, ChestState } from '../chat/autoChest';

const PROGRESS_LINGER_MS = 5000;   // 끝난 뒤 결과 문구를 보여 주는 시간
const RECHECK_MS = 60000;          // 설정 ON인 동안 패치 소실(업데이트)을 다시 확인하는 주기. 판정만 하고 쓰지 않는다

export interface AutoChest {
  state: ChestState | null;        // 확인 전 null
  progress: ChestProgress | null;  // 진행 중이거나 막 끝난 설치
  busy: boolean;
  needsReapply: boolean;           // 재적용 토스트 표시 여부
  enable(): Promise<ChestResult>;
  disable(): Promise<ChestResult>;
  cancel(): void;
  reapply(): Promise<void>;        // 토스트 [재시작]
  dismissReapply(): Promise<void>; // 토스트 [X]: 설정을 끄기로
}

// 브라우저 dev에는 catTalk가 없어 null을 돌려준다(드로어는 설정값만 바꾼다).
// onTurnedOff: 설정 값을 끄기로 저장하는 쪽(UI 상태 + setting 액션).
export function useAutoChest(wanted: boolean, onTurnedOff: () => void): AutoChest | null {
  const chest = window.catTalk?.chest;
  const { dispatch } = useUi();
  const [state, setState] = useState<ChestState | null>(null);
  const [progress, setProgress] = useState<ChestProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const linger = useRef<number | undefined>(undefined);
  const wantedRef = useRef(wanted);
  useEffect(() => { wantedRef.current = wanted; }, [wanted]);

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

  useEffect(() => {
    if (!chest) return;
    void refresh(wanted);
    if (!wanted) return;
    const timer = window.setInterval(() => void refresh(true), RECHECK_MS);
    return () => clearInterval(timer);
  }, [chest, wanted, refresh]);

  const enable = useCallback(async (): Promise<ChestResult> => {
    if (!chest) return { ok: false };
    setBusy(true);
    let result: ChestResult = { ok: false };
    try { result = await chest.enable(); return result; }
    // 취소·실패면 설정은 그대로이므로 실제 설정값으로 판정한다
    finally { setBusy(false); await refresh(result.ok || wantedRef.current); }
  }, [chest, refresh]);

  const disable = useCallback(async (): Promise<ChestResult> => {
    if (!chest) return { ok: false };
    setBusy(true);
    try { return await chest.disable(); }
    finally { setBusy(false); await refresh(false); }
  }, [chest, refresh]);

  const cancel = useCallback(() => chest?.cancel(), [chest]);

  const reapply = useCallback(async () => {
    if (!chest) return;
    setBusy(true);
    try { await chest.reapply(); }
    finally { setBusy(false); await refresh(true); }
  }, [chest, refresh]);

  const dismissReapply = useCallback(async () => {
    await disable();
    onTurnedOff();
  }, [disable, onTurnedOff]);

  if (!chest) return null;
  return { state, progress, busy, needsReapply: wanted && state === 'needs_reapply' && !busy, enable, disable, cancel, reapply, dismissReapply };
}

export const AutoChestContext = createContext<AutoChest | null>(null);
export const useChest = () => useContext(AutoChestContext);
