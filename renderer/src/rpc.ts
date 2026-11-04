// 브라우저 dev는 브리지가 없어 목업이 대신 응답한다. 동적 import라 빌드 산출물에는 목데이터가 들어가지 않는다.
async function resolveBridge() {
  if (window.bridge) return window.bridge;
  if (import.meta.env.DEV) return (await import('./mock/mockBridge')).mockBridge;
  throw new Error('bridge_down');
}

// payload는 {action, ...args} JSON 문자열, 응답도 JSON 문자열(docs/ipc-contract.md).
export async function rpc<T = Record<string, unknown>>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  const bridge = await resolveBridge();
  const raw = await bridge.request(JSON.stringify({ action, ...args }));
  const result = JSON.parse(raw);
  if (result.error) throw new Error(result.error);
  return result as T;
}
