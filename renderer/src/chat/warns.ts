// 경고·공개수배(D-052)와 칭찬(1.0.8, 경고의 거울) 입력 규칙. 집계·발동은 사이드카(sidecar/warns.py·play_tally.py)가 로비 멤버 데이터로 한다.
import type { Participant } from './model';

// '@이름 경고!' — 이름에 공백이 있을 수 있다. 사이드카 warns.COMMAND와 같은 규칙(이 모양은 채팅으로 보내지 않는다)
export const WARN_COMMAND = /^\s*@(.+?)\s*경고!\s*$/;
// '@이름 칭찬!' — 사이드카 warns.PRAISE_COMMAND와 같은 규칙
export const PRAISE_COMMAND = /^\s*@(.+?)\s*칭찬!\s*$/;

export type PlayCommand = 'warn' | 'praise';

export const parseWarnCommand = (text: string) => WARN_COMMAND.exec(text)?.[1] ?? null;
export const parsePraiseCommand = (text: string) => PRAISE_COMMAND.exec(text)?.[1] ?? null;

// 입력이 경고·칭찬 명령이면 종류와 이름. 아니면 null
export function parsePlayCommand(text: string): { kind: PlayCommand; name: string } | null {
  const warn = parseWarnCommand(text);
  if (warn !== null) return { kind: 'warn', name: warn };
  const praise = parsePraiseCommand(text);
  return praise !== null ? { kind: 'praise', name: praise } : null;
}

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

// 명령 실행 시점의 대상 판정. 칭찬은 자기 자신을 대상으로 할 수 없다(사용자 명세 2026-11-19 — Steam ID로 비교해 닉네임이 겹쳐도
// 정확하다). '@' 자동완성은 경고와 함께 쓰여 명령 종류를 모르므로 목록은 그대로 두고 여기서 막는다. 경고는 자기 자신도 된다(D-052)
export function resolvePlayTarget(kind: PlayCommand, name: string, participants: Participant[], bound: Mention | null,
  meId?: string): string | 'none' | 'ambiguous' | 'self' {
  const target = resolveTarget(name, participants, bound);
  return kind === 'praise' && !!meId && target === meId ? 'self' : target;
}

// 커서 앞에서 '@'로 시작한 이름 조각(글 맨 앞이거나 공백 뒤의 @). 줄바꿈이 끼면 끝난 것으로 본다. 없으면 null
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0 || (at > 0 && !/\s/.test(before[at - 1]))) return null;
  const query = before.slice(at + 1);
  return /[\r\n]/.test(query) || /(경고|칭찬)!?$/.test(query.trim()) ? null : { start: at, query };
}

// 입력한 글자가 들어 있는 참여자(표시 이름 또는 Steam 이름). 앞부분이 맞는 사람을 먼저.
// 본인도 목록에 둔다(사용자 결정 1.0.8 — 경고는 본인도 대상이고, 목록이 뜨는 시점엔 경고·칭찬을 가를 수 없다).
// 본인 칭찬은 명령을 실행할 때 resolvePlayTarget이 막는다
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
