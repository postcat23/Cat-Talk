import type { ReactionStack as Stack } from '../hooks/useReactionStack';
import { useChat } from '../hooks/useChatView';
import { useChest } from '../hooks/useAutoChest';
import { progressText, reapplyNotice, REINSTALL_NOTICE, RESTORE_NOTICE } from '../chat/autoChest';
import { useUpdate, UPDATE_DRAFT_NOTICE } from '../hooks/useAppUpdate';
import { displayName } from '../chat/model';
import Cat from './Cat';
import NoticeCard from './NoticeCard';
import styles from './ReactionStack.module.css';

const DEV_NOTICE = '앱이 켜져 있는 동안의 대화만 보관하고, 종료하면 지웁니다.';
// 야옹 반응은 게임이 보낸 원문(언어별, 예: '야옹 야옹')을 그대로 쓴다. 없을 때만 한국어 원문
const MEOW_FALLBACK = '야옹 야옹';
const DEV_NOTICE_MS = 10000;   // 최초 1회
const TOAST_MS = 4000;         // upstream 토스트와 같은 시간

// 대화 영역 위에 뜨는 카드 스택: 안내 카드(항상 맨 위) + 반응 카드(최신이 위).
// key로 문구·회차가 바뀌면 카드를 새로 만들어, 닫았던 안내도 새 상태면 다시 보이게 한다.
export default function ReactionStack({ stack }: { stack: Stack }) {
  const { byId, notice, toast, sending, nicknames } = useChat();
  const chest = useChest();
  const update = useUpdate();
  const install = chest?.progress;
  return (
    <div className={styles.stack}>
      {/* 상자 자동 오픈·투명화 설치 진행. 카운트다운 동안만 취소 가능(이후 단계는 게임 파일을 다룬다) */}
      {install && <NoticeCard key={install.phase} text={progressText(install)}
        action={install.phase === 'countdown' ? { label: '취소', onClick: () => chest?.cancel() } : undefined} />}
      {/* 설정 ON + 패치 소실: [재시작]이 곧 확인이라 카운트다운 없이 재적용, [X]는 켜진 설정을 모두 끈다 */}
      {chest?.needsReapply && !install && <NoticeCard key="reapply" text={reapplyNotice(chest.wanted)}
        action={{ label: '재적용', onClick: () => void chest.reapply() }} onClose={() => void chest.dismissReapply()} />}
      {/* 설치 도구 불일치 + 설정 ON: 재적용으로는 못 고쳐 재설치 안내만. [X]는 이번 실행 동안 숨김(D-029) */}
      {chest?.needsReinstall && !install && <NoticeCard key="reinstall" text={REINSTALL_NOTICE} onClose={chest.dismissReinstall} />}
      {/* 재적용과 대칭(D-038): 패치는 남았는데 패치를 쓰는 기능이 없음. [원본 복원]은 게임이 켜져 있으면 카운트다운(취소 가능) 뒤
          종료·복원·재실행, [X]는 이 상태가 이어지는 동안 이번 실행에서 숨김 */}
      {chest?.needsRestore && !install && <NoticeCard key="restore" text={RESTORE_NOTICE}
        action={{ label: '원본 복원', onClick: () => void chest.restore() }} onClose={chest.dismissRestore} />}
      {/* 앱 업데이트 재시작 전 확인(D-030): 쓰던 글은 앱을 끄면 사라진다. 보내는 중이면 끝날 때까지 적용하지 않는다 */}
      {update?.confirming && <NoticeCard key="update-confirm" text={UPDATE_DRAFT_NOTICE}
        action={{ label: '업데이트', onClick: () => { if (!sending) update.confirm(); } }} onClose={update.cancel} />}
      {toast && <NoticeCard key={toast.id} text={toast.text} showMs={TOAST_MS} />}
      {notice && <NoticeCard key={notice} text={notice} />}
      <NoticeCard text={DEV_NOTICE} showMs={DEV_NOTICE_MS} />
      {stack.cards.map((c) => {
        const p = byId(c.sender);
        const avatar = c.avatar ?? p?.avatar;
        return (
          <div key={c.id} className={[styles.card, styles.reaction, c.leaving && styles.leaving].filter(Boolean).join(' ')}>
            <span className={avatar ? `${styles.rcat} ${styles.stand}` : styles.rcat}><Cat src={avatar} framing="sprite" /></span>
            <span className={styles.rtxt}>
              {/* 참여자 이름은 닉네임 덮어쓰기가 반영돼 있다(D-032). 목록에 없는 발신자도 닉네임이 있으면 그 이름 */}
              <b>{p?.name ?? displayName(c.sender, c.sender, nicknames)}</b>
              {c.kind === 'meow' ? <span className={styles.act}>{c.content || MEOW_FALLBACK}</span> : c.content && <span className={styles.act}>{c.content}</span>}
            </span>
            {c.kind === 'emote' && c.image && <img className={styles.emote} src={c.image} alt="" draggable={false} />}
            {c.n > 1 && <span className={styles.mul}>×{c.n}</span>}
          </div>
        );
      })}
    </div>
  );
}
