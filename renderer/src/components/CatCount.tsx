import Cat from './Cat';
import styles from './CatCount.module.css';

// 참여자 버튼: 눈까지만 보이는 고양이 + 모자 자리에 인원수
export default function CatCount({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button className={styles.catcount} aria-label={`참여자 ${count}명`} onClick={onClick}>
      <span className={styles.n}>{count}</span>
      <span className={styles.face}><span><Cat /></span></span>
    </button>
  );
}
