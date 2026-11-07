import { useLayoutEffect, useRef } from 'react';
import { useUi } from '../state/UiContext';
import { useChat, type Focus } from '../hooks/useChatView';
import Cat from './Cat';
import Message from './Message';
import styles from './MessageList.module.css';

const BOTTOM_SLOP = 2;
const NEAR_TOP = 200;   // 맨 위에서 이 거리 안에 들어오면 과거를 미리 불러온다

export default function MessageList() {
  const { settings } = useUi();
  const { items, query, live, focus, newest, setLive, loadOlder, loadNewer, jumpTo } = useChat();
  const scroll = useRef<HTMLDivElement>(null);
  const firstId = useRef<string | undefined>(undefined);
  const height = useRef(0);   // 직전 scrollHeight: 과거 페이지가 붙은 만큼 scrollTop을 보정한다
  const searching = useRef(false);
  const searchTop = useRef(0);   // 검색을 풀면 HISTORY는 보던 자리로 돌아간다
  const focused = useRef<Focus | null>(null);

  const atBottom = (el: HTMLDivElement) => el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLOP;

  function loadNearEdge(el: HTMLDivElement) {
    if (el.scrollTop < NEAR_TOP) void loadOlder();
    if (!live && atBottom(el)) void loadNewer();
  }

  // 검색 점프면 매치를 가운데로, LIVE면 맨 아래를 따라가고, 창 앞에 과거가 붙었으면 보던 위치를 그대로 둔다.
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const first = items[0]?.id;
    const target = focus && focus !== focused.current && !query
      ? el.querySelector<HTMLElement>(`[data-id="${CSS.escape(focus.id)}"]`) : null;
    focused.current = focus;
    const prepended = !live && !query && !searching.current && firstId.current !== undefined && first !== firstId.current
      && items.some((item) => item.id === firstId.current);
    if (query) {
      if (!searching.current) searchTop.current = el.scrollTop;
      el.scrollTop = 0;
    }
    else if (target) {
      const box = el.getBoundingClientRect(), row = target.getBoundingClientRect();
      el.scrollTop += row.top - box.top - (box.height - row.height) / 2;
    }
    else if (prepended) el.scrollTop += el.scrollHeight - height.current;
    else if (live) el.scrollTop = el.scrollHeight;
    else if (searching.current) el.scrollTop = searchTop.current;
    searching.current = Boolean(query);
    firstId.current = first;
    height.current = el.scrollHeight;
    if (!query) loadNearEdge(el);
  }, [items, query, live, focus]);

  function onScroll() {
    const el = scroll.current;
    if (!el || query) return;
    height.current = el.scrollHeight;
    if (!atBottom(el)) setLive(false);
    loadNearEdge(el);
  }

  return (
    <>
      <div className={`${styles.scroll} thin-scroll`} ref={scroll} onScroll={onScroll}>
        {items.length === 0 && <div className={`${styles.presence} ${styles.empty}`}>{query ? '검색 결과가 없습니다' : '대화를 기다리고 있습니다'}</div>}
        {items.map((item, i) => {
          if (item.kind === 'presence') {
            return settings.presence ? <div key={item.id} className={styles.presence}>{item.text}</div> : null;
          }
          // 직전 항목이 같은 발신자의 메시지가 아니면 묶음의 첫 메시지(lead)
          const prev = items[i - 1];
          const lead = !(prev && prev.kind === 'msg' && prev.sender === item.sender);
          const { seq } = item;
          return <Message key={item.id} message={item} lead={lead} afterNotice={settings.presence && prev?.kind === 'presence'}
            jumped={item.id === focus?.id} onJump={query && seq !== undefined ? () => void jumpTo(seq) : undefined} />;
        })}
      </div>
      {!query && !live && (newest ? (
        <button className={`${styles.toBottom} ${styles.preview}`} aria-label={`맨 아래로: ${newest.author.name} ${newest.text}`} onClick={() => setLive(true)}>
          {!settings.clearCats && <span className={newest.author.avatar ? `${styles.pcat} ${styles.stand}` : styles.pcat}><Cat src={newest.author.avatar} framing="sprite" /></span>}
          <span className={styles.pname}>{newest.author.name}</span>
          <span className={styles.pbody}>{newest.text}</span>
        </button>
      ) : (
        <button className={styles.toBottom} aria-label="맨 아래로" onClick={() => setLive(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      ))}
    </>
  );
}
