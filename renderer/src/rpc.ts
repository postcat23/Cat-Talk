// payload는 {action, ...args} JSON 문자열, 응답도 JSON 문자열(docs/ipc-contract.md).
export async function rpc<T = Record<string, unknown>>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  const raw = await window.bridge.request(JSON.stringify({ action, ...args }));
  const result = JSON.parse(raw);
  if (result.error) throw new Error(result.error);
  return result as T;
}
