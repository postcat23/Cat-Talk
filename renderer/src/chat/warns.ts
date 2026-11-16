// 경고·공개수배(D-052) 입력 규칙. 집계·처형은 사이드카(sidecar/warns.py)가 로비 멤버 데이터로 한다.
import type { Participant } from './model';

// '@이름 경고!' — 이름에 공백이 있을 수 있다. 사이드카 warns.COMMAND와 같은 규칙(이 모양은 채팅으로 보내지 않는다)
export const WARN_COMMAND = /^\s*@(.+?)\s*경고!\s*$/;

export const parseWarnCommand = (text: string) => WARN_COMMAND.exec(text)?.[1] ?? null;

const norm = (s: string) => s.trim().toLocaleLowerCase();

// 자동완성으로 고른 사람(이름이 그대로면 그 id를 쓴다 — 이름이 같은 사람이 있어도 정확하다)
export interface Mention { id: string; name: string }

// 명령의 이름 → 대상 id. 고른 사람이 있으면 우선, 없으면 표시 이름(닉네임 반영) → Steam 이름 순으로 정확히 같은 사람을 찾는다.
export function resolveTarget(name: string, participants: Participant[], bound: Mention | null): string | 'none' | 'ambiguous' {
  if (bound && norm(bound.name) === norm(name) && participants.some((p) => p.id === bound.id)) return bound.id;
  for (const key of ['name', 'base'] as const) {
    const hits = participants.filter((p) => norm(p[key]) === norm(name));
    if (hits.length === 1) return hits[0].id;
    if (hits.length > 1) return 'ambiguous';
  }
  return 'none';
}

// 커서 앞에서 '@'로 시작한 이름 조각(글 맨 앞이거나 공백 뒤의 @). 줄바꿈이 끼면 끝난 것으로 본다. 없으면 null
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0 || (at > 0 && !/\s/.test(before[at - 1]))) return null;
  const query = before.slice(at + 1);
  return /[\r\n]/.test(query) || /경고!?$/.test(query.trim()) ? null : { start: at, query };
}

// 입력한 글자가 들어 있는 참여자(표시 이름 또는 Steam 이름). 앞부분이 맞는 사람을 먼저
export function filterParticipants(query: string, participants: Participant[]) {
  const q = norm(query);
  const scored = participants
    .map((p) => {
      const names = [norm(p.name), norm(p.base)];
      const rank = names.some((n) => n.startsWith(q)) ? 0 : names.some((n) => n.includes(q)) ? 1 : -1;
      return { p, rank };
    })
    .filter((s) => s.rank >= 0);
  scored.sort((a, b) => a.rank - b.rank || a.p.name.localeCompare(b.p.name));
  return scored.map((s) => s.p);
}
