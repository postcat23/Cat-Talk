// 칭찬 별(1.0.8, 사용자 명세): 빨강~분홍 계열로 직접 그린 별 — 노란 기본 이모지 ⭐가 아니다. 이름 뒤 표시(PlayMarks)와
// 칭찬 도장 모션(PraiseStamp)이 같은 별을 쓴다. 테마와 무관하게 같은 색, 얇은 어두운 윤곽으로 라이트 테마에서도 보이게
export const PRAISE_STAR = '#ff4f7b';

export default function PraiseStar({ className }: { className?: string }) {
  return (
    // viewBox는 별 모양(+윤곽) 경계에 맞춘다 — 상자를 꽉 채워 같은 크기의 옐로카드와 무게가 맞게(사용자 피드백: 카드보다 너무 작음)
    <svg className={className} viewBox="2.1 1.9 19.8 18.9" aria-hidden="true">
      <path d="M12 2.6l2.83 5.74 6.33.92-4.58 4.47 1.08 6.3L12 17.04l-5.66 2.98 1.08-6.3L2.84 9.26l6.33-.92z"
        fill={PRAISE_STAR} stroke="rgba(0,0,0,.22)" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
