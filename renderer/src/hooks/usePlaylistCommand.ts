import { useCallback, type Dispatch } from 'react';
import type { UiAction } from '../state/UiContext';
import type { Chat } from './useChatView';
import { classifyLink, parsePlaylistCommand, PL_EMPTY, PL_MINE_EMPTY, PL_ONLY_VIDEO, PL_ONLY_YOUTUBE, PL_USAGE } from '../chat/playlist';

// '/플리 …' 입력 처리(D-053). 채팅으로 보내지 않는다. true면 입력창을 비운다 —
// 추가가 접수됐거나 랜덤·목록·삭제를 실행한(목록이 비어 안내만 한 경우 포함) 때. 링크·사용법 오류는 글을 남겨 고칠 수 있게 한다
export function usePlaylistCommand(chat: Chat, dispatch: Dispatch<UiAction>) {
  const { notify, playlist, playlistMine, playlistAdd, showRandom } = chat;
  return useCallback(async (text: string) => {
    const command = parsePlaylistCommand(text);
    if (!command || command.kind === 'usage') { notify(PL_USAGE); return false; }
    if (command.kind === 'add') {
      const link = classifyLink(command.link);
      if (link.kind === 'not_youtube') { notify(PL_ONLY_YOUTUBE); return false; }
      if (link.kind === 'not_video') { notify(PL_ONLY_VIDEO); return false; }
      return playlistAdd(link.id);
    }
    if (command.kind === 'delete') {
      if (playlistMine.length === 0) notify(PL_MINE_EMPTY);
      else dispatch({ type: 'openPlaylist', mode: 'delete' });
      return true;
    }
    if (playlist.length === 0) { notify(PL_EMPTY); return true; }
    if (command.kind === 'random') showRandom(playlist[Math.floor(Math.random() * playlist.length)].id);
    else dispatch({ type: 'openPlaylist', mode: 'list' });
    return true;
  }, [dispatch, notify, playlist, playlistMine, playlistAdd, showRandom]);
}
