// 드로어 '플레이' 카드(사용자 명세, 2026-11-17): 재미 기능마다 [켜기][끄기] 한 줄. 기능이 늘면 PLAY_FEATURES에 행을 더한다.
// 모두 내 화면·내 입력에만 적용된다 — 남의 화면은 바꾸지 않는다(고양이 투명화·상호작용 표시와 같은 성격).
import type { Settings } from '../state/UiContext';

export type PlayKey = 'playWarn' | 'playPraise' | 'playEvent';

// mention = '@' 단축어를 쓰는 기능. 그런 기능이 하나라도 켜져 있으면 '@' 자동완성이 뜨고,
// 모두 꺼져 있으면 '@'는 일반 글자로 입력된다(사용자 결정)
// hint = 이름 아래 회색 사용법(게임 카드의 '실행 중'처럼, 사용자 명세 2026-11-18)
export const PLAY_FEATURES: { key: PlayKey; label: string; mention: boolean; hint: string }[] = [
  { key: 'playWarn', label: '경고', mention: true, hint: '@사용자이름 경고!' },     // 경고·공개수배 전체(D-052)
  { key: 'playPraise', label: '칭찬', mention: true, hint: '@사용자이름 칭찬!' },   // 칭찬·칭찬 도장 전체(1.0.8, 경고의 거울)
  // 문구 트리거 이벤트 효과(1.0.10, chat/events.ts). 문구는 공개하지 않는다(사용자 명세 설명 문구)
  { key: 'playEvent', label: '이벤트 모션', mention: false, hint: '숨겨진 문구 찾기' },
];

export const mentionEnabled = (settings: Settings) => PLAY_FEATURES.some((f) => f.mention && settings[f.key]);

// 이름 뒤 누적 표시(사용자 명세 1.0.8): 쌓지 않고 아이콘 + 숫자. 0이면 그리지 않고, 경고 먼저·칭찬 뒤(🟨1 ⭐2).
// 토글은 서로 독립 — 칭찬을 끄면 별만, 경고를 끄면 카드만 숨긴다(내 화면만)
export interface PlayMark { kind: 'warn' | 'praise'; count: number }

export function playMarks(warns: number, praises: number, show: Pick<Settings, 'playWarn' | 'playPraise'>): PlayMark[] {
  const marks: PlayMark[] = [];
  if (show.playWarn && warns > 0) marks.push({ kind: 'warn', count: warns });
  if (show.playPraise && praises > 0) marks.push({ kind: 'praise', count: praises });
  return marks;
}

export const playMarkLabel = (marks: PlayMark[]) => marks.map((m) => `${m.kind === 'warn' ? '경고' : '칭찬'} ${m.count}회`).join(', ');
