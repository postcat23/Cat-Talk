import { useUi, type ChatHeight, type Settings, type Side, type Theme } from '../state/UiContext';
import { ME_ID, participantById } from '../mock/mockData';
import Cat from './Cat';
import styles from './Drawer.module.css';

type Option<T> = { value: T; label: string };

const THEMES: Option<Theme>[] = [{ value: 'light', label: '라이트' }, { value: 'dark', label: '다크' }, { value: 'system', label: '시스템' }];
const SIDES: Option<Side>[] = [{ value: 'left', label: '왼쪽' }, { value: 'right', label: '오른쪽' }];
const HEIGHTS: Option<ChatHeight>[] = [{ value: '100%', label: '100%' }, { value: '70%', label: '70%' }, { value: '50%', label: '50%' }];

type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];
const SWITCHES: { key: BoolKey; label: string }[] = [
  { key: 'taskbarAlert', label: '작업표시줄 알림' },
  { key: 'toastAlert', label: '토스트 알림' },
  { key: 'catInteraction', label: '고양이 상호작용 표시' },
  { key: 'clearCats', label: '모든 고양이 투명화' },
  { key: 'presence', label: '입퇴장 알림' },
];

function Seg<T extends string>({ options, value, onChange }: { options: Option<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className={styles.seg}>
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? styles.on : undefined} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export default function Drawer() {
  const { settings, overlays, dispatch } = useUi();
  const set = (patch: Partial<Settings>) => dispatch({ type: 'setSettings', patch });
  const me = participantById(ME_ID);

  return (
    <aside className={overlays.drawerOpen ? `${styles.drawer} ${styles.show}` : styles.drawer} aria-label="메뉴">
      <div className={styles.dhead}>
        <div className={styles.brand}><span className={styles.logo} />Cat-Talk</div>
        <button className={styles.dclose} aria-label="닫기" onClick={() => dispatch({ type: 'closeOverlays' })}>×</button>
      </div>
      <div className={styles.divider} />
      <div className={styles.acct}>
        <span className={styles.av} style={{ background: me?.color }}><Cat /></span>
        <div><strong>{me?.name}</strong><div className={styles.sub}>Bongo Cat 연결됨</div></div>
      </div>
      <div className={styles.divider} />
      <h3>설정</h3>
      <div className={styles.set}><span>테마</span><Seg options={THEMES} value={settings.theme} onChange={(theme) => set({ theme })} /></div>
      <div className={styles.set}><span>채팅 위치</span><Seg options={SIDES} value={settings.side} onChange={(side) => set({ side })} /></div>
      <div className={styles.set}><span>채팅 높이</span><Seg options={HEIGHTS} value={settings.height} onChange={(height) => set({ height })} /></div>
      <div className={styles.set}>
        <span>채팅 투명도</span>
        <input className={styles.range} type="range" min={20} max={100} value={settings.opacity} aria-label="채팅 투명도"
          onChange={(e) => set({ opacity: Number(e.target.value) })} />
      </div>
      {SWITCHES.map(({ key, label }) => (
        <div key={key} className={styles.set}>
          <span>{label}</span>
          <button className={settings[key] ? `${styles.sw} ${styles.on}` : styles.sw} role="switch" aria-checked={settings[key]} aria-label={label}
            onClick={() => set({ [key]: !settings[key] })} />
        </div>
      ))}
      <div className={styles.divider} />
      <div className={styles.merge}><span>🔄</span><div><div>아이템 자동 합성</div><div className={styles.sub}>게임 연동 준비 중</div></div></div>
    </aside>
  );
}
