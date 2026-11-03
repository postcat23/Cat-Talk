// 스텁: 600ms마다 view 폴링 → 라운드트립(렌더러->main->python->main->렌더러) 증명.
let count = 0;
async function rpc(action, args) {
  const raw = await window.bridge.request(JSON.stringify(Object.assign({ action: action }, args || {})));
  const result = JSON.parse(raw);
  if (result.error) throw new Error(result.error);
  return result;
}
async function refresh() {
  try {
    const v = await rpc('view', {});
    count += 1;
    const s = document.getElementById('status');
    s.textContent = '연결됨 (python 사이드카 응답)'; s.className = 'ok';
    document.getElementById('count').textContent = String(count);
    document.getElementById('rev').textContent = String(v.revision);
    document.getElementById('dump').textContent = JSON.stringify(v, null, 2);
  } catch (e) {
    const s = document.getElementById('status');
    s.textContent = '실패: ' + e.message; s.className = 'bad';
  }
}
refresh();
setInterval(refresh, 600);   // 원본 렌더러의 600ms view 폴링 보존
