import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useUi } from '../state/UiContext';
import type { ChestProgress, ChestResult, ChestState, Feature } from '../chat/autoChest';

const PROGRESS_LINGER_MS = 5000;   // 끝난 뒤 결과 문구를 보여 주는 시간
const RECHECK_MS = 60000;          // 설정 ON인 동안 패치 소실(업데이트)을 다시 확인하는 주기. 판정만 하고 쓰지 않는다

export interface AutoChest {
  state: ChestState | null;        // 확인 전 null. 설치돼 있으면 상자 자동 오픈 on/off
  transparent: ChestState | null;  // 같은 판정의 투명화 on/off
  progress: ChestProgress | null;  // 진행 중이거나 막 끝난 설치
  busy: boolean;
  needsReapply: boolean;           // 재적용 토스트 표시 여부
  needsReinstall: boolean;         // 앱 재설치 토스트 표시 여부(설치 도구 불일치 + 설정 ON, 이번 실행에서 닫지 않음)
  wanted: Feature[];               // 설정이 켜진 기능(재적용 대상·토스트 문구)
  enable(feature: Feature): Promise<ChestResult>;
  disable(feature: Feature): Promise<ChestResult>;
  cancel(): void;
  reapply(): Promise<void>;        // 토스트 [재시작]
  dismissReapply(): Promise<void>; // 토스트 [X]: 켜진 설정을 모두 끄기로
  dismissReinstall(): void;        // 재설치 토스트 [X]: 이번 실행 동안만 숨김(설정·플래그는 그대로 — 게임 쪽 기능은 계속 동작할 수 있다)
}

// 두 기능은 게임 패치 하나를 함께 쓴다(설치·재적용 공통, 플래그만 기능별).
// 브라우저 dev에는 catTalk가 없어 null을 돌려준다(드로어는 설정값만 바꾼다).
// onTurnedOff: 그 기능들의 설정 값을 끄기로 저장하는 쪽(UI 상태 + setting 액션).
export function useAutoChest(chestWanted: boolean, transparentWanted: boolean, onTurnedOff: (features: Feature[]) => void): AutoChest | null {
  const chest = window.catTalk?.chest;
  const { dispatch } = useUi();
  const wantedList = useMemo(() => [chestWanted && 'chest', transparentWanted && 'transparent'].filter(Boolean) as Feature[], [chestWanted, transparentWanted]);
  const wanted = wantedList.length > 0;
  const [state, setState] = useState<ChestState | null>(null);
  const [transparent, setTransparent] = useState<ChestState | null>(null);
  const [progress, setProgress] = useState<ChestProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [reinstallHidden, setReinstallHidden] = useState(false);
  const linger = useRef<number | undefined>(undefined);
  const wantedRef = useRef(wantedList);
  useEffect(() => { wantedRef.current = wantedList; }, [wantedList]);

  const refresh = useCallback(async (on: boolean) => {
    if (!chest) return;
    const s = await chest.status(on);
    setState(s.state);
    setTransparent(s.transparent ?? s.state);
  }, [chest]);

  useEffect(() => {
    if (!chest) return;
    return chest.onProgress((p) => {
      clearTimeout(linger.current);
      setProgress(p);
      // 드로어(z-index가 더 높다)에 카드가 가리지 않게 사전 점검·카운트다운이 시작되면 닫는다(점검 실패 문구도 보이게)
      if (p.phase === 'checking' || p.phase === 'countdown') dispatch({ type: 'closeOverlays' });
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

  const enable = useCallback(async (feature: Feature): Promise<ChestResult> => {
    if (!chest) return { ok: false };
    setBusy(true);
    let result: ChestResult = { ok: false };
    try { result = await chest.enable(feature); return result; }
    // 취소·실패면 설정은 그대로이므로 실제 설정값으로 판정한다
    finally { setBusy(false); await refresh(result.ok || wantedRef.current.length > 0); }
  }, [chest, refresh]);

  const disable = useCallback(async (feature: Feature): Promise<ChestResult> => {
    if (!chest) return { ok: false };
    setBusy(true);
    try { return await chest.disable(feature); }
    // 끈 기능을 뺀 나머지 설정으로 판정한다(다른 기능이 켜져 있으면 패치 소실을 계속 알린다)
    finally { setBusy(false); await refresh(wantedRef.current.some((f) => f !== feature)); }
  }, [chest, refresh]);

  const cancel = useCallback(() => chest?.cancel(), [chest]);

  const reapply = useCallback(async () => {
    if (!chest) return;
    setBusy(true);
    try { await chest.reapply(wantedList); }
    finally { setBusy(false); await refresh(true); }
  }, [chest, refresh, wantedList]);

  const dismissReapply = useCallback(async () => {
    if (!chest) return;
    setBusy(true);
    try { for (const f of wantedList) await chest.disable(f); }
    finally { setBusy(false); }
    onTurnedOff(wantedList);
    await refresh(false);
  }, [chest, refresh, wantedList, onTurnedOff]);

  const dismissReinstall = useCallback(() => setReinstallHidden(true), []);

  if (!chest) return null;
  return {
    state, transparent, progress, busy,
    needsReapply: wanted && state === 'needs_reapply' && !busy,
    needsReinstall: wanted && state === 'patcher_mismatch' && !busy && !reinstallHidden,
    wanted: wantedList, enable, disable, cancel, reapply, dismissReapply, dismissReinstall,
  };
}

export const AutoChestContext = createContext<AutoChest | null>(null);
export const useChest = () => useContext(AutoChestContext);
