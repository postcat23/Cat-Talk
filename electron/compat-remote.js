// 호환성 데이터 핫업데이트(②, 1.0.8): 레포 main의 compat/manifest.json(+.sig)을 받아 검증·병합하고 '유효 계약' 파일로 쓴다.
// 사이드카(CATTALK_CONTRACT)와 상자 설치 사전 점검(featureContract)이 이 파일 하나를 본다. 재설치 없이 반영하려고
// 새 매니페스트를 받으면 onChanged(main이 worker를 다시 띄움)를 부른다.
// 받는 시점(사용자 결정 2026-11-19): 앱 시작, 6시간마다, '지원 안 함'(모르는 연결 지문)이면 즉시 + 1·2·4·8·16·30분(이후 30분마다).
// 우선순위: 검증된 새 원격 > 검증된 캐시 > 번들. 원격을 못 받거나 거부하면 지금 쓰는 계약을 그대로 둔다.
const fs = require('fs');
const path = require('path');
const manifest = require('./compat-manifest');

const REGULAR_MS = 6 * 60 * 60 * 1000;
const BACKOFF_MINUTES = [1, 2, 4, 8, 16, 30];
const FETCH_TIMEOUT_MS = 15000;
const SIGNATURE_READ_CAP = 1024;

const fail = (code) => Object.assign(new Error(code), { code });

// 본문을 상한까지만 읽는다(Content-Length가 없어도 넘치면 끊는다)
async function readCapped(res, cap) {
  const length = Number(res.headers && res.headers.get && res.headers.get('content-length'));
  if (length > cap) throw fail('too_large');
  const reader = res.body && res.body.getReader ? res.body.getReader() : null;
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > cap) throw fail('too_large');
    return buf;
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) { reader.cancel().catch(() => {}); throw fail('too_large'); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

// fetch: (url, init) => Promise<Response>(main은 Electron net.fetch — 시스템 프록시를 따른다). timers는 시험용으로 바꿀 수 있다.
function createCompatRemote({ bundledPath, dataDir, fetch, url = manifest.MANIFEST_URL, publicKeyB64 = manifest.PUBLIC_KEY,
  log = () => {}, onChanged = () => {}, timers = { setTimeout, clearTimeout, setInterval, clearInterval } }) {
  const key = manifest.publicKey(publicKeyB64);
  const home = path.join(dataDir, 'compat');
  const cacheDir = path.join(home, manifest.keyId(publicKeyB64));
  const cacheRaw = path.join(cacheDir, 'manifest.json');
  const cacheSig = path.join(cacheDir, 'manifest.json.sig');
  const effectivePath = path.join(home, 'contract.json');
  let cached = null;          // { sequence, raw, parsed } — 마지막으로 받아들인(검증된) 매니페스트
  let effectiveText = null;   // 마지막으로 쓴 유효 계약(같으면 다시 쓰지 않고 worker도 다시 띄우지 않는다)
  let inFlight = null;
  let backoffTimer = null, backoffStep = -1, regularTimer = null;

  const loadBundled = () => JSON.parse(fs.readFileSync(bundledPath, 'utf-8'));

  function writeAtomic(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  }

  // 캐시도 읽을 때마다 서명을 다시 본다(디스크에서 바뀌었거나 짝이 맞지 않으면 버리고 번들로 간다)
  function loadCache() {
    let raw, sig;
    try { raw = fs.readFileSync(cacheRaw); sig = fs.readFileSync(cacheSig); } catch { return null; }
    try {
      const parsed = manifest.verify(raw, sig, key);
      return { sequence: parsed.sequence, raw, parsed };
    } catch (e) {
      log('compat_cache', { result: 'ignored', reason: e.code || 'error' });
      return null;
    }
  }

  // 번들 + (검증된) 원격으로 유효 계약을 쓴다. 병합이 상한을 넘으면 번들만 쓴다.
  function apply(parsed) {
    const bundled = loadBundled();
    let effective = bundled, source = 'bundle';
    if (parsed) {
      try { effective = manifest.merge(bundled, parsed); source = `remote:${parsed.sequence}`; }
      catch (e) { log('compat_effective', { result: 'bundle_only', reason: e.code || 'error' }); }
    }
    const text = `${JSON.stringify(effective, null, 1)}\n`;
    const changed = text !== effectiveText;
    if (changed) { writeAtomic(effectivePath, text); effectiveText = text; }
    return { changed, source };
  }

  // 앱 시작 때 동기로(사이드카를 띄우기 전, 네트워크를 기다리지 않는다). 쓸 계약 파일 경로를 돌려준다.
  // 데이터 폴더에 쓰지 못하면 번들 파일을 그대로 쓴다(원격 반영만 빠진다).
  function prepare() {
    cached = loadCache();
    try {
      const r = apply(cached && cached.parsed);
      log('compat_effective', { source: r.source });
      return effectivePath;
    } catch (e) {
      log('compat_effective', { result: 'bundle_file', reason: e.code || 'error' });
      return bundledPath;
    }
  }

  async function download(target, cap) {
    const ctrl = new AbortController();
    const timer = timers.setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(target, { signal: ctrl.signal, cache: 'no-store' });
      if (res.status === 404) throw fail('not_found');
      if (!res.ok) throw fail(`http_${res.status}`);
      return await readCapped(res, cap);
    } catch (e) {
      if (e && e.code) throw e;
      throw fail(e && e.name === 'AbortError' ? 'timeout' : 'network');
    } finally {
      timers.clearTimeout(timer);
    }
  }

  // 한 번 받아 본다(동시에 둘 돌지 않는다). 결과: accepted | unchanged | rejected | fetch_failed
  function check(trigger) {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      let raw, sig;
      try {
        [raw, sig] = await Promise.all([download(url, manifest.MAX_MANIFEST), download(`${url}.sig`, SIGNATURE_READ_CAP)]);
      } catch (e) {
        log('compat_remote', { trigger, result: 'fetch_failed', reason: e.code || 'error' });
        return 'fetch_failed';
      }
      let parsed;
      try { parsed = manifest.verify(raw, sig, key); } catch (e) {
        // 매니페스트와 .sig를 CDN이 서로 다른 시점 것으로 줄 수도 있다 — 지금 계약을 그대로 두고 다음 확인 때 다시 본다
        log('compat_remote', { trigger, result: 'rejected', reason: e.code || 'error' });
        return 'rejected';
      }
      const verdict = manifest.compareSequence(parsed, raw, cached);
      if (verdict === 'unchanged') { log('compat_remote', { trigger, result: 'unchanged', sequence: parsed.sequence }); return 'unchanged'; }
      if (verdict !== 'newer') {
        log('compat_remote', { trigger, result: 'rejected', reason: verdict, sequence: parsed.sequence });
        return 'rejected';
      }
      try { manifest.merge(loadBundled(), parsed); } catch (e) {
        log('compat_remote', { trigger, result: 'rejected', reason: e.code || 'error', sequence: parsed.sequence });
        return 'rejected';
      }
      try {
        writeAtomic(cacheRaw, raw);
        writeAtomic(cacheSig, sig);
      } catch (e) {
        log('compat_cache', { result: 'write_failed', reason: e.code || 'error' });
      }
      cached = { sequence: parsed.sequence, raw, parsed };
      let r;
      try { r = apply(parsed); } catch (e) {
        log('compat_effective', { result: 'write_failed', reason: e.code || 'error' });
        return 'rejected';
      }
      log('compat_remote', { trigger, result: 'accepted', sequence: parsed.sequence, changed: r.changed,
        ...(parsed.ignored.length ? { ignored: parsed.ignored.slice(0, 16) } : {}) });
      if (r.changed) onChanged();
      return 'accepted';
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  function start() {
    check('start');
    regularTimer = timers.setInterval(() => { check('regular'); }, REGULAR_MS);
    if (regularTimer && regularTimer.unref) regularTimer.unref();
  }

  function stopBackoff() {
    if (backoffTimer) timers.clearTimeout(backoffTimer);
    backoffTimer = null;
    backoffStep = -1;
  }

  // 사이드카가 알린 호환 상태({ unknown: [...] }). 모르는 지문이 있으면 즉시 받고 1·2·4·8·16·30분 뒤마다 다시 받는다.
  // 모르는 지문이 없어지면(새 매니페스트로 복구·게임 복원) 멈춘다. 이미 백오프 중이면 단계를 처음으로 돌리지 않는다.
  function status(report) {
    const unsupported = !!report && Array.isArray(report.unknown) && report.unknown.length > 0;
    if (!unsupported) { stopBackoff(); return; }
    if (backoffStep >= 0) return;
    backoffStep = 0;
    check('unsupported');
    const next = () => {
      const minutes = BACKOFF_MINUTES[Math.min(backoffStep, BACKOFF_MINUTES.length - 1)];
      backoffTimer = timers.setTimeout(async () => {
        backoffTimer = null;
        if (backoffStep < 0) return;
        backoffStep += 1;
        await check('backoff');
        if (backoffStep >= 0 && !backoffTimer) next();
      }, minutes * 60 * 1000);
    };
    next();
  }

  function stop() {
    stopBackoff();
    if (regularTimer) timers.clearInterval(regularTimer);
    regularTimer = null;
  }

  return { prepare, start, check, status, stop, effectivePath, sequence: () => (cached ? cached.sequence : 0) };
}

module.exports = { createCompatRemote, REGULAR_MS, BACKOFF_MINUTES, FETCH_TIMEOUT_MS };
