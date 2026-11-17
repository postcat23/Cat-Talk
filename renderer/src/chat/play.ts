// 드로어 '플레이' 카드(사용자 명세, 2026-11-17): 재미 기능마다 [켜기][끄기] 한 줄. 기능이 늘면 PLAY_FEATURES에 행을 더한다.
// 모두 내 화면·내 입력에만 적용된다 — 남의 화면은 바꾸지 않는다(고양이 투명화·상호작용 표시와 같은 성격).
import type { Settings } from '../state/UiContext';

export type PlayKey = 'playWarn';

// mention = '@' 단축어를 쓰는 기능. 그런 기능이 하나라도 켜져 있으면 '@' 자동완성이 뜨고,
// 모두 꺼져 있으면 '@'는 일반 글자로 입력된다(사용자 결정)
export const PLAY_FEATURES: { key: PlayKey; label: string; mention: boolean }[] = [
  { key: 'playWarn', label: '경고', mention: true },   // 경고·공개수배 전체(D-052)
];

export const mentionEnabled = (settings: Settings) => PLAY_FEATURES.some((f) => f.mention && settings[f.key]);
