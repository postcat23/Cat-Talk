import { createContext, useCallback, useContext, useEffect, useState } from 'react';

// 앱 자동 업데이트(electron/updater.js와 짝, D-030). 설치본에서만 동작하고 dev·브라우저 dev는 'disabled'다.
// state: disabled · idle(확인 전) · checking · latest · downloading · ready(내려받음, 적용 대기) · unknown(확인 실패, 비공개 레포 포함)
export type UpdateState = 'disabled' | 'idle' | 'checking' | 'latest' | 'downloading' | 'ready' | 'unknown';
export interface UpdateStatus { state: UpdateState; version?: string }

// 쓰던 글은 앱을 끄면 사라지는 설계(D-024)라 재시작 전에 확인을 받는다(사용자 결정)
export const UPDATE_DRAFT_NOTICE = '입력 중인 글은 사라집니다';
// 준비됨 토스트(D-039). 버전은 드로어 표기('v0.0.1')처럼 'v'를 붙인다 — electron-updater 값(latest.yml의 version)에는 없다.
// 버전이 비어 오면 버전 없이 쓴다
export const updateReadyNotice = (version?: string) => (version ? `새 버전 v${version.replace(/^v/i, '')} 준비됨` : '새 버전 준비됨');

export interface AppUpdate {
  state: UpdateState;
  version?: string;                 // 내려받는 중이거나 내려받은 새 버전
  // '새 버전 … 준비됨' 토스트 표시 여부(D-039): 준비됨 + 이번 실행에서 [X]로 닫지 않음 + 확인 카드가 떠 있지 않음(취소하면 다시 보인다).
  // 'ready'는 한 실행 안에서 풀리지 않는다(updater.js). 설치하지 않고 앱을 다시 켜면 시작 확인이 내려받아 둔 파일로 다시 'ready'를 알려 한 번 더 뜬다
  readyNotice: boolean;
  confirming: boolean;              // '입력 중인 글은 사라집니다' 확인 카드 표시 중
  request(hasDraft: boolean): void; // [업데이트]: 쓰던 글이 있으면 확인부터, 없으면 바로 적용
  confirm(): void;                  // 확인 카드 [업데이트]
  cancel(): void;                   // 확인 카드 ×
  dismissReady(): void;             // 준비됨 토스트 [X]: 이번 실행 동안 숨김(드로어 '앱 업데이트'는 그대로)
}

export function useAppUpdate(): AppUpdate | null {
  const api = window.catTalk?.update;
  const [status, setStatus] = useState<UpdateStatus>({ state: 'disabled' });
  const [confirming, setConfirming] = useState(false);
  const [readyHidden, setReadyHidden] = useState(false);

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
  const dismissReady = useCallback(() => setReadyHidden(true), []);

  if (!api) return null;
  return {
    state: status.state, version: status.version, confirming,
    readyNotice: status.state === 'ready' && !readyHidden && !confirming,
    request, confirm: install, cancel, dismissReady,
  };
}

export const AppUpdateContext = createContext<AppUpdate | null>(null);
export const useUpdate = () => useContext(AppUpdateContext);
