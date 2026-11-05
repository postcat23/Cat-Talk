import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { rpc } from '../rpc';
import { useUi, type Settings } from '../state/UiContext';
import { errorText, noticeText, PROFILE_OPENING, VIEW_UNAVAILABLE } from '../chat/messages';
import {
  accountStatus, connState, SETTING_KEYS, settingsFromView, toChatItems, toParticipant,
  type AvatarLookup, type ChatItem, type ConnState, type Participant, type ViewResponse,
} from '../chat/model';
import type { ReactionStack } from './useReactionStack';

const POLL_MS = 600;   // D-007: push 없이 view 폴링으로 전체 상태를 재구성한다
const MAX_SEEN_REACTIONS = 256;
const MAX_AVATAR_REQUEST = 32;   // 사이드카 상한(64) 안에서 나눠 받는다. 남은 건 다음 폴링에

// 반응 이미지는 PNG data URI만 그린다(upstream app.js와 같은 검사)
const png = (uri: string | undefined) => (uri?.startsWith('data:image/png;base64,') ? uri : undefined);

export interface Toast { id: number; text: string }

export interface Chat {
  items: ChatItem[];
  participants: Participant[];
  me: Participant | null;
  conn: ConnState;
  accountStatus: string;
  notice: string;
  toast: Toast | null;
  canSend: boolean;
  incoming: number | undefined;
  query: string;
  byId(uid: string): Participant | undefined;
  setQuery(query: string): void;
  send(text: string): Promise<boolean>;
  openProfile(uid: string): Promise<void>;
  refresh(): Promise<void>;
  saveSettings(patch: Partial<Settings>): void;
}

export function useChatView(pushReaction: ReactionStack['push'], reactionsEnabled: boolean): Chat {
  const { dispatch } = useUi();
  const [view, setView] = useState<ViewResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQueryState] = useState('');
  const [toast, setToast] = useState<Toast | null>(null);
  const [avatars, setAvatars] = useState<Record<string, string>>({});

  const viewRef = useRef<ViewResponse | null>(null);
  const queryRef = useRef('');
  const version = useRef(0);          // 검색이 바뀌면 올려서, 진행 중이던 이전 응답을 버린다
  const busy = useRef(false);
  const again = useRef(false);
  const signature = useRef('');
  const hydrated = useRef(false);
  const seenReactions = useRef(new Set<string>());
  const requestedAvatars = useRef(new Set<string>());
  const nextToast = useRef(1);
  const openingProfile = useRef(false);
  const reactionInput = useRef({ pushReaction, reactionsEnabled });
  useEffect(() => { reactionInput.current = { pushReaction, reactionsEnabled }; });

  const showError = useCallback((error: unknown) => {
    setToast({ id: nextToast.current++, text: errorText(error) });
  }, []);

  const takeReactions = useCallback((data: ViewResponse, requestedAt: number) => {
    const seen = seenReactions.current;
    for (const event of data.reactions ?? []) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      if (seen.size > MAX_SEEN_REACTIONS) seen.delete(seen.values().next().value as string);
      // 늦게 도착한 응답이 만료된 반응을 되살리지 않게 한다
      if (event.expires_in_ms > performance.now() - requestedAt) {
        reactionInput.current.pushReaction(event.sender, event.kind, event.text ?? '', png(event.avatar), png(event.image));
      }
    }
  }, []);

  // view에는 id만 온다. 처음 보는 이미지만 받아 메모리에 둔다(디스크·localStorage에 쓰지 않는다).
  const fetchAvatars = useCallback((data: ViewResponse) => {
    const requested = requestedAvatars.current;
    // 메시지 작성자는 나간 뒤에도 profiles에 남으므로 둘 다 본다
    const ids = [...new Set([...Object.values(data.participants), ...Object.values(data.profiles)].map((p) => p.avatar_id).concat(data.default_avatar_id))]
      .filter((id): id is string => Boolean(id) && !requested.has(id as string))
      .slice(0, MAX_AVATAR_REQUEST);
    if (ids.length === 0) return;
    ids.forEach((id) => requested.add(id));
    rpc<{ images: Record<string, string> }>('avatars', { ids })
      .then(({ images }) => setAvatars((current) => ({ ...current, ...images })))
      .catch(() => ids.forEach((id) => requested.delete(id)));   // 표시는 이모지 폴백, 다음 폴링에서 재시도
  }, []);

  const poll = useCallback(async () => {
    if (busy.current) { again.current = true; return; }
    busy.current = true;
    const sent = version.current, requestedAt = performance.now();
    const q = queryRef.current;
    try {
      const data = await rpc<ViewResponse>('view', {
        ...(q && { query: q }),
        reactions: reactionInput.current.reactionsEnabled && !q && !document.hidden,
      });
      if (sent !== version.current) return;
      setFailed(false);
      takeReactions(data, requestedAt);
      fetchAvatars(data);
      viewRef.current = data;
      // 설정은 시작 시 1회만 받는다. 이후로는 렌더러가 값을 쥐고 저장만 요청한다(폴링이 조작을 되돌리지 않게).
      if (!hydrated.current) {
        hydrated.current = true;
        dispatch({ type: 'setSettings', patch: settingsFromView(data) });
      }
      // revision은 하트비트마다 오르므로 비교에서 뺀다. 내용이 같으면 다시 그리지 않는다.
      const { revision: _revision, reactions: _reactions, ...content } = data;
      const next = JSON.stringify(content);
      if (next !== signature.current) { signature.current = next; setView(data); }
    } catch {
      if (sent === version.current) { setFailed(true); viewRef.current = null; signature.current = ''; }
    } finally {
      busy.current = false;
      if (again.current) { again.current = false; void poll(); }
    }
  }, [dispatch, fetchAvatars, takeReactions]);

  useEffect(() => {
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  const setQuery = useCallback((next: string) => {
    if (next === queryRef.current) return;
    queryRef.current = next;
    setQueryState(next);
    version.current++;
    void poll();
  }, [poll]);

  // 사용자가 입력창에서 보낸 텍스트만 여기로 온다. 자동 송신 경로는 없다.
  const send = useCallback(async (text: string) => {
    const current = viewRef.current;
    if (!current?.can_send) return false;
    try {
      await rpc('send', { context: current.context, text });
      void poll();
      return true;
    } catch (error) {
      showError(error);
      return false;
    }
  }, [poll, showError]);

  const openProfile = useCallback(async (uid: string) => {
    if (openingProfile.current) return;
    openingProfile.current = true;
    // 토스트는 모달 아래에 깔리므로 닫아서 보이게 한다. 실패하면 에러 토스트가 이 자리를 대신한다
    dispatch({ type: 'closeOverlays' });
    setToast({ id: nextToast.current++, text: PROFILE_OPENING });
    try {
      await rpc('open_steam_profile', { steam_id: uid, context: viewRef.current?.context });
    } catch (error) {
      showError(error);
    } finally {
      openingProfile.current = false;
    }
  }, [dispatch, showError]);

  const refresh = useCallback(async () => {
    try { await rpc('refresh'); }
    catch (error) { showError(error); }
    void poll();
  }, [poll, showError]);

  const saveSettings = useCallback((patch: Partial<Settings>) => {
    for (const name of Object.keys(patch) as (keyof Settings)[]) {
      const key = SETTING_KEYS[name];
      if (!key) continue;
      rpc('setting', { key, value: patch[name] }).catch((error) => {
        showError(error);
        // 저장에 실패하면 화면도 사이드카가 가진 값으로 되돌린다
        const stored = viewRef.current && settingsFromView(viewRef.current)[name];
        if (stored !== undefined && stored !== null) dispatch({ type: 'setSettings', patch: { [name]: stored } });
      });
    }
  }, [dispatch, showError]);

  const shown = failed ? null : view;
  const ready = shown?.avatar_stage === 'ready';
  // 아바타가 아직 없거나(스킨 변경 중 포함) 받기 전이면 게임 기본 고양이. 그것도 없으면(브라우저 dev 등) 이모지
  const placeholder = ready && shown?.default_avatar_id ? avatars[shown.default_avatar_id] : undefined;
  const avatarOf = useCallback<AvatarLookup>(
    (id) => (ready ? (id && avatars[id]) || placeholder : undefined), [ready, avatars, placeholder]);
  const items = useMemo(() => (shown ? toChatItems(shown, avatarOf) : []), [shown, avatarOf]);
  const participants = useMemo(
    () => Object.entries(shown?.participants ?? {}).map(([uid, p]) => toParticipant(uid, p, '이름 확인 중', avatarOf)),
    [shown, avatarOf],
  );
  const account = shown?.context.account ?? '';
  const me = useMemo(
    () => (account && shown?.profiles[account] ? toParticipant(account, shown.profiles[account], '계정 확인 중', avatarOf) : null),
    [account, shown, avatarOf],
  );
  const lookup = useMemo(() => new Map(participants.map((p) => [p.id, p])), [participants]);
  const byId = useCallback((uid: string) => lookup.get(uid), [lookup]);

  return {
    items, participants, me, query, toast, byId, setQuery, send, openProfile, refresh, saveSettings,
    conn: failed ? 'off' : connState(view),
    accountStatus: accountStatus(shown),
    notice: failed ? VIEW_UNAVAILABLE : noticeText(view),
    canSend: shown?.can_send === true,
    incoming: shown?.incoming_count,
  };
}

export const ChatContext = createContext<Chat | null>(null);

export function useChat() {
  const chat = useContext(ChatContext);
  if (!chat) throw new Error('useChat must be used inside ChatContext');
  return chat;
}
