import { useId, type CSSProperties } from 'react';
import { useChat } from '../hooks/useChatView';
import { useHeldPlayback, usePageVisible } from '../hooks/useHeldPlayback';
import { useUi } from '../state/UiContext';
import Cat from './Cat';
import { PRAISE_STAR } from './PraiseStar';
import styles from './PraiseStamp.module.css';

// PraiseStamp.module.css 애니메이션 전체 길이(등장 → 도장 쾅 → 별 셋 → 사라짐)와 같게. 공개수배 전단과 같은 길이
const DURATION_MS = 4600;
// 도장 무늬(viewBox 300, 가운데 150). 글자 기준선 반지름(위쪽 호) — 글자 윗부분이 안쪽 고리 바로 안에 닿는다
const C = 150;
const TEXT_R = 92;
// 아래쪽 호의 별 셋: 가운데 반지름·크기, 각도(화면 기준 시계 방향, 90° = 정중앙 아래)와 나타나는 시각(at, 초).
// 별 꼭짓점은 도장 가운데를 향한다(회전 = 각도 - 90°) — 가운데 별은 똑바로, 양옆은 호를 따라 기운다.
// 크기 37 = 흰 윤곽을 뺀 만큼 키운 값(사용자 피드백 2026-11-20 — 윤곽이 있던 34의 바깥 크기와 같다).
// 별 애니메이션은 처음 버전(0.15초 간격으로 튀어나와 1.4초 주기로 반짝임)으로 되돌렸다(사용자 결정 2026-11-20 — 맥동 강화·순차·스프링
// 등 여러 안을 시험한 뒤 '완전 초기 버전, 별 크기만 현재 유지'). 이어서 '간격만 살짝 더 벌리고 확대/축소 갭 키우기'로 간격 ±26° → ±29°
// (반지름 100, 중심 거리 45 → 50), 반짝임 1.12배 → 1.25배(PraiseStamp.module.css twinkle)
const STAR_R = 100;
const STAR_SIZE = 37;
const STARS = [{ deg: 119, at: 1.2 }, { deg: 90, at: 1.35 }, { deg: 61, at: 1.5 }];
// 칭찬 별(PraiseStar)과 같은 별 모양. 모양 가운데가 (12, 11.35), 폭 약 20
const STAR_PATH = 'M12 2.6l2.83 5.74 6.33.92-4.58 4.47 1.08 6.3L12 17.04l-5.66 2.98 1.08-6.3L2.84 9.26l6.33-.92z';

// 도장 무늬(사용자 명세 2026-11-20 — 사용자 제공 도장 이미지 참고): 원형 테두리(굵은 바깥 고리·얇은 안쪽 고리), 위쪽 곡선
// '참잘했어요', 아래쪽 곡선 별 셋. 가운데는 비워 두고 아바타를 그 자리에 겹친다. 색은 칭찬 별(PRAISE_STAR)과 같고 흰 띠·흰 윤곽은
// 두지 않는다(사용자 피드백). 인라인 SVG라 글자는 앱 글꼴(Pretendard)로 그린다.
function Seal() {
  const arc = `praise-arc-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg className={styles.seal} viewBox="0 0 300 300" aria-hidden="true">
      <defs><path id={arc} d={`M ${C - TEXT_R} ${C} A ${TEXT_R} ${TEXT_R} 0 0 1 ${C + TEXT_R} ${C}`} /></defs>
      <circle cx={C} cy={C} r={141} fill="none" stroke={PRAISE_STAR} strokeWidth={8} />
      <circle cx={C} cy={C} r={129} fill="none" stroke={PRAISE_STAR} strokeWidth={4} />
      <text className={styles.sealText} fill={PRAISE_STAR} textAnchor="middle">
        <textPath href={`#${arc}`} startOffset="50%">참잘했어요</textPath>
      </text>
      {STARS.map((s) => {
        const rad = (s.deg * Math.PI) / 180;
        return (
          <g key={s.deg} transform={`translate(${C + STAR_R * Math.cos(rad)} ${C + STAR_R * Math.sin(rad)}) rotate(${s.deg - 90})`}>
            <g className={styles.sealStar} style={{ '--at': `${s.at}s` } as CSSProperties}>
              <path d={STAR_PATH} transform={`scale(${STAR_SIZE / 20}) translate(-12 -11.35)`} fill={PRAISE_STAR} />
            </g>
          </g>
        );
      })}
    </svg>
  );
}

// 칭찬 도장(1.0.9, 사용자 명세 — 공개수배의 거울): 칭찬 총횟수가 3에 닿은 대상의 아바타를 가운데에 담은 도장을 찍는다
// (2026-11-20 사용자 명세: 아바타 위에 도장 이미지를 찍는 대신 아바타가 도장에 포함되게, 아바타도 도장을 찍을 때 같이 나타나게).
// 테두리·글자·아바타·후광이 한 덩어리로 날아와 쾅 찍힌 뒤 아래쪽 별 셋이 차례로 나온다. 이름은 그리지 않는다(아바타만).
// 클릭은 아래로 통과한다.
// 로비의 Cat Talk 사용자마다 같은 발동을 각자 화면에 한 번 띄운다(대상 본인 포함). 대상이 목록에 없으면 넘기고, 여러 건이면 차례대로
// (같은 대상은 useChatView가 10초 묶는다). 화면이 가려진 동안은 보류(1분) — 보류·재생 판정은 공개수배와 같다(hooks/useHeldPlayback).
// 공개수배 전단이 떠 있거나 기다리는 동안도 가려진 것처럼 미룬다(둘이 겹치지 않게 — 전단 먼저, 결정 2026-11-19).
// 플레이 > 칭찬이 꺼져 있으면 useChatView가 대기열을 비워 두므로 여기 올 것이 없다.
export default function PraiseStamp() {
  const { praised, wanted, byId, dismissPraised } = useChat();
  const { overlays } = useUi();
  const visible = usePageVisible();
  const hidden = overlays.collapsed || overlays.drawerOpen || overlays.modalOpen || !visible || !!wanted;
  const target = praised ? byId(praised.target) : undefined;
  const playing = useHeldPlayback(praised, !!target, hidden, dismissPraised, DURATION_MS);
  if (!praised || !target || hidden || playing !== praised.id) return null;
  return (
    <div key={praised.id} className={styles.stage} role="img" aria-label={`${target.name}님 칭찬 도장`}>
      <div className={styles.scene}>
        <span className={styles.impact} />
        <div className={styles.stamp}>
          <div className={styles.avatar}><Cat src={target.avatar} framing="sprite" /></div>
          <Seal />
        </div>
      </div>
    </div>
  );
}
