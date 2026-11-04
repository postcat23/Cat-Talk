import { useEffect, useRef } from 'react';
import { useUi } from '../state/UiContext';
import { useChat } from '../hooks/useChatView';
import styles from './SearchBar.module.css';

const MAX_QUERY = 120;   // 사이드카 view가 받는 상한. 넘으면 invalid_query

// 입력값을 view의 query 인자로 넘긴다. 닫으면 검색을 풀고 대화로 돌아간다.
export default function SearchBar() {
  const { overlays } = useUi();
  const { query, setQuery } = useChat();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (overlays.searchOpen) input.current?.focus();
    else setQuery('');
  }, [overlays.searchOpen, setQuery]);

  return (
    <div className={overlays.searchOpen ? `${styles.search} ${styles.open}` : styles.search}>
      <div className={styles.inner}>
        <input ref={input} type="search" placeholder="대화 검색" autoComplete="off" maxLength={MAX_QUERY}
          value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
    </div>
  );
}
