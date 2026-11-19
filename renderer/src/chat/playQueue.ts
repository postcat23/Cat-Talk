// 발동 화면(공개수배 전단 D-052·칭찬 도장 1.0.8)의 대기열 규칙. 순수 함수 — useChatView가 두 종류에 같이 쓰고, 시험이 직접 부른다.
// 같은 대상 취합(사용자 명세): 그 대상 화면이 재생 중·대기 중이거나 끝난 뒤 COALESCE_MS 안이면 새 발동은 띄우지 않는다(대상마다 따로).
// 대기열에 있던 것은 보류 기한(1분)을 이번에 받은 시각부터 다시 센다 — 가려진 동안 같은 대상이 거듭 발동되면 보일 때 최근 것 하나만 뜬다.
// 발동(누적·합계 3·리셋)은 사이드카 그대로이고 화면 표시만 묶는다.
import type { WantedEvent, WantedResult } from './model';

export const COALESCE_MS = 10_000;

// 새로 받은 발동을 대기열 뒤에 넣는다. reports = 띄우지 않은 것의 진단 결과 코드(off·coalesce)
export function admitEvents(queue: WantedEvent[], fresh: WantedEvent[], enabled: boolean, ended: Map<string, number>, at: number) {
  const reports: WantedResult[] = [];
  let next = queue;
  for (const w of fresh) {
    if (next.some((q) => q.id === w.id)) continue;
    if (!enabled) { reports.push('off'); continue; }
    const same = next.find((q) => q.target === w.target);
    const end = ended.get(w.target);
    if (same || (end !== undefined && at - end < COALESCE_MS)) {
      reports.push('coalesce');
      if (same) next = next.map((q) => (q === same ? { ...q, at } : q));
      continue;
    }
    next = [...next, { ...w, at }];
  }
  return { queue: next, reports };
}

// 재생이 끝났거나 버린 발동을 뺀다. 끝까지 재생한 대상은 끝난 시각을 적어 둔다(그 뒤 COALESCE_MS 안의 같은 대상은 취합).
// 오래된 기록은 그때 지운다. 대기열에 없는 id면 null(이미 처리됨)
export function finishEvent(queue: WantedEvent[], id: string, result: Extract<WantedResult, 'shown' | 'expired' | 'absent'>,
  ended: Map<string, number>, now: number): WantedEvent[] | null {
  const done = queue.find((w) => w.id === id);
  if (!done) return null;
  if (result === 'shown') {
    for (const [target, t] of ended) if (now - t >= COALESCE_MS) ended.delete(target);
    ended.set(done.target, now);
  }
  return queue.filter((w) => w.id !== id);
}
