import { useUi } from '../state/UiContext';
import styles from './CollapseTab.module.css';

export default function CollapseTab() {
  const { settings, overlays, dispatch } = useUi();
  return (
    <button
      className={`${styles.tab} ${styles[settings.side]}`}
      aria-label="채팅 열기/닫기"
      onClick={() => dispatch({ type: 'toggleCollapsed' })}
    >
      <span>{overlays.collapsed ? 'OPEN' : 'CLOSE'}</span>
    </button>
  );
}
