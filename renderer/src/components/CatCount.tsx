import styles from './CatCount.module.css';

// 참여자 버튼: 눈까지만 보이는 고양이 실루엣 + 모자 자리에 인원수.
// 실루엣은 currentColor(=--fg)라 라이트=검정, 다크=흰색으로 테마를 따른다.
export default function CatCount({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button className={styles.catcount} aria-label={`참여자 ${count}명`} onClick={onClick}>
      <span className={styles.n}>{count}</span>
      <span className={styles.face}>
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M4 4.2C4 2.6 5.6 1.9 6.8 2.8L9.4 4.9C10.2 4.6 11.1 4.5 12 4.5s1.8.1 2.6.4l2.6-2.1c1.2-.9 2.8-.2 2.8 1.4 0 1.6-.3 3.1-.9 4.3 1 1.2 1.5 2.6 1.5 4.1 0 4.2-3.8 7.2-9 7.2S3 16.8 3 12.6c0-1.5.5-2.9 1.5-4.1C3.9 7.3 3.6 5.8 4 4.2Z" />
        </svg>
      </span>
    </button>
  );
}
