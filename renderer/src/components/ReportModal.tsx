import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useUi, type ReportKind } from '../state/UiContext';
import { useChat } from '../hooks/useChatView';
import styles from './ReportModal.module.css';

// main(electron/report.js)과 같은 상한: 제목은 Discord 스레드 이름 상한, 내용은 메시지 상한(2000)에서 메타데이터 몫을 뺀 값
const TITLE_MAX = 100;
const BODY_MAX = 1800;
const cap = (v: string, max: number) => [...v].slice(0, max).join('');
const LABEL: Record<ReportKind, string> = { bug: '버그 신고', request: '요청 사항' };
const FAILED: Record<string, string> = {
  unavailable: '이 빌드에는 신고 기능이 설정되어 있지 않습니다.',
  rate_limited: '잠시 후 다시 시도해 주세요.',
  invalid: '제목과 내용을 확인해 주세요.',
};
const kb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`);

// 버그 신고·요청 사항(D-050): 앱 가운데 모달. [등록]은 main이 Discord 포럼 웹훅으로 스레드를 만든다.
// 버그 신고는 진단 로그(식별자를 지운 것)를 첨부하고, 보내기 전에 무엇이 첨부되는지 목록과 [내용 보기]로 확인할 수 있다.
export default function ReportModal() {
  const { overlays } = useUi();
  const kind = overlays.reportKind;
  return kind && window.catTalk ? <ReportDialog key={kind} kind={kind} /> : null;
}

function ReportDialog({ kind }: { kind: ReportKind }) {
  const { dispatch } = useUi();
  const { conn, notify } = useChat();
  const api = window.catTalk!.report;
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [attach, setAttach] = useState<{ parts: { name: string; bytes: number }[]; name: string; bytes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const downOnBackdrop = useRef(false);
  const close = () => { if (!busy) dispatch({ type: 'closeReport' }); };

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { if (kind === 'bug') void api.preview().then(setAttach).catch(() => setAttach(null)); }, [api, kind]);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !busy) dispatch({ type: 'closeReport' }); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dispatch, busy]);

  const ready = title.trim() !== '' && body.trim() !== '' && !busy;
  const submit = async () => {
    if (!ready) return;
    setBusy(true); setError('');
    const result = await api.submit({ kind, title: title.trim(), body: body.trim(), conn }).catch(() => ({ ok: false, reason: 'network' }));
    setBusy(false);
    if (result.ok) { dispatch({ type: 'closeReport' }); notify(`${LABEL[kind]}를 등록했습니다.`); }
    else setError(FAILED[result.reason ?? ''] ?? '등록하지 못했습니다. 인터넷 연결을 확인해 주세요.');
  };
  const onBackdropClick = (e: MouseEvent<HTMLDivElement>) => { if (downOnBackdrop.current && e.target === e.currentTarget) close(); };

  return (
    <div className={styles.backdrop} onPointerDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }} onClick={onBackdropClick}>
      <div className={styles.card} role="dialog" aria-modal="true" aria-labelledby="report-title">
        <h2 id="report-title">{LABEL[kind]}</h2>
        <input ref={input} value={title} placeholder="제목" aria-label="제목" autoComplete="off" disabled={busy}
          onChange={(e) => setTitle(cap(e.target.value, TITLE_MAX))} />
        <textarea value={body} placeholder={kind === 'bug' ? '어떤 상황에서 무엇이 잘못됐는지 적어 주세요' : '원하는 기능이나 바뀌었으면 하는 점을 적어 주세요'}
          aria-label="내용" disabled={busy} onChange={(e) => setBody(cap(e.target.value, BODY_MAX))} />
        <div className={styles.count}>{[...body].length}/{BODY_MAX}</div>
        {kind === 'bug' && (
          <div className={styles.attach}>
            <div className={styles.arow}>
              <span>첨부: {attach ? `${attach.name} (${kb(attach.bytes)})` : '로그 확인 중…'}</span>
              <button type="button" disabled={!attach} onClick={() => void api.openPreview()}>내용 보기</button>
            </div>
            <div className={styles.note}>앱 진단 로그를 함께 보냅니다. Steam ID·사용자 폴더·사용자 이름은 지운 뒤 보냅니다.</div>
          </div>
        )}
        <div className={styles.note}>등록하면 개발자 Discord 포럼에 공개 글로 올라갑니다. 앱 버전·Windows 버전·연결 상태가 함께 적힙니다.</div>
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.actions}>
          <span className={styles.spacer} />
          <button type="button" onClick={close} disabled={busy}>취소</button>
          <button type="button" className={styles.save} onClick={() => void submit()} disabled={!ready}>{busy ? '등록 중…' : '등록'}</button>
        </div>
      </div>
    </div>
  );
}
