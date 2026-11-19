import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { WantedEvent, WantedResult } from '../chat/model';

// 화면이 가려진 동안(채팅창 접힘·드로어·참여자 목록·창 최소화/트레이) 발동은 보류했다가 보이면 띄운다. 받은 뒤 이 시간이 지나면 버린다(사용자 결정 1분)
export const HOLD_MS = 60_000;

// 창이 최소화되거나 트레이로 숨으면 document가 hidden이 된다
const subscribeVisibility = (onChange: () => void) => {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
};
const pageVisible = () => document.visibilityState === 'visible';
export const usePageVisible = () => useSyncExternalStore(subscribeVisibility, pageVisible);

// 발동 화면 하나(공개수배 전단 D-052·칭찬 도장 1.0.8 — 같은 규칙)의 재생 판정. 재생 중인 이벤트 id를 돌려준다.
// 대상이 목록에 없으면(나감·차단) 넘기고(absent), 가려진 동안은 기한까지 기다리고(그 사이 보이면 처음부터 다시), 기한이 지나면 버린다(expired).
// 재생하면 durationMs 뒤 끝(shown). 대상 객체는 폴링마다 새로 만들어지므로 타이머는 이벤트 id·대상 유무·가려짐에만 묶는다(애니메이션이 다시 시작되지 않게)
export function useHeldPlayback(event: WantedEvent | null, present: boolean, hidden: boolean,
  dismiss: (id: string, result: Extract<WantedResult, 'shown' | 'expired' | 'absent'>) => void, durationMs: number): string | null {
  const id = event?.id;
  // 받은 시각(at)은 같은 대상이 묶이면 늦춰진다. 타이머는 이 ref로 읽어, 재생 중에 늦춰져도 재생을 다시 시작하지 않는다
  const receivedAt = useRef(event?.at);
  useEffect(() => { receivedAt.current = event?.at; });
  const [playing, setPlaying] = useState<string | null>(null);   // 재생 중인 id — 보이게 된 순간 기한 안이었던 것만
  useEffect(() => {
    if (!id) return;
    const left = () => HOLD_MS - (Date.now() - (receivedAt.current ?? Date.now()));
    let timer = 0;
    if (!present) {
      timer = window.setTimeout(() => dismiss(id, 'absent'), 0);
    } else if (hidden) {
      // 가려진 동안은 기한까지 기다린다(그 사이 보이면 취소). 기다리는 사이 같은 대상이 묶여 기한이 늘었으면 다시 기다린다
      setPlaying(null);
      const wait = () => {
        if (left() > 0) timer = window.setTimeout(wait, left());
        else dismiss(id, 'expired');
      };
      timer = window.setTimeout(wait, Math.max(0, left()));
    } else if (left() <= 0) {
      timer = window.setTimeout(() => dismiss(id, 'expired'), 0);
    } else {
      setPlaying(id);
      timer = window.setTimeout(() => dismiss(id, 'shown'), durationMs);
    }
    return () => clearTimeout(timer);
  }, [id, present, hidden, dismiss, durationMs]);
  return playing;
}
