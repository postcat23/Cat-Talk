import { useEffect, useState } from 'react';
import { OVERLAY_HEIGHT, useUi, type PlaylistMode } from '../state/UiContext';
import { useChat } from '../hooks/useChatView';
import { useVideoTitle } from '../hooks/useVideoTitle';
import { openVideos, PL_EMPTY, PL_MINE_EMPTY, PL_OPEN_FAILED } from '../chat/playlist';
import base from './ParticipantModal.module.css';
import styles from './PlaylistModal.module.css';

// 플리(D-053) 모달: 참여자 모달과 같은 자리·모양(위에서 내려오고 스크림·×로 닫힘).
// 목록(/플리 목록) = 로비 전체 곡(등록순, 차단 제외) — 곡마다 [재생](단일), 위쪽 [연속재생](전체를 등록순 임시 재생목록으로).
// 삭제(/플리 삭제) = 내가 넣은 곡만 — 곡마다 [삭제](내 cattalk.pl에서 빼면 로비 목록에서도 빠진다).
// 제목은 각 행이 조회하고, 그 전에는 짧은 링크(youtu.be/ID)를 보인다
const TITLE: Record<PlaylistMode, string> = { list: '플레이리스트', delete: '내가 등록한 곡' };

function Row({ index, id, mode, busy, onPlay, onDelete }: {
  index: number; id: string; mode: PlaylistMode; busy: boolean; onPlay(id: string): void; onDelete(id: string): void;
}) {
  const title = useVideoTitle(id);
  return (
    <div className={`${base.prow} ${styles.row}`}>
      <span className={styles.num}>{index + 1}</span>
      <span className={styles.title} title={title}>{title}</span>
      {mode === 'list'
        ? <button className={`${styles.btn} ${styles.accent}`} onClick={() => onPlay(id)}>재생</button>
        : <button className={`${styles.btn} ${styles.danger}`} disabled={busy} onClick={() => onDelete(id)}>삭제</button>}
    </div>
  );
}

export default function PlaylistModal() {
  const { settings, overlays, dispatch } = useUi();
  const { playlist, playlistMine, playlistRemove, notify } = useChat();
  const open = overlays.playlist;
  // 닫히는 동안(슬라이드)에도 마지막 내용을 보여 준다
  const [mode, setMode] = useState<PlaylistMode>('list');
  useEffect(() => { if (open) setMode(open); }, [open]);
  const [busy, setBusy] = useState<string | null>(null);   // 삭제를 보낸 곡(응답 전 같은 버튼을 다시 누르지 않게)
  const ids = mode === 'list' ? playlist.map((e) => e.id) : playlistMine;

  const play = (list: string[]) => void openVideos(list).then((ok) => { if (!ok) notify(PL_OPEN_FAILED); });
  const remove = async (id: string) => {
    setBusy(id);
    await playlistRemove(id);
    setBusy(null);
  };

  return (
    <div className={[base.modal, open && base.show, OVERLAY_HEIGHT[settings.height] === '100%' && base.full].filter(Boolean).join(' ')}
      aria-label={TITLE[mode]} aria-hidden={!open}>
      <div className={`${base.mhead} ${styles.head}`}>
        <h2><span aria-hidden="true">🎵</span>{TITLE[mode]}<span className={styles.count}>{ids.length}</span></h2>
        {mode === 'list' && ids.length > 0 && <button className={`${styles.btn} ${styles.accent} ${styles.all}`} onClick={() => play(ids)}>연속재생</button>}
        <button className={`${base.close} ${styles.close}`} aria-label="닫기" onClick={() => dispatch({ type: 'closeOverlays' })}>×</button>
      </div>
      <div className={`${base.mlist} thin-scroll`}>
        {ids.length === 0
          ? <p className={styles.empty}>{mode === 'list' ? PL_EMPTY : PL_MINE_EMPTY}</p>
          : ids.map((id, i) => <Row key={id} index={i} id={id} mode={mode} busy={busy === id} onPlay={(v) => play([v])} onDelete={(v) => void remove(v)} />)}
      </div>
    </div>
  );
}
