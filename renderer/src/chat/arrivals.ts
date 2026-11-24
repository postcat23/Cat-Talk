// 대화 목록에 '새로 올라온' 글 고르기(문구 트리거 이벤트, 2026-11-24). view 폴링 응답마다 부른다.
// 앱을 켜거나 로비·계정이 바뀐 뒤 첫 응답의 기록은 이미 있던 것이라 기준선(latest_seq)으로만 삼고 고르지 않는다.
// 그 뒤로는 seq가 기준선보다 큰 글(저장 못 한 글은 seq가 없어 처음 보는 id)만 새 글이다 — 위로 더 불러온 옛 글·HISTORY 이동·
// 검색 점프는 기준선 아래라 고르지 않는다. 검색 중에는 목록이 검색 결과라 고르지 않고 기준선만 올린다(검색을 풀어도 늦게 발동하지 않게).
// 입퇴장 행은 글이 아니다. 야옹은 view 메시지에 오지 않는다(반응으로만 온다).
import { isPresence, type ViewMessage, type ViewResponse } from './model';

export interface ArrivalTracker { context: string; seq: number; unsaved: string[] }

const MAX_UNSAVED = 200;   // 사이드카 volatile 상한과 같게

export function takeArrivals(prev: ArrivalTracker | null, data: Pick<ViewResponse, 'context' | 'messages' | 'latest_seq'>,
  searching: boolean): { next: ArrivalTracker; fresh: ViewMessage[] } {
  const context = `${data.context.account}\n${data.context.lobby}`;
  const unsavedIds = data.messages.filter((m) => m.unsaved).map((m) => m.id);
  const latest = data.latest_seq || 0;
  if (!prev || prev.context !== context) return { next: { context, seq: latest, unsaved: unsavedIds.slice(-MAX_UNSAVED) }, fresh: [] };
  const fresh = searching ? [] : data.messages.filter((m) => !isPresence(m)
    && (typeof m.seq === 'number' ? m.seq > prev.seq : Boolean(m.unsaved) && !prev.unsaved.includes(m.id)));
  const unsaved = [...prev.unsaved, ...unsavedIds.filter((id) => !prev.unsaved.includes(id))].slice(-MAX_UNSAVED);
  return { next: { context, seq: Math.max(prev.seq, latest), unsaved }, fresh };
}
