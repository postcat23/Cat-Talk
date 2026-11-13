import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { rpc } from '../rpc';
import { useUi, type Settings } from '../state/UiContext';
import { errorText, noticeText, PROFILE_OPENING, TRADE_OPENING, VIEW_UNAVAILABLE } from '../chat/messages';
import {
  accountStatus, connState, displayName, isPresence, SETTING_KEYS, settingsFromView, toChatItems, toParticipant,
  type AvatarLookup, type ChatItem, type ChatMessage, type ConnState, type Participant, type ViewContext, type ViewMessage, type ViewResponse,
} from '../chat/model';
import type { ReactionStack } from './useReactionStack';

const POLL_MS = 600;   // D-007: push 없이 view 폴링으로 전체 상태를 재구성한다
const MAX_SEEN_REACTIONS = 256;
const MAX_AVATAR_REQUEST = 32;   // 사이드카 상한(64) 안에서 나눠 받는다. 남은 건 다음 폴링에
const DRAFT_SAVE_MS = 300;
const PAGE_SIZE = 50;     // LIVE 창·load-more 단위. 검색은 view 기본값(100)
const MAX_LIVE_LIMIT = 1000;   // 사이드카 상한
const JUMP_CONTEXT = 25;   // 검색 점프: 매치 앞뒤로 불러올 개수
const HIGHLIGHT_MS = 2000;   // MessageList.module.css jumped 애니메이션과 같은 시간
// 전송 쿨다운(사용자 결정, 2026-11-13). worker(업스트림, 불변)는 직전 전송 시도 후 1.0초 안의 전송을 Steam에 보내지 않고
// failed로 돌린다. 전송(Enter·전송 버튼·↻ 재전송)을 낸 순간부터 이 시간 동안 다음 전송을 막아 그 실패를 만들지 않는다.
// 1300 = 1.0초 + 관측 최대 흔들림 203ms + 여유 약 100ms(사용자 결정). 사이드카는 바로 접수하지만 worker는 0.15초 주기로 큐를
// 꺼내므로(접수→처리 0~172ms) worker가 보는 간격이 낸 간격보다 짧아질 수 있다. 실측(가짜 송신, 210쌍): 1.10초 4/30·1.15초 2/30·
// 1.20초 0/30 실패. 남는 드문 실패는 ↻ 재전송이 받는다 — D-049
export const SEND_COOLDOWN_MS = 1300;

// 화면의 대화 창. 검색 결과는 여기 넣지 않아 검색을 풀면 그대로 돌아온다
interface Timeline { messages: ViewMessage[]; hasMore: boolean; hasNewer: boolean }
const EMPTY_TIMELINE: Timeline = { messages: [], hasMore: false, hasNewer: false };

// 반응 이미지는 PNG data URI만 그린다(upstream app.js와 같은 검사)
const png = (uri: string | undefined) => (uri?.startsWith('data:image/png;base64,') ? uri : undefined);

export interface Toast { id: number; text: string }
export interface Focus { id: string }   // 점프 대상. 점프마다 새 객체라 같은 메시지로 다시 가도 스크롤한다
export interface RestoredDraft { text: string }   // 같은 글이어도 복원마다 새 객체라 입력창이 다시 받는다
// 전송 쿨다운 표시용. key는 쿨다운을 시작할 때마다 올라 진행 링 애니메이션을 처음부터 다시 그린다
export interface Cooldown { active: boolean; key: number }

export interface Chat {
  items: ChatItem[];
  participants: Participant[];
  me: Participant | null;
  nicknames: Record<string, string>;   // 현재 계정의 표시 이름 덮어쓰기(steam_id → 이름, D-032)
  blockedUsers: { id: string; name: string }[];   // 앱 차단 목록(D-033). name은 닉네임 반영, 이름을 모르면 Steam ID
  blocksReady: boolean;                           // 차단 목록을 읽지 못했으면 false(업스트림이 상대 대화를 보류)
  conn: ConnState;
  accountStatus: string;
  notice: string;
  toast: Toast | null;
  canSend: boolean;
  incoming: number | undefined;
  restoredDraft: RestoredDraft | null;
  query: string;
  live: boolean;   // 바닥에서 최신을 따라가는 중. 아니면 창을 고정한다
  focus: Focus | null;
  newest: ChatMessage | null;   // HISTORY 창 밖의 가장 최신 메시지. 없거나 LIVE·검색 중이면 null
  byId(uid: string): Participant | undefined;
  setQuery(query: string): void;
  setLive(live: boolean): void;
  loadOlder(): Promise<void>;
  loadNewer(): Promise<void>;
  jumpTo(seq: number): Promise<void>;
  send(text: string): Promise<boolean>;   // 쿨다운 중이거나 보낼 수 없으면 false(글은 입력창에 남는다)
  resend(id: string): Promise<void>;      // 전송 실패한 내 메시지를 다시 보낸다(옛 행은 사라지고 맨 아래에 새로). 쿨다운 공유
  cooldown: Cooldown;
  openProfile(uid: string): Promise<void>;
  openTrade(uid: string): Promise<void>;
  setNickname(uid: string, name: string): Promise<void>;   // 빈 값이면 초기화(기본 Steam 닉네임으로 복귀)
  setBlocked(uid: string, blocked: boolean): Promise<void>;   // 앱 차단·해제(D-033). 성공 안내 없이 목록 변화로 보인다
  refresh(): Promise<void>;
  saveSettings(patch: Partial<Settings>): void;
  saveDraft(text: string, now?: boolean): void;
  sending: boolean;      // 보낸 메시지의 응답을 기다리는 중. 그동안 앱 업데이트(재시작)를 막는다(D-030)
  hasDraft(): boolean;   // 입력창에 쓰던 글이 있는지(복원된 초안 포함). 업데이트 재시작 전 확인용
}

export function useChatView(pushReaction: ReactionStack['push'], reactionsEnabled: boolean): Chat {
  const { dispatch } = useUi();
  const [view, setView] = useState<ViewResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQueryState] = useState('');
  const [toast, setToast] = useState<Toast | null>(null);
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [restoredDraft, setRestoredDraft] = useState<RestoredDraft | null>(null);
  const [timeline, setTimeline] = useState(EMPTY_TIMELINE);
  const [results, setResults] = useState<ViewMessage[] | null>(null);   // 첫 응답 전에는 창을 그대로 둬 스크롤 위치를 잃지 않는다
  const [live, setLiveState] = useState(true);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [latest, setLatest] = useState<ViewMessage | null>(null);   // HISTORY 폴링이 받은 최신 메시지
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState<Cooldown>({ active: false, key: 0 });
  const cooldownUntil = useRef(0);   // performance.now() 기준. 판정은 이 값으로 하고 cooldown 상태는 표시용이다
  const cooldownTimer = useRef(0);

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
  const openingTrade = useRef(false);
  const draftScope = useRef<Pick<ViewContext, 'account' | 'lobby'> | null>(null);   // 입력창 글이 속한 계정·로비
  const pendingDraft = useRef<{ text: string; timer: number } | null>(null);
  const draftText = useRef('');   // 입력창의 마지막 글. 입력(saveDraft)과 로비 초안 복원(takeDraft) 둘 다 기록한다
  const timelineRef = useRef(EMPTY_TIMELINE);
  const liveRef = useRef(true);
  const liveLimit = useRef(PAGE_SIZE);   // 창을 못 채워 스크롤할 수 없을 때만 늘어난다
  const loading = useRef(false);
  const focusTimer = useRef(0);
  const resetLive = useRef(() => {});   // poll이 setLive보다 먼저 정의돼 있어 ref로 부른다
  const reactionInput = useRef({ pushReaction, reactionsEnabled });
  useEffect(() => { reactionInput.current = { pushReaction, reactionsEnabled }; });

  const showError = useCallback((error: unknown) => {
    setToast({ id: nextToast.current++, text: errorText(error) });
  }, []);

  const applyTimeline = useCallback((next: Timeline) => {
    timelineRef.current = next;
    setTimeline(next);
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

  // 배경 저장이라 실패해도 알리지 않는다. 글은 입력창에 남아 있고 다음 입력 때 다시 저장한다.
  const flushDraft = useCallback(() => {
    const pending = pendingDraft.current, scope = draftScope.current;
    if (!pending || !scope) return;
    clearTimeout(pending.timer);
    pendingDraft.current = null;
    rpc('draft', { ...scope, text: pending.text }).catch(() => {});
  }, []);

  const saveDraft = useCallback((text: string, now = false) => {
    draftText.current = text;
    if (pendingDraft.current) clearTimeout(pendingDraft.current.timer);
    pendingDraft.current = { text, timer: window.setTimeout(flushDraft, DRAFT_SAVE_MS) };
    if (now) flushDraft();
  }, [flushDraft]);

  // 처음 들어왔거나 계정·로비가 바뀌면 입력창을 그 로비의 초안으로 바꾼다. 쓰던 글은 이전 로비에 먼저 저장한다.
  // 같은 로비에서는 폴링이 입력 중인 글을 덮지 않게 다시 넣지 않는다. 로비가 비는 구간(재연결 등)도 글을 유지한다.
  const takeDraft = useCallback((data: ViewResponse) => {
    const { account, lobby } = data.context, scope = draftScope.current;
    if (!account || !lobby || (scope?.account === account && scope.lobby === lobby)) return false;
    flushDraft();
    draftScope.current = { account, lobby };
    draftText.current = data.draft ?? '';   // 복원은 입력창이 saveDraft로 알리지 않는다
    setRestoredDraft({ text: data.draft ?? '' });
    return true;
  }, [flushDraft]);

  const poll = useCallback(async () => {
    if (busy.current) { again.current = true; return; }
    busy.current = true;
    const sent = version.current, requestedAt = performance.now();
    const q = queryRef.current;
    try {
      const data = await rpc<ViewResponse>('view', {
        // HISTORY는 창을 고정하므로 연결 상태·latest_seq 같은 메타데이터만 받는다
        ...(q ? { query: q } : { limit: liveRef.current ? liveLimit.current : 1 }),
        reactions: reactionInput.current.reactionsEnabled && !q && !document.hidden,
      });
      takeReactions(data, requestedAt);   // 사이드카는 준 반응을 지우므로 응답을 버려도 받아 둔다
      if (sent !== version.current) return;
      setFailed(false);
      fetchAvatars(data);
      viewRef.current = data;
      // 다른 로비로 옮겼으면 고정해 둔 창도 그 로비 것이 아니다
      if (takeDraft(data)) {
        liveLimit.current = PAGE_SIZE;
        applyTimeline(EMPTY_TIMELINE);
        if (!liveRef.current) { resetLive.current(); return; }
      }
      // 저장 안 된 메시지는 latest_seq를 바꾸지 않아 signature 비교 전에 받는다. 맨 끝이 입퇴장 행이면 직전 메시지를 유지한다
      const newest = !q && !liveRef.current ? data.messages.filter((m) => !isPresence(m)).at(-1) : undefined;
      if (newest) setLatest((current) => (current?.id === newest.id ? current : newest));
      // 설정은 시작 시 1회만 받는다. 이후로는 렌더러가 값을 쥐고 저장만 요청한다(폴링이 조작을 되돌리지 않게).
      if (!hydrated.current) {
        hydrated.current = true;
        dispatch({ type: 'setSettings', patch: settingsFromView(data) });
      }
      // revision은 하트비트마다 오르므로 비교에서 뺀다. 내용이 같으면 다시 그리지 않는다.
      const meta = q || liveRef.current ? data : { ...data, messages: [] };
      const { revision: _revision, reactions: _reactions, draft: _draft, ...content } = meta;
      const next = JSON.stringify(content);
      if (next !== signature.current) {
        signature.current = next;
        setView(meta);
        if (q) setResults(data.messages);
        else if (liveRef.current) applyTimeline({ messages: data.messages, hasMore: data.has_more, hasNewer: false });
      }
    } catch {
      if (sent === version.current) { setFailed(true); viewRef.current = null; signature.current = ''; }
    } finally {
      busy.current = false;
      if (again.current) { again.current = false; void poll(); }
    }
  }, [applyTimeline, dispatch, fetchAvatars, takeDraft, takeReactions]);

  useEffect(() => {
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  const setQuery = useCallback((next: string) => {
    if (next === queryRef.current) return;
    queryRef.current = next;
    setQueryState(next);
    if (!next) setResults(null);
    version.current++;
    signature.current = '';
    void poll();
  }, [poll]);

  const setLive = useCallback((next: boolean) => {
    if (next === liveRef.current) return;
    liveRef.current = next;
    setLiveState(next);
    version.current++;   // 이전 모드로 보낸 폴링 응답이 창을 건드리지 않게 한다
    signature.current = '';
    if (next) { liveLimit.current = PAGE_SIZE; setLatest(null); void poll(); }
  }, [poll]);
  useEffect(() => { resetLive.current = () => setLive(true); }, [setLive]);

  // 창 앞에 과거 페이지를 붙인다. seq는 연속이 아니라 현재 창의 가장 오래된 seq를 경계로 쓴다.
  const loadOlder = useCallback(async () => {
    const { messages, hasMore } = timelineRef.current;
    const first = messages.find((m) => m.seq !== undefined)?.seq;
    if (loading.current || !hasMore || first === undefined || queryRef.current) return;
    // LIVE에서 여기 오는 건 창이 화면을 못 채운 경우뿐이다. 폴링이 덮어쓰므로 창 자체를 키운다
    if (liveRef.current) {
      liveLimit.current = Math.min(liveLimit.current + PAGE_SIZE, MAX_LIVE_LIMIT);
      void poll();
      return;
    }
    loading.current = true;
    const sent = version.current;
    try {
      const page = await rpc<ViewResponse>('view', { before: first, limit: PAGE_SIZE });
      if (sent !== version.current) return;
      const current = timelineRef.current;
      applyTimeline({ ...current, messages: [...page.messages, ...current.messages], hasMore: page.has_more });
    } catch (error) {
      if (sent === version.current) showError(error);
    } finally {
      loading.current = false;
    }
  }, [applyTimeline, poll, showError]);

  // 창의 바닥에 닿았을 때 부른다. 뒤에 더 있으면 이어 붙이고, 없으면 최신에 닿은 것이라 LIVE로 돌아간다.
  // 창을 고정한 뒤 도착한 메시지는 hasNewer에 없어서 폴링의 latest_seq로 판단한다.
  const loadNewer = useCallback(async () => {
    const { messages, hasNewer } = timelineRef.current;
    const last = messages.filter((m) => m.seq !== undefined).at(-1)?.seq;
    if (loading.current || liveRef.current || queryRef.current) return;
    if (last === undefined || !(hasNewer || (viewRef.current?.latest_seq ?? 0) > last)) { setLive(true); return; }
    loading.current = true;
    const sent = version.current;
    try {
      const page = await rpc<ViewResponse>('view', { start: last + 1, limit: PAGE_SIZE });
      if (sent !== version.current) return;
      const current = timelineRef.current;
      const known = new Set(current.messages.map((m) => m.id));   // 저장 안 된 메시지는 seq 경계로 걸러지지 않는다
      applyTimeline({ ...current, messages: [...current.messages, ...page.messages.filter((m) => !known.has(m.id))], hasNewer: page.has_newer });
    } catch (error) {
      if (sent === version.current) showError(error);
    } finally {
      loading.current = false;
    }
  }, [applyTimeline, setLive, showError]);

  // 검색 매치 주변을 HISTORY 창으로 불러온다. seq가 연속이 아니라서 매치를 경계로 앞(before)·뒤(start, 매치 포함)를 따로 받는다.
  const jumpTo = useCallback(async (seq: number) => {
    const sent = ++version.current;
    try {
      const [older, newer] = await Promise.all([
        rpc<ViewResponse>('view', { before: seq, limit: JUMP_CONTEXT }),
        rpc<ViewResponse>('view', { start: seq, limit: JUMP_CONTEXT + 1 }),
      ]);
      if (sent !== version.current) return;
      version.current++;   // 기다리는 사이 보낸 검색 폴링을 버린다
      liveRef.current = false;
      setLiveState(false);
      applyTimeline({ messages: [...older.messages, ...newer.messages], hasMore: older.has_more, hasNewer: newer.has_newer });
      queryRef.current = '';
      setQueryState('');
      setResults(null);
      signature.current = '';
      dispatch({ type: 'toggleSearch' });
      setFocus({ id: newer.messages[0]?.id ?? '' });
      clearTimeout(focusTimer.current);
      focusTimer.current = window.setTimeout(() => setFocus(null), HIGHLIGHT_MS);
    } catch (error) {
      if (sent === version.current) showError(error);
    }
  }, [applyTimeline, dispatch, showError]);

  // 쿨다운 중이면 false. 아니면 지금부터 쿨다운을 시작하고 true(전송을 낸 순간 기준 — 사이드카 응답을 기다리지 않는다)
  const takeSendSlot = useCallback(() => {
    const now = performance.now();
    if (now < cooldownUntil.current) return false;
    cooldownUntil.current = now + SEND_COOLDOWN_MS;
    clearTimeout(cooldownTimer.current);
    setCooldown((c) => ({ active: true, key: c.key + 1 }));
    cooldownTimer.current = window.setTimeout(() => setCooldown((c) => ({ ...c, active: false })), SEND_COOLDOWN_MS);
    return true;
  }, []);
  useEffect(() => () => clearTimeout(cooldownTimer.current), []);

  // 사용자가 입력창에서 보낸 텍스트만 여기로 온다. 자동 송신 경로는 없다.
  const send = useCallback(async (text: string) => {
    const current = viewRef.current;
    if (!current?.can_send || !takeSendSlot()) return false;
    setSending(true);
    try {
      await rpc('send', { context: current.context, text });
      setLive(true);
      void poll();
      return true;
    } catch (error) {
      showError(error);
      return false;
    } finally {
      setSending(false);
    }
  }, [poll, setLive, showError, takeSendSlot]);

  // ↻ 재전송: 사용자가 누른 실패 메시지만. 사이드카가 저장된 원문으로 다시 보내고 옛 행을 지운다(새 행은 맨 아래).
  // 쿨다운을 send와 함께 써서 연타·연속 전송으로 다시 실패하지 않게 한다. 맨 아래로 간 메시지가 보이게 LIVE로 돌린다
  const resend = useCallback(async (id: string) => {
    const current = viewRef.current;
    if (!current?.can_send || !takeSendSlot()) return;
    setSending(true);
    try {
      await rpc('resend', { context: current.context, id });
      setLive(true);
      void poll();
    } catch (error) {
      showError(error);
    } finally {
      setSending(false);
    }
  }, [poll, setLive, showError, takeSendSlot]);

  const hasDraft = useCallback(() => draftText.current.trim() !== '', []);

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

  // 교환 요청(거래 제안) 페이지 열기. 프로필 열기와 같은 구조이고, 대상 검증도 사이드카가 같은 기준으로 한다
  const openTrade = useCallback(async (uid: string) => {
    if (openingTrade.current) return;
    openingTrade.current = true;
    dispatch({ type: 'closeOverlays' });
    setToast({ id: nextToast.current++, text: TRADE_OPENING });
    try {
      await rpc('open_steam_trade', { steam_id: uid, context: viewRef.current?.context });
    } catch (error) {
      showError(error);
    } finally {
      openingTrade.current = false;
    }
  }, [dispatch, showError]);

  // 참여자 표시 이름 덮어쓰기(D-032). 저장 뒤 바로 view를 다시 받아 목록·대화에 반영한다(낙관적 갱신 없음)
  const setNickname = useCallback(async (uid: string, name: string) => {
    try {
      await rpc('set_nickname', { account: viewRef.current?.context.account ?? '', steam_id: uid, name: name.trim() });
      void poll();
    } catch (error) {
      // 에러 토스트는 참여자 모달 아래에 깔리므로 닫아서 보이게 한다(프로필 열기와 같은 방식)
      dispatch({ type: 'closeOverlays' });
      showError(error);
    }
  }, [dispatch, poll, showError]);

  // 앱 차단·해제(D-033). 업스트림이 차단한 사람의 채팅·입퇴장·반응을 거르고, 목록은 view의 blocked 플래그로 숨긴다.
  // 성공하면 바로 view를 다시 받는다. 실패하면 오버레이를 닫고 에러 토스트(드로어·참여자 모달 아래에 깔리므로)
  const setBlocked = useCallback(async (uid: string, blocked: boolean) => {
    try {
      await rpc('block_user', { account: viewRef.current?.context.account ?? '', steam_id: uid, blocked });
      void poll();
    } catch (error) {
      dispatch({ type: 'closeOverlays' });
      showError(error);
    }
  }, [dispatch, poll, showError]);

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
  const items = useMemo(() => {
    // 연결이 끊겨도 HISTORY는 고정한 창을 계속 보여 준다
    const source = query || live ? shown : view;
    if (!source) return [];
    return toChatItems({ ...source, messages: (query && results) || timeline.messages }, avatarOf);
  }, [shown, view, query, results, live, timeline, avatarOf]);
  const newest = useMemo(() => {
    if (live || query || !view || !latest || timeline.messages.some((m) => m.id === latest.id)) return null;
    const [item] = toChatItems({ ...view, messages: [latest] }, avatarOf);
    return item.kind === 'msg' ? item : null;
  }, [live, query, view, latest, timeline, avatarOf]);
  const participants = useMemo(
    // 앱에서 차단한 멤버는 목록·상단바 참여자 수에서 뺀다(D-033). view.participants에는 blocked 플래그와 함께 남아 있다
    () => Object.entries(shown?.participants ?? {}).filter(([, p]) => !p.blocked)
      .map(([uid, p]) => toParticipant(uid, p, '이름 확인 중', avatarOf, shown?.nicknames)),
    [shown, avatarOf],
  );
  const nicknames = useMemo(() => shown?.nicknames ?? {}, [shown]);
  const blockedUsers = useMemo(
    () => (shown?.blocked_users ?? []).map((u) => ({ id: u.steam_id, name: displayName(u.steam_id, u.name || u.steam_id, shown?.nicknames) })),
    [shown],
  );
  const account = shown?.context.account ?? '';
  const me = useMemo(
    () => (account && shown?.profiles[account] ? toParticipant(account, shown.profiles[account], '계정 확인 중', avatarOf) : null),
    [account, shown, avatarOf],
  );
  const lookup = useMemo(() => new Map(participants.map((p) => [p.id, p])), [participants]);
  const byId = useCallback((uid: string) => lookup.get(uid), [lookup]);

  return {
    items, participants, me, nicknames, blockedUsers, query, live, focus, newest, toast, restoredDraft, byId, setQuery, setLive, loadOlder, loadNewer, jumpTo, send, resend, cooldown, openProfile, openTrade, setNickname, setBlocked, refresh, saveSettings, saveDraft, sending, hasDraft,
    blocksReady: shown?.blocks_ready ?? true,
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
