import { useRef, useState } from 'react';
import { useUi } from '../state/UiContext';
import { CONN_LABEL, type ConnState } from '../mock/mockData';
import CatCount from './CatCount';
import styles from './TopBar.module.css';

const SPIN_MS = 600;

export default function TopBar({ conn, count }: { conn: ConnState; count: number }) {
  const { dispatch } = useUi();
  const [spinning, setSpinning] = useState(false);
  const spinTimer = useRef<number>(undefined);

  // 새로고침은 아이콘 회전만(실제 refresh 액션은 2e-2c)
  function refresh() {
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
        <span className={styles.brandname}>Cat-Talk</span>
        <span className={styles.conn} data-state={conn}><i className={styles.dot} /><span>{CONN_LABEL[conn]}</span></span>
      </div>
      <CatCount count={count} onClick={() => dispatch({ type: 'toggleModal' })} />
      <button className={styles.iconbtn} aria-label="검색" onClick={() => dispatch({ type: 'toggleSearch' })}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="10.7" cy="10.7" r="7.3" /><path d="m16 16 5 5" /></svg>
      </button>
      <button className={spinning ? `${styles.iconbtn} ${styles.spinning}` : styles.iconbtn} aria-label="새로고침" onClick={refresh}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 4v6h-6M3 20v-6h6M4.7 8a8 8 0 0 1 13-3L21 8M3 16l3.3 3a8 8 0 0 0 13-3" /></svg>
      </button>
    </header>
  );
}
