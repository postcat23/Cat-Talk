import { OVERLAY_HEIGHT, useUi, type ChatHeight, type Settings, type Side, type Theme } from '../state/UiContext';
import { useChat } from '../hooks/useChatView';
import { useChest } from '../hooks/useAutoChest';
import { useUpdate, type UpdateState } from '../hooks/useAppUpdate';
import { STATE_LABEL } from '../chat/autoChest';
import Cat from './Cat';
import styles from './Drawer.module.css';

// 앱 버전은 main의 app.getVersion()(package.json의 version)이다. 브라우저 dev에는 Electron이 없어 표시하지 않는다.
const APP_VERSION = window.catTalk?.version ? `v${window.catTalk.version}` : null;
// 배지는 확인 결과가 있을 때만: '최신'(새 버전 없음)·'업데이트 가능'(내려받아 둠). 확인 전·중·실패(비공개 레포 포함)·dev는
// '최신'이라고 단정하지 않고 버전만 보여 준다(D-030).
const UPDATE_BADGE: Partial<Record<UpdateState, string>> = { latest: '최신', ready: '업데이트 가능' };

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
  const { me, accountStatus, saveSettings, sending, hasDraft } = useChat();
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
  // 앱 업데이트(D-030): 내려받아 둔 업데이트를 [업데이트]로 적용(재시작)한다. 보내는 중이면 끝날 때까지 막고,
  // 쓰던 글이 있으면 대화 영역에 확인 카드를 띄우므로 드로어를 닫아 가리지 않게 한다.
  const update = useUpdate();
  const updateReady = update?.state === 'ready';
  const updateBadge = update ? UPDATE_BADGE[update.state] : undefined;
  const startUpdate = () => {
    if (!update || sending) return;
    const draft = hasDraft();
    if (draft) dispatch({ type: 'closeOverlays' });
    update.request(draft);
  };

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
          {updateBadge && <span className={updateReady ? `${styles.ubadge} ${styles.avail}` : styles.ubadge}>{updateBadge}</span>}
          {APP_VERSION && <span className={styles.uver}>{APP_VERSION}</span>}
          {updateReady && <button className={styles.upbtn} disabled={sending} onClick={startUpdate}>업데이트</button>}
        </div>
      </div>
    </aside>
  );
}
