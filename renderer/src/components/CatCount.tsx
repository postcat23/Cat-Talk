import styles from './CatCount.module.css';

// 참여자 버튼: 고양이 실루엣 + 모자 자리에 인원수.
// 실루엣은 PNG 알파 마스크에 배경 --fg를 칠해 라이트=검정, 다크=흰색으로 테마를 따른다.
export default function CatCount({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button className={styles.catcount} aria-label={`참여자 ${count}명`} onClick={onClick}>
      <span className={styles.n}>{count}</span>
      <span className={styles.face}><span className={styles.sil} aria-hidden="true" /></span>
    </button>
  );
}
