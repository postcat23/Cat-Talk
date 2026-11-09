// 에러 코드·연결 안내 문구. 코드 체계는 원본 ui/app.js를 따르고, 문구는 Cat Talk 기준(문장은 합니다체, D-020)이다.
import type { ViewResponse } from './model';

const REQUEST_FAILED = '요청을 완료하지 못했습니다. 연결·저장 상태를 확인해 주세요.';

// 통과 9종(ipc-contract §8) + storage_failed + main이 만드는 steam_trade_failed + 전송 계층 not_wired·bridge_down.
// 그 외는 전부 request_failed로 접는다. invalid_steam_id·steam_profile_unavailable은 프로필 열기·교환 공용 문구다.
const ERROR_TEXT: Record<string, string> = {
  connection_changed: '연결된 로비가 바뀌어 메시지를 보내지 않았습니다.',
  development_limit_50: '메시지는 50자까지 보낼 수 있습니다.',
  control_character: '보낼 수 없는 문자가 들어 있습니다.',
  storage_failed_before_send: '기록을 저장하지 못해 메시지를 보내지 않았습니다.',
  storage_failed: '저장에 실패했습니다. 작성한 내용은 이 창에서 확인해 주세요.',
  legal_unavailable: '안내 파일을 열지 못했습니다. 앱 파일을 복구하거나 다시 설치해 주세요.',
  invalid_steam_id: '대상을 확인하지 못했습니다. 참여자 목록을 다시 확인해 주세요.',
  steam_profile_unavailable: '현재 연결에서 열 수 없는 대상입니다. 참여자와 연결 상태를 확인해 주세요.',
  steam_profile_failed: 'Steam 프로필을 열지 못했습니다. Steam 실행 상태를 확인해 주세요.',
  steam_trade_failed: 'Steam 교환 요청 페이지를 열지 못했습니다. Steam 실행 상태를 확인해 주세요.',
  block_unavailable: '차단 설정을 저장하지 못했습니다. 이전 설정을 유지합니다.',
  not_wired: '아직 지원하지 않는 기능입니다.',
  bridge_down: '채팅 기능에 연결하지 못했습니다.',
  request_failed: REQUEST_FAILED,
};

// 드로어 차단 목록(D-033). 문구는 업스트림 원본 UI(ui/index.html·app.js)의 것
export const NO_BLOCKED_USERS = '차단한 사용자가 없습니다.';
export const BLOCKS_UNAVAILABLE = '차단 목록을 확인할 수 없어 상대 대화를 보류합니다. 연결 상태 새로고침 후 다시 확인해 주세요.';

export const PROFILE_OPENING = 'Steam 프로필을 여는 중입니다.';
export const TRADE_OPENING = 'Steam 교환 페이지를 여는 중입니다.';

export function errorText(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  return ERROR_TEXT[code] ?? REQUEST_FAILED;
}

const NOTICES: Record<string, string> = {
  checking: 'Steam과 게임 연결을 확인하고 있습니다.',
  searching_lobby: '로비를 확인 중입니다.',
  discovering: '로비가 확인되어 연결 중입니다.',
  discovery_failed: '로비를 다시 확인 중입니다. 확인이 끝나면 메시지를 보낼 수 있습니다.',
  read_only: '읽기 전용으로 실행 중입니다. 메시지를 전송할 수 없습니다.',
  no_lobby: '입장한 로비가 없습니다. 로비에 입장해 주세요.',
  game_files_changed: '게임 업데이트가 감지되어 연결 확인 중입니다.',
  compatibility_tool_missing: '호환성 검사 파일이 없어 연결할 수 없습니다. 앱을 다시 설치해 주세요.',
  compatibility_timeout: '호환성 검사가 길어져 연결을 보류하고 다시 확인합니다.',
  game_missing_or_ambiguous: 'Bongo Cat을 실행하면 연결할 수 있습니다.',
  worker_stopped: '게임 연결이 끊어졌습니다. 보낸 결과를 알 수 없는 메시지는 다시 보내지 않습니다.',
  offline: '오프라인으로 실행 중입니다. 게임과 연결하지 않습니다.',
};
export const VIEW_UNAVAILABLE = '대화를 불러오지 못해 표시하거나 보낼 수 없습니다. 다시 확인하고 있습니다.';
const STORAGE_ERROR = '저장에 실패해 일부 기록이 보관되지 않았습니다.';
const UNKNOWN_NOTICE = '게임 상태를 확인하지 못했습니다. 연결을 멈추고 다시 확인하고 있습니다.';

export function noticeText(view: ViewResponse | null) {
  if (!view) return '';
  if (view.notice === 'unsupported_game_build') {
    const build = /^[0-9]{1,12}$/.test(view.game_build) ? `게임 빌드 ${view.game_build}` : '현재 게임 파일';
    return `${build}의 호환성을 확인하지 못해 연결을 멈췄습니다. 아직 지원하지 않는 버전입니다.`;
  }
  if (view.notice) return NOTICES[view.notice] ?? UNKNOWN_NOTICE;
  return view.storage_error ? STORAGE_ERROR : '';
}
