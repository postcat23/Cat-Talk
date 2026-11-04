import { useEffect, useRef } from 'react';
import { useUi } from '../state/UiContext';
import styles from './SearchBar.module.css';

// 목업과 같이 열기/닫기·포커스만. 실제 검색(search 인자)은 2e-2c.
export default function SearchBar() {
  const { overlays } = useUi();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (overlays.searchOpen) input.current?.focus();
  }, [overlays.searchOpen]);

  return (
    <div className={overlays.searchOpen ? `${styles.search} ${styles.open}` : styles.search}>
      <div className={styles.inner}>
        <input ref={input} type="search" placeholder="대화 검색" autoComplete="off" />
      </div>
    </div>
  );
}
