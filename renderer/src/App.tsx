import { useEffect, useState } from 'react';
import { rpc } from './rpc';

const POLL_MS = 600;   // 원본 렌더러의 600ms view 폴링 보존(D-007)

type View = { revision?: unknown } & Record<string, unknown>;
type Status = { ok: boolean; text: string } | null;

// 스텁: 600ms마다 view 폴링 → 라운드트립(렌더러->main->python->main->렌더러) 증명.
export default function App() {
  const [status, setStatus] = useState<Status>(null);
  const [count, setCount] = useState(0);
  const [view, setView] = useState<View | null>(null);

  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const v = await rpc<View>('view');
        if (!alive) return;
        setCount((c) => c + 1);
        setView(v);
        setStatus({ ok: true, text: '연결됨 (python 사이드카 응답)' });
      } catch (e) {
        if (!alive) return;
        setStatus({ ok: false, text: '실패: ' + (e instanceof Error ? e.message : String(e)) });
      }
    }
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  return (
    <>
      <h1>Cat-Talk 스텁 IPC 루프</h1>
      <p>상태: <span className={status ? (status.ok ? 'ok' : 'bad') : ''}>{status ? status.text : '연결 중…'}</span></p>
      <p>view 폴링 횟수: {count} / sidecar revision: {view ? String(view.revision) : '-'}</p>
      <pre>{view ? JSON.stringify(view, null, 2) : ''}</pre>
    </>
  );
}
