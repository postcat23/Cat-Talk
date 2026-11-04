// 에러 코드·연결 안내 문구. 원본 ui/app.js의 showError·notices 한국어를 따른다.
import type { ViewResponse } from './model';

const REQUEST_FAILED = '요청을 완료하지 못했어요. 연결·저장 상태를 확인해 주세요.';

// 통과 9종(ipc-contract §8) + storage_failed + 전송 계층 not_wired·bridge_down. 그 외는 전부 request_failed로 접는다.
const ERROR_TEXT: Record<string, string> = {
  connection_changed: '연결 대상이 변경되어 전송하지 않았어요.',
  development_limit_50: '개발판에서는 50 UTF-16 단위 이내로 보내 주세요.',
  control_character: '보낼 수 없는 문자가 포함되어 있어요.',
  storage_failed_before_send: '기록을 저장하지 못해 전송하지 않았어요.',
  storage_failed: '저장에 실패했어요. 작성한 내용은 이 창에서 확인해 주세요.',
  legal_unavailable: '안내 파일을 열지 못했어요. 앱 파일을 복구하거나 다시 설치해 주세요.',
  invalid_steam_id: '프로필 대상을 확인하지 못했어요. 참여자 목록을 다시 확인해 주세요.',
  steam_profile_unavailable: '현재 연결에서 열 수 없는 프로필이에요. 참여자와 연결 상태를 확인해 주세요.',
  steam_profile_failed: 'Steam 프로필을 열지 못했어요. Steam 실행 상태를 확인해 주세요.',
  block_unavailable: '차단 설정을 저장하지 못했어요. 이전 설정을 유지합니다.',
  not_wired: '아직 연결되지 않은 기능이에요.',
  bridge_down: '채팅 연동 프로세스에 연결하지 못했어요.',
  request_failed: REQUEST_FAILED,
};

export function errorText(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  return ERROR_TEXT[code] ?? REQUEST_FAILED;
}

const NOTICES: Record<string, string> = {
  checking: 'Steam과 게임의 채팅 연동 구조를 확인하고 있어요.',
  searching_lobby: 'Bongo Cat의 현재 로비를 확인하고 있어요. 연결이 확인되면 대화를 불러옵니다.',
  discovering: '로비를 찾았어요. 현재 연결을 확인하고 있어요.',
  discovery_failed: 'Steam 연결은 유지 중이에요. 현재 로비 검증을 다시 시도하고 있어요. 전송은 확인 후 사용할 수 있어요.',
  read_only: '읽기 전용으로 실행 중입니다. 메시지를 전송하지 않습니다.',
  no_lobby: '현재 게임 로비를 확인할 수 없어요. 게임에서 로비에 참여해 주세요.',
  game_files_changed: '게임 업데이트를 감지했어요. 연동 구조를 다시 확인하고 있습니다.',
  compatibility_tool_missing: '호환성 검사 파일이 없어 연결할 수 없어요. 앱을 다시 설치해 주세요.',
  compatibility_timeout: '호환성 검사에 시간이 걸리고 있어요. 연결을 보류하고 다시 확인합니다.',
  game_missing_or_ambiguous: '실행 중인 Bongo Cat 하나를 확인해야 연결할 수 있어요.',
  worker_stopped: '연결 작업자가 종료됐어요. 전송 결과가 불명확한 메시지는 다시 보내지 않습니다.',
  offline: '오프라인으로 실행 중입니다. 실제 게임과 연결하지 않습니다.',
};
export const VIEW_UNAVAILABLE = '대화 상태를 조회하지 못해 표시와 전송을 중단했어요. 다시 확인하고 있습니다.';
const STORAGE_ERROR = '저장 실패 · 일부 기록 미보관';
const UNKNOWN_NOTICE = '게임 상태를 확인하지 못했어요. 연동을 중단하고 다시 확인하고 있습니다.';

export function noticeText(view: ViewResponse | null) {
  if (!view) return '';
  if (view.notice === 'unsupported_game_build') {
    const build = /^[0-9]{1,12}$/.test(view.game_build) ? `게임 빌드 ${view.game_build}` : '현재 게임 파일';
    return `${build}의 호환성을 확인하지 못해 연동을 중단했어요. 아직 대응 버전이 없습니다.`;
  }
  if (view.notice) return NOTICES[view.notice] ?? UNKNOWN_NOTICE;
  return view.storage_error ? STORAGE_ERROR : '';
}
