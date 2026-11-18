import { useChat, type PlaylistCard as Card } from '../hooks/useChatView';
import { useVideoTitle } from '../hooks/useVideoTitle';
import { displayName } from '../chat/model';
import { openVideos, PL_OPEN_FAILED } from '../chat/playlist';
import NoticeCard from './NoticeCard';

// 플리(D-053) 상단 카드: 🎵 + '{닉}님이 {제목}을 추가했습니다'(추가 알림, 로비 전원) 또는 🎵 + 제목(랜덤, 본인만) + [재생].
// 기존 안내 카드 모양을 쓴다. 제목은 받은 쪽이 조회하고, 그 전에는 짧은 링크(youtu.be/ID)를 보인다. 5초 뒤 useChatView가 뺀다
export default function PlaylistCard({ card }: { card: Card }) {
  const { byId, nicknames, notify } = useChat();
  const title = useVideoTitle(card.video);
  const name = card.by ? byId(card.by)?.name ?? displayName(card.by, '이름 확인 중', nicknames) : '';
  const text = card.kind === 'added' ? `${name}님이 ${title}을 추가했습니다` : title;
  const play = () => void openVideos([card.video]).then((ok) => { if (!ok) notify(PL_OPEN_FAILED); });
  return <NoticeCard icon="🎵" text={text} action={{ label: '재생', onClick: play }} />;
}
