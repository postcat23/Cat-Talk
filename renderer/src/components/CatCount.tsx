import styles from './CatCount.module.css';

// 참여자 버튼: 눈까지만 보이는 고양이 실루엣 + 모자 자리에 인원수.
// 실루엣은 currentColor(=--fg)라 라이트=검정, 다크=흰색으로 테마를 따른다.
export default function CatCount({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button className={styles.catcount} aria-label={`참여자 ${count}명`} onClick={onClick}>
      <span className={styles.n}>{count}</span>
      <span className={styles.face}>
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M3 2l4.6 5.6A8.6 8.6 0 0 1 12 6.6c1.6 0 3.1.35 4.4 1L21 2l-.7 8.1c.45 1.1.7 2.3.7 3.5 0 4.1-4 7.4-9 7.4s-9-3.3-9-7.4c0-1.2.25-2.4.7-3.5L3 2z" />
        </svg>
      </span>
    </button>
  );
}
