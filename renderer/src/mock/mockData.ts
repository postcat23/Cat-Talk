// 목업(.sw/cat-talk-mock.html) 샘플과 동일한 목데이터. 2e-2c에서 view 응답으로 교체.

export interface Participant {
  id: string;
  name: string;
  color: string;   // 아바타 배경
  hat: string;     // 고양이 모자(이모지 임시 표시). 없으면 ''
}

export type ConnState = 'good' | 'off' | 'nolobby';

export interface ChatMessage {
  kind: 'msg';
  id: string;
  sender: string;  // participant id
  text: string;
  time: string;    // HH:MM
  status?: string; // 내 메시지 전송 상태
}

export interface PresenceItem {
  kind: 'presence';
  id: string;
  text: string;
}

export type ChatItem = ChatMessage | PresenceItem;

export const PARTICIPANTS: Participant[] = [
  { id: 'p1', name: '미소미소된장국', color: '#f2c0a0', hat: '🎩' },
  { id: 'p2', name: 'RATOY', color: '#ffe08a', hat: '🧢' },
  { id: 'p3', name: 'FwanTaStic K', color: '#b7e0ff', hat: '👑' },
  { id: 'p4', name: '리버', color: '#ffc2d1', hat: '🎀' },
  { id: 'p5', name: '리네', color: '#d8c0ff', hat: '🍃' },
  { id: 'p6', name: 'Comedian', color: '#c8f0c8', hat: '🤡' },
  { id: 'p7', name: 'CUBE', color: '#cfd6ff', hat: '' },
  { id: 'p8', name: 'ConE', color: '#ffd27d', hat: '🧙' },
  { id: 'p9', name: '자깡', color: '#b7e0ff', hat: '🐟' },
  { id: 'p10', name: 'Borizaru', color: '#ffd0b0', hat: '' },
  { id: 'p11', name: '넙치', color: '#cfe', hat: '🧢' },
  { id: 'p12', name: '모리', color: '#fcd', hat: '' },
];

export const ME_ID = 'p8';
export const ROOM_NAME = 'alt + F4';
export const CONNECTION: ConnState = 'good';
export const CONN_LABEL: Record<ConnState, string> = { good: '연결', off: '연결 안 됨', nolobby: '로비 없음' };

export const INITIAL_ITEMS: ChatItem[] = [
  { kind: 'presence', id: 'i1', text: '리버님이 들어왔습니다.' },
  { kind: 'msg', id: 'i2', sender: 'p4', text: '다들 아직 있음?', time: '09:36' },
  { kind: 'msg', id: 'i3', sender: 'p8', text: '다른 모니터 절대 사수해야 함…', time: '09:37', status: '전송됨' },
  { kind: 'msg', id: 'i4', sender: 'p9', text: '리버님 붕고 없으니까 끝으로 가세요', time: '09:38' },
  { kind: 'msg', id: 'i5', sender: 'p9', text: 'ㅋㅋㅋㅋㅋㅋㅋㅋㅋ', time: '09:38' },
  { kind: 'msg', id: 'i6', sender: 'p4', text: '뢱?', time: '09:38' },
];

export const participantById = (id: string) => PARTICIPANTS.find((p) => p.id === id);
