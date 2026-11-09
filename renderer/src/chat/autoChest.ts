// 상자 자동 오픈·모든 고양이 투명화 상태·진행 문구(electron/auto-chest.js와 짝, D-019·D-028).
// 두 기능은 게임 패치 하나를 함께 쓴다. 설치 상태는 공통, 켜짐/꺼짐만 기능별이다.
export type Feature = 'chest' | 'transparent';
// patcher_mismatch: 설치 도구(패처)가 없거나 앱과 버전이 다름 — 재적용으로는 못 고친다(D-029)
export type ChestState = 'not_installed' | 'on' | 'off' | 'incompatible' | 'needs_reapply' | 'installing' | 'no_game' | 'error' | 'patcher_mismatch';
// state: 설치 상태(설치돼 있으면 상자 자동 오픈 on/off), transparent: 같은 판정의 투명화 on/off
export interface ChestStatus { state: ChestState; transparent?: ChestState; reason?: string }
export interface ChestResult { ok: boolean; reason?: string; rolledBack?: boolean }
export interface ChestProgress {
  phase: 'checking' | 'countdown' | 'cancelled' | 'stopping_worker' | 'closing_game' | 'patching' | 'launching' | 'verifying' | 'done' | 'failed';
  seconds?: number;
  reason?: string;
  rolledBack?: boolean;
  features?: Feature[];   // 이 설치로 켜는 기능
}

export const FEATURE_NAME: Record<Feature, string> = { chest: '상자 자동 오픈', transparent: '모든 고양이 투명화' };

// '상자 자동 오픈·모든 고양이 투명화' 처럼 잇고, 목적격 조사는 마지막 이름의 받침으로 고른다
function names(features: Feature[] = ['chest']) { return features.map((f) => FEATURE_NAME[f]).join('·'); }
function object(features?: Feature[]) {
  const text = names(features);
  const code = text.charCodeAt(text.length - 1) - 0xac00;
  return `${text}${code >= 0 && code < 11172 && code % 28 === 0 ? '를' : '을'}`;
}

export const reapplyNotice = (features: Feature[]) => `${names(features)} 재적용이 필요합니다`;
// 설치 도구가 없거나 앱과 맞지 않을 때(patcher_mismatch) 설정이 켜져 있으면 띄운다. 재적용으로는 못 고친다.
// [재설치] 버튼은 재설치 수단(설치 파일·업데이터)이 생기는 배포 셋업에서 붙인다(D-029).
export const REINSTALL_NOTICE = '앱 재설치가 필요합니다';

export const STATE_LABEL: Record<ChestState, string> = {
  not_installed: '미설치',
  on: '켜짐',
  off: '꺼짐',
  incompatible: '호환 안 됨',
  needs_reapply: '재적용 필요',
  installing: '설치 중',
  no_game: '게임을 찾지 못함',
  error: '상태 확인 실패',
  patcher_mismatch: '앱 재설치 필요',
};

const FAILURE: Record<string, string> = {
  game_close_failed: '게임이 종료되지 않아 설치를 중단했습니다. 게임을 직접 닫고 다시 시도해 주세요.',
  steam_still_running: 'Steam에 게임이 아직 실행 중으로 표시되어 설치를 멈췄습니다. 잠시 뒤 다시 시도해 주세요.',
  incompatible: '현재 게임 버전과 호환되지 않아 설치하지 않았습니다.',
  game_start_failed: '게임이 시작되지 않았습니다.',
  game_crashed: '설치 후 게임이 종료되었습니다.',
  preflight_failed: '설치 전 점검을 통과하지 못해 게임을 종료하지 않고 중단했습니다.',
};

export function progressText(p: ChestProgress) {
  switch (p.phase) {
    case 'checking': return '설치 가능 여부를 확인 중입니다.';
    case 'countdown': return `${p.seconds}초 뒤 게임을 종료하고 ${object(p.features)} 적용합니다.`;
    case 'stopping_worker': return '채팅 연결을 잠시 끊는 중입니다.';
    case 'closing_game': return '게임을 종료하는 중입니다.';
    case 'patching': return `${object(p.features)} 설치하는 중입니다.`;
    case 'launching': return '게임을 다시 실행하는 중입니다.';
    case 'verifying': return '게임이 정상적으로 켜졌는지 확인하는 중입니다.';
    case 'done': return `${object(p.features)} 켰습니다.`;
    case 'cancelled': return '설치를 취소했습니다.';
    case 'failed': {
      const text = FAILURE[p.reason ?? ''] ?? '설치하지 못했습니다.';
      return p.rolledBack ? `${text} 게임 파일을 원본으로 되돌렸습니다.` : text;
    }
  }
}
