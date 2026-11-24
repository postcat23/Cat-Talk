// 문구 트리거 이벤트(사용자 명세 2026-11-24): 기념일마다 {트리거 문구, 활성 기간, 효과}. 로비 누구의 채팅이든(본인 포함) 대화 목록에
// 새로 올라온 글에 문구가 들어 있으면(부분 일치·대소문자 무시) 보는 사람 화면에만 효과를 띄운다(로컬 발동 — 남의 화면에 보내지 않는다).
// 활성 기간 밖이면 발동하지 않는다. 새 기념일은 EVENTS에 행을 더하고 효과 그림을 components/EventMotion에 연결한다.
// 드로어 '플레이 > 이벤트 모션'(playEvent, 기본 켜기)을 끄면 문구가 와도 띄우지 않는다.
import { COALESCE_MS } from './playQueue';

export type EventEffect = 'christmas';

// 활성 기간 = PC 현지 날짜의 월·일, 매년 반복(사용자 결정), 양 끝 날짜 포함(시작일 0시 ~ 끝날 하루 끝).
// 끝이 시작보다 앞이면(예: 12/30 ~ 1/2) 해를 넘기는 기간으로 본다
export interface MonthDay { month: number; day: number }
export interface EventDef { id: string; effect: EventEffect; start: MonthDay; end: MonthDay; phrases: string[] }

export const EVENTS: EventDef[] = [
  {
    id: 'christmas', effect: 'christmas', start: { month: 11, day: 24 }, end: { month: 12, day: 25 },
    phrases: ['메리 크리스마스', 'merry christmas', 'christmas', '크리스마스', '트리', '선물', '산타', '산타클로스', '루돌프', '겨우살이',
      '화이트 크리스마스', 'Xmas'],
  },
];

// 발동 뒤 이 시간 동안은 문구가 또 와도 무시한다(재생 중 포함, 도배 방지). 경고·칭찬 취합과 같은 10초(사용자 명세)
export const EVENT_COOLDOWN_MS = COALESCE_MS;
// 효과 길이: 3.4초 재생 + 마지막 0.6초 페이드아웃(사용자 결정 2026-11-24). EventMotion.module.css 애니메이션 길이와 같게
export const EVENT_DURATION_MS = 4000;

const monthDay = (d: Date) => (d.getMonth() + 1) * 100 + d.getDate();
const key = (md: MonthDay) => md.month * 100 + md.day;

export function inWindow(def: Pick<EventDef, 'start' | 'end'>, date: Date): boolean {
  const now = monthDay(date), start = key(def.start), end = key(def.end);
  return start <= end ? start <= now && now <= end : now >= start || now <= end;
}

// 글 하나에 맞는 이벤트(기간 안이고 문구가 들어 있는 첫 행). 없으면 null
export function matchEvent(text: string, date: Date, events: EventDef[] = EVENTS): EventDef | null {
  const body = text.toLowerCase();
  if (!body) return null;
  return events.find((def) => inWindow(def, date) && def.phrases.some((p) => body.includes(p.toLowerCase()))) ?? null;
}

// 발동 하나(재생 대기·재생 중). at = 받은 시각(Date.now) — 화면이 가려진 동안 보류 기한(1분, useHeldPlayback) 판정용
export interface EventPlay { id: string; effect: EventEffect; at: number }

// 새 발동을 받을지: 켜져 있고, 이미 대기·재생 중인 것이 없고, 마지막 재생 시작 뒤 쿨다운이 지났을 때만
export function admitEvent(enabled: boolean, current: EventPlay | null, startedAt: number | null, now: number): boolean {
  if (!enabled || current) return false;
  return startedAt === null || now - startedAt >= EVENT_COOLDOWN_MS;
}
