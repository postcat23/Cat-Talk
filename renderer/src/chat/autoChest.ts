// 상자 자동 오픈 상태·진행 문구(electron/auto-chest.js와 짝, D-019).
export type ChestState = 'not_installed' | 'on' | 'off' | 'incompatible' | 'needs_reapply' | 'installing' | 'no_game' | 'error';
export interface ChestStatus { state: ChestState; reason?: string }
export interface ChestResult { ok: boolean; reason?: string; rolledBack?: boolean }
export interface ChestProgress {
  phase: 'countdown' | 'cancelled' | 'stopping_worker' | 'closing_game' | 'patching' | 'launching' | 'verifying' | 'done' | 'failed';
  seconds?: number;
  reason?: string;
  rolledBack?: boolean;
}

export const STATE_LABEL: Record<ChestState, string> = {
  not_installed: '미설치',
  on: '켜짐',
  off: '꺼짐',
  incompatible: '호환 안 됨',
  needs_reapply: '재적용 필요',
  installing: '설치 중',
  no_game: '게임을 찾지 못함',
  error: '상태 확인 실패',
};

const FAILURE: Record<string, string> = {
  game_close_failed: '게임이 종료되지 않아 설치를 중단했습니다. 게임을 직접 닫고 다시 시도해 주세요.',
  steam_still_running: 'Steam에 게임이 아직 실행 중으로 표시되어 설치를 멈췄습니다. 잠시 뒤 다시 시도해 주세요.',
  incompatible: '현재 게임 버전과 호환되지 않아 설치하지 않았습니다.',
  game_start_failed: '게임이 시작되지 않았습니다.',
  game_crashed: '설치 후 게임이 종료되었습니다.',
};

export function progressText(p: ChestProgress) {
  switch (p.phase) {
    case 'countdown': return `${p.seconds}초 뒤 게임을 종료하고 상자 자동 오픈을 적용합니다.`;
    case 'stopping_worker': return '채팅 연결을 잠시 끊는 중입니다.';
    case 'closing_game': return '게임을 종료하는 중입니다.';
    case 'patching': return '상자 자동 오픈을 설치하는 중입니다.';
    case 'launching': return '게임을 다시 실행하는 중입니다.';
    case 'verifying': return '게임이 정상적으로 켜졌는지 확인하는 중입니다.';
    case 'done': return '상자 자동 오픈을 켰습니다.';
    case 'cancelled': return '설치를 취소했습니다.';
    case 'failed': {
      const text = FAILURE[p.reason ?? ''] ?? '설치하지 못했습니다.';
      return p.rolledBack ? `${text} 게임 파일을 원본으로 되돌렸습니다.` : text;
    }
  }
}
