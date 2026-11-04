import { useUi } from '../state/UiContext';
import type { ReactionStack as Stack } from '../hooks/useReactionStack';
import type { ChatItem } from '../mock/mockData';
import ReactionStack from './ReactionStack';
import MessageList from './MessageList';
import Drawer from './Drawer';
import ParticipantModal from './ParticipantModal';
import styles from './Conversation.module.css';

// 대화 영역. 드로어·참여자 모달·스크림은 이 범위 안에만 겹쳐 입력창을 가리지 않는다.
export default function Conversation({ items, reactions }: { items: ChatItem[]; reactions: Stack }) {
  const { overlays, dispatch } = useUi();
  const overlayOpen = overlays.drawerOpen || overlays.modalOpen;
  return (
    <div className={styles.conv}>
      <ReactionStack stack={reactions} />
      <MessageList items={items} />
      <div className={overlayOpen ? `${styles.scrim} ${styles.show}` : styles.scrim} onClick={() => dispatch({ type: 'closeOverlays' })} />
      <Drawer />
      <ParticipantModal />
    </div>
  );
}
