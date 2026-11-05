import { useCallback, useEffect, useRef, useState } from 'react';

export type ReactionKind = 'meow' | 'emote';

export interface ReactionCard {
  id: number;
  sender: string;        // participant id
  kind: ReactionKind;
  content: string;
  avatar?: string;       // 발신자 정지 PNG(반응 시점). 없으면 참여자 아바타·이모지 폴백
  image?: string;        // emote 이미지
  n: number;
  leaving: boolean;
}

export interface ReactionStack {
  cards: ReactionCard[];
  push(sender: string, kind: ReactionKind, content?: string, avatar?: string, image?: string): void;
}

const LIFETIME_MS = 4500;
const FADE_MS = 200;

// 같은 sender+kind+content(+emote 이미지)면 ×N 누적, 다르면 맨 위에 새 카드. 초과분·만료분은 페이드 후 제거.
export function useReactionStack(maxCards: number, enabled: boolean): ReactionStack {
  const [cards, setCards] = useState<ReactionCard[]>([]);
  const live = useRef<ReactionCard[]>([]);   // 페이드 중이 아닌 카드, 최신순
  const timers = useRef(new Map<number, number>());
  const nextId = useRef(1);
  const maxRef = useRef(maxCards);

  const drop = useCallback((id: number) => {
    const i = live.current.findIndex((c) => c.id === id);
    if (i < 0) return;
    live.current.splice(i, 1);
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, leaving: true } : c)));
    window.setTimeout(() => setCards((cs) => cs.filter((c) => c.id !== id)), FADE_MS);
  }, []);

  const arm = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.set(id, window.setTimeout(() => drop(id), LIFETIME_MS));
  }, [drop]);

  const push = useCallback((sender: string, kind: ReactionKind, content = '', avatar?: string, image?: string) => {
    if (!enabled) return;
    const ex = live.current.find((c) => c.sender === sender && c.kind === kind && c.content === content && c.image === image);
    if (ex) {
      const n = ++ex.n;
      setCards((cs) => cs.map((c) => (c.id === ex.id ? { ...c, n } : c)));
      arm(ex.id);
      return;
    }
    const card: ReactionCard = { id: nextId.current++, sender, kind, content, avatar, image, n: 1, leaving: false };
    live.current.unshift({ ...card });
    setCards((cs) => [card, ...cs]);
    if (live.current.length > maxRef.current) drop(live.current[live.current.length - 1].id);
    arm(card.id);
  }, [enabled, arm, drop]);

  // 채팅 높이를 줄이면 최대 개수를 넘는 오래된 카드를 즉시 정리
  useEffect(() => {
    maxRef.current = maxCards;
    while (live.current.length > maxCards) drop(live.current[live.current.length - 1].id);
  }, [maxCards, drop]);

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((id) => clearTimeout(id));
  }, []);

  return { cards, push };
}
