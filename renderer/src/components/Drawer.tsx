import { useState } from 'react';
import { OVERLAY_HEIGHT, useUi, type ChatHeight, type Settings, type Side, type Theme } from '../state/UiContext';
import { useChat } from '../hooks/useChatView';
import { useChest } from '../hooks/useAutoChest';
import { STATE_LABEL } from '../chat/autoChest';
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
  { key: 'taskbarAlert', label: '작업 표시줄 알림' },
  { key: 'toastAlert', label: '팝업 알림' },
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

function Switch({ on, label, onToggle, disabled }: { on: boolean; label: string; onToggle: () => void; disabled?: boolean }) {
  return <button className={on ? `${styles.sw} ${styles.on}` : styles.sw} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onToggle} />;
}

export default function Drawer() {
  const { settings, overlays, dispatch } = useUi();
  const { me, accountStatus, saveSettings } = useChat();
  const apply = (patch: Partial<Settings>) => dispatch({ type: 'setSettings', patch });
  const set = (patch: Partial<Settings>) => { apply(patch); saveSettings(patch); };
  const chest = useChest();
  // Electron: 실제 상태(패치+플래그)가 버튼을 정한다. 브라우저 dev: 설정값만.
  const chestOn = chest ? chest.state === 'on' : settings.autoOpenChest;
  const chestBusy = !!chest && (chest.busy || chest.state === 'installing');
  // 끄기(플래그 삭제)는 호환 안 됨·게임 없음·설치 도구 불일치에서도 안전하므로 진행 중일 때만 막는다
  const enableBlocked = chestBusy || chest?.state === 'incompatible' || chest?.state === 'no_game' || chest?.state === 'patcher_mismatch';
  const turnChest = async (on: boolean) => {
    if (!chest) { set({ autoOpenChest: on }); return; }
    const result = await (on ? chest.enable('chest') : chest.disable('chest'));
    if (result.ok) set({ autoOpenChest: on });
  };
  // 모든 고양이 투명화: 게임 패치를 상자 자동 오픈과 함께 쓴다(설치돼 있으면 즉시, 아니면 같은 설치 흐름). 앱 안 고양이 표시도 이 설정을 따른다.
  const clearOn = chest ? chest.transparent === 'on' : settings.clearCats;
  const turnClear = async (on: boolean) => {
    if (!chest) { set({ clearCats: on }); return; }
    const result = await (on ? chest.enable('transparent') : chest.disable('transparent'));
    if (result.ok) set({ clearCats: on });
  };
  // 업데이트 확인·적용은 후속 단계. 지금은 목업처럼 버튼을 누르면 '최신'으로 돌아가는 것만.
  const [updateAvailable, setUpdateAvailable] = useState(UPDATE_AVAILABLE);

  return (
    <aside className={['thin-scroll', styles.drawer, overlays.drawerOpen && styles.show, OVERLAY_HEIGHT[settings.height] === '100%' && styles.full].filter(Boolean).join(' ')} aria-label="메뉴">
      {/* 헤더 한 줄: 유저 프로필 … 닫기. 실아바타는 배경 없이 아래 구분선 위에 서 있다 */}
      <div className={me?.avatar ? `${styles.dhead} ${styles.standing}` : styles.dhead}>
        <div className={styles.acct}>
          <span className={me?.avatar ? `${styles.av} ${styles.stand}` : styles.av}><Cat src={me?.avatar} framing="sprite" /></span>
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
          {key === 'clearCats'
            ? <Switch on={clearOn} label={label} disabled={clearOn ? chestBusy : enableBlocked} onToggle={() => void turnClear(!clearOn)} />
            : <Switch on={settings[key]} label={label} onToggle={() => set({ [key]: !settings[key] })} />}
        </div>
      ))}
      {/* 구분선은 프로필↔설정, 설정 영역↔앱 업데이트 2개뿐. 상자 카드는 자체 배경이 구분 역할.
          켜기 = 설치돼 있으면 플래그만, 아니면 카운트다운 후 설치(재적용 포함), 끄기 = 플래그 삭제(D-019) */}
      <div className={styles.chest}>
        <span className={styles.cicon}>📦</span>
        <span className={styles.ctitle}>
          상자 자동 오픈
          {chest?.state && <span className={styles.cstate}>{STATE_LABEL[chest.state]}</span>}
        </span>
        <div className={styles.cbtns}>
          <button className={chestOn ? `${styles.cbtn} ${styles.active}` : styles.cbtn} aria-pressed={chestOn} disabled={enableBlocked}
            onClick={() => void turnChest(true)}>켜기</button>
          <button className={chestOn ? styles.cbtn : `${styles.cbtn} ${styles.active}`} aria-pressed={!chestOn} disabled={chestBusy}
            onClick={() => void turnChest(false)}>끄기</button>
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
