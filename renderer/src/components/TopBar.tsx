import { useRef, useState } from 'react';
import { useUi } from '../state/UiContext';
import { useChat } from '../hooks/useChatView';
import type { ConnState } from '../chat/model';
import CatCount from './CatCount';
import styles from './TopBar.module.css';

const SPIN_MS = 600;
const CONN_LABEL: Record<ConnState, string> = { good: '연결', off: '연결 안 됨', nolobby: '로비 없음', checking: '확인 중' };

export default function TopBar() {
  const { dispatch } = useUi();
  const { conn, participants, refresh: refreshChat } = useChat();
  const [spinning, setSpinning] = useState(false);
  const spinTimer = useRef<number>(undefined);

  function refresh() {
    void refreshChat();
    setSpinning(true);
    clearTimeout(spinTimer.current);
    spinTimer.current = window.setTimeout(() => setSpinning(false), SPIN_MS);
  }

  return (
    <header className={styles.top}>
      <button className={styles.iconbtn} aria-label="메뉴" onClick={() => dispatch({ type: 'toggleDrawer' })}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
      <div className={styles.title}>
        <span className={styles.logo} />
        <span className={styles.brandname}>Cat Talk</span>
        <span className={styles.conn} data-state={conn}><i className={styles.dot} /><span>{CONN_LABEL[conn]}</span></span>
      </div>
      <CatCount count={participants.length} onClick={() => dispatch({ type: 'toggleModal' })} />
      <button className={styles.iconbtn} aria-label="검색" onClick={() => dispatch({ type: 'toggleSearch' })}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="10.7" cy="10.7" r="7.3" /><path d="m16 16 5 5" /></svg>
      </button>
      <button className={spinning ? `${styles.iconbtn} ${styles.spinning}` : styles.iconbtn} aria-label="새로고침" onClick={refresh}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 4v6h-6M3 20v-6h6M4.7 8a8 8 0 0 1 13-3L21 8M3 16l3.3 3a8 8 0 0 0 13-3" /></svg>
      </button>
    </header>
  );
}
