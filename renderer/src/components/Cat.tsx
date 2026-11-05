import { useContentBox } from '../chat/contentBox';
import styles from './Cat.module.css';

// 프로필 틀(모달·반응 카드): 콘텐츠 가로폭을 틀 가로에 맞추고(좌우 잘림 0) 콘텐츠 바닥을 틀 아래에 붙인다.
// 위쪽에 남는 공간은 그대로 둔다. 틀 모양(라운드 사각형)은 부모가 overflow로 자른다.
function Face({ src }: { src: string }) {
  const box = useContentBox(src);
  const w = box.r - box.l;
  return (
    <span className={styles.frame}>
      <img className={styles.face} src={src} alt="" draggable={false}
        style={{ width: `${100 / w}%`, left: `${(-box.l / w) * 100}%`, top: `${(1 - box.b / w) * 100}%` }} />
    </span>
  );
}

// 서 있는 고양이(말풍선 위·드로어 프로필): 박스 = 콘텐츠 bbox(틀·배경 없음).
// 모달과 같은 정규화로 콘텐츠 가로폭을 --sprite-w에 맞추고 높이는 자연비율. 모자가 큰 스킨은 위로 길어진다.
// 박스 바닥 = 그림 바닥이라 부모는 투명 여백 보정 없이 바로 붙인다.
function Sprite({ src }: { src: string }) {
  const box = useContentBox(src);
  const w = box.r - box.l, h = box.b - box.t;
  return (
    <span className={styles.spriteBox} style={{ aspectRatio: `${w / h}` }}>
      <img className={styles.face} src={src} alt="" draggable={false}
        style={{ width: `${100 / w}%`, left: `${(-box.l / w) * 100}%`, top: `${(-box.t / h) * 100}%` }} />
    </span>
  );
}

// 고양이 표시. 실아바타(스킨+모자 합성 256px 정지 PNG)가 있으면 그것을, 없으면 이모지 플레이스홀더.
// framing — full: 스프라이트 전체, face: 프로필 틀(모달·반응), sprite: 콘텐츠 가로폭 고정(말풍선 위·드로어 프로필).
export default function Cat({ src, framing = 'full' }: { src?: string; framing?: 'full' | 'face' | 'sprite' }) {
  if (!src) return <>🐱</>;
  if (framing === 'face') return <Face src={src} />;
  if (framing === 'sprite') return <Sprite src={src} />;
  return <img className={styles.full} src={src} alt="" draggable={false} />;
}
