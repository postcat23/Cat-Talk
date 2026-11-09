import { createContext, useCallback, useContext, useEffect, useState } from 'react';

// 앱 자동 업데이트(electron/updater.js와 짝, D-030). 설치본에서만 동작하고 dev·브라우저 dev는 'disabled'다.
// state: disabled · idle(확인 전) · checking · latest · downloading · ready(내려받음, 적용 대기) · unknown(확인 실패, 비공개 레포 포함)
export type UpdateState = 'disabled' | 'idle' | 'checking' | 'latest' | 'downloading' | 'ready' | 'unknown';
export interface UpdateStatus { state: UpdateState; version?: string }

// 쓰던 글은 앱을 끄면 사라지는 설계(D-024)라 재시작 전에 확인을 받는다(사용자 결정)
export const UPDATE_DRAFT_NOTICE = '입력 중인 글은 사라집니다';

export interface AppUpdate {
  state: UpdateState;
  confirming: boolean;              // '입력 중인 글은 사라집니다' 확인 카드 표시 중
  request(hasDraft: boolean): void; // [업데이트]: 쓰던 글이 있으면 확인부터, 없으면 바로 적용
  confirm(): void;                  // 확인 카드 [업데이트]
  cancel(): void;                   // 확인 카드 ×
}

export function useAppUpdate(): AppUpdate | null {
  const api = window.catTalk?.update;
  const [status, setStatus] = useState<UpdateStatus>({ state: 'disabled' });
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!api) return;
    let alive = true;
    void api.status().then((s) => { if (alive) setStatus(s); });
    const off = api.onStatus(setStatus);
    return () => { alive = false; off(); };
  }, [api]);

  // 적용은 main이 사이드카를 정상 종료한 뒤 앱을 재시작한다. 준비되지 않았으면 main이 거절한다
  const install = useCallback(() => { setConfirming(false); void api?.install(); }, [api]);
  const request = useCallback((hasDraft: boolean) => { if (hasDraft) setConfirming(true); else install(); }, [install]);
  const cancel = useCallback(() => setConfirming(false), []);

  if (!api) return null;
  return { state: status.state, confirming, request, confirm: install, cancel };
}

export const AppUpdateContext = createContext<AppUpdate | null>(null);
export const useUpdate = () => useContext(AppUpdateContext);
