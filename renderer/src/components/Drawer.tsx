import { useState } from 'react';
import { OVERLAY_HEIGHT, useUi, type ChatHeight, type Settings, type Side, type Theme } from '../state/UiContext';
import { useChat } from '../hooks/useChatView';
import Cat from './Cat';
import styles from './Drawer.module.css';

// 앱 업데이트 연결은 후속 단계(electron-updater). 그때까지 표시용 고정값.
const APP_VERSION = 'v1.0.0';
const UPDATE_AVAILABLE = false;

type Option<T> = { value: T; label: string };

const THEMES: Option<Theme>[] = [{ value: 'light', label: '라이트' }, { value: 'dark', label: '다크' }, { value: 'system', label: '시스템' }];
const SIDES: Option<Side>[] = [{ value: 'left', label: '왼쪽' }, { value: 'right', label: '오른쪽' }];
const HEIGHTS: Option<ChatHeight>[] = [{ value: '100%', label: '100%' }, { value: '70%', label: '70%' }, { value: '50%', label: '50%' }];

type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];
const SWITCHES: { key: BoolKey; label: string }[] = [
  { key: 'taskbarAlert', label: '작업표시줄 알림' },
  { key: 'toastAlert', label: '토스트 알림' },
  { key: 'catInteraction', label: '고양이 상호작용 표시' },
  { key: 'presence', label: '입퇴장 문구 표시' },
  { key: 'clearCats', label: '모든 고양이 투명화' },
  { key: 'hideTaskbarIcon', label: '작업 표시줄에서 아이콘 숨기기' },
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

function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return <button className={on ? `${styles.sw} ${styles.on}` : styles.sw} role="switch" aria-checked={on} aria-label={label} onClick={onToggle} />;
}

export default function Drawer() {
  const { settings, overlays, dispatch } = useUi();
  const { me, accountStatus, saveSettings } = useChat();
  const apply = (patch: Partial<Settings>) => dispatch({ type: 'setSettings', patch });
  const set = (patch: Partial<Settings>) => { apply(patch); saveSettings(patch); };
  // 업데이트 확인·적용은 후속 단계. 지금은 목업처럼 버튼을 누르면 '최신'으로 돌아가는 것만.
  const [updateAvailable, setUpdateAvailable] = useState(UPDATE_AVAILABLE);

  return (
    <aside className={[styles.drawer, overlays.drawerOpen && styles.show, OVERLAY_HEIGHT[settings.height] === '100%' && styles.full].filter(Boolean).join(' ')} aria-label="메뉴">
      {/* 헤더 한 줄: 유저 프로필 … 닫기 */}
      <div className={styles.dhead}>
        <div className={styles.acct}>
          <span className={styles.av} style={{ background: me?.color }}><Cat /></span>
          <div><strong>{me?.name ?? '계정 확인 중'}</strong><div className={styles.sub}>{accountStatus}</div></div>
        </div>
        <button className={styles.dclose} aria-label="닫기" onClick={() => dispatch({ type: 'closeOverlays' })}>×</button>
      </div>
      <div className={styles.divider} />
      <h3>설정</h3>
      <div className={styles.set}><span>테마</span><Seg options={THEMES} value={settings.theme} onChange={(theme) => set({ theme })} /></div>
      <div className={styles.set}><span>채팅 위치</span><Seg options={SIDES} value={settings.side} onChange={(side) => set({ side })} /></div>
      <div className={styles.set}><span>채팅 높이</span><Seg options={HEIGHTS} value={settings.height} onChange={(height) => set({ height })} /></div>
      <div className={styles.set}>
        <span>채팅 투명도</span>
        <input className={styles.range} type="range" min={20} max={100} value={settings.opacity} aria-label="채팅 투명도"
          onChange={(e) => apply({ opacity: Number(e.target.value) })}
          onPointerUp={() => saveSettings({ opacity: settings.opacity })} onKeyUp={() => saveSettings({ opacity: settings.opacity })} />
      </div>
      {SWITCHES.map(({ key, label }) => (
        <div key={key} className={styles.set}>
          <span>{label}</span>
          <Switch on={settings[key]} label={label} onToggle={() => set({ [key]: !settings[key] })} />
        </div>
      ))}
      <div className={styles.divider} />
      {/* 켜기 = 패치 적용 겸 재동기화(켜져 있어도 다시 눌러 현재 게임 버전에 재적용), 끄기 = 원본 복원.
          TODO: 상자 자동 오픈 적용/복원(IL 패치, 게임 버전 재동기화). 디스크 수정 방식 확정 후.
          게임 디스크 파일 미수정 원칙(D-005)과 충돌 소지 */}
      <div className={styles.chest}>
        <span className={styles.cicon}>📦</span>
        <span className={styles.ctitle}>상자 자동 오픈</span>
        <div className={styles.cbtns}>
          <button className={settings.autoOpenChest ? `${styles.cbtn} ${styles.active}` : styles.cbtn} aria-pressed={settings.autoOpenChest}
            onClick={() => set({ autoOpenChest: true })}>켜기</button>
          <button className={settings.autoOpenChest ? styles.cbtn : `${styles.cbtn} ${styles.active}`} aria-pressed={!settings.autoOpenChest}
            onClick={() => set({ autoOpenChest: false })}>끄기</button>
        </div>
      </div>
      <div className={styles.divider} />
      <div className={styles.update}>
        <div className={styles.uhead}>앱 업데이트</div>
        <div className={styles.urow}>
          <span className={updateAvailable ? `${styles.ubadge} ${styles.avail}` : styles.ubadge}>{updateAvailable ? '업데이트 가능' : '최신'}</span>
          <span className={styles.uver}>{APP_VERSION}</span>
          {updateAvailable && <button className={styles.upbtn} onClick={() => setUpdateAvailable(false)}>업데이트</button>}
        </div>
      </div>
    </aside>
  );
}
