import styles from './YellowCards.module.css';

// 경고 총횟수(D-052)만큼 이름 뒤에 붙는 옐로카드(축구 옐로카드 모양의 노란 직사각형, 사용자 결정). 0이면 그리지 않는다.
// 3이 되면 공개수배되고 0으로 돌아가므로 보통 1~2장이다.
export default function YellowCards({ count }: { count: number }) {
  if (!(count > 0)) return null;
  return (
    <span className={styles.cards} role="img" aria-label={`경고 ${count}회`} title={`경고 ${count}회`}>
      {Array.from({ length: count }, (_, i) => <span key={i} className={styles.card} />)}
    </span>
  );
}
