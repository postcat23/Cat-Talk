// 호환성 데이터 핫업데이트(②) 검증: 서명·롤백·권한(넓히기 무시)·병합 상한·캐시/오프라인/번들 폴백·백오프 간격.
// 시험 키를 그때그때 만들고(실제 서명 키를 쓰지 않는다), 네트워크·타이머는 가짜다. 사용: node tools/compat/test-manifest.js
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const m = require('../../electron/compat-manifest');
const { createCompatRemote } = require('../../electron/compat-remote');

const REPO = path.resolve(__dirname, '..', '..');
const BUNDLED_PATH = path.join(REPO, 'sidecar', 'compat', 'contract.json');
const bundled = JSON.parse(fs.readFileSync(BUNDLED_PATH, 'utf-8'));

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); };
const code = (fn) => { try { fn(); return 'ok'; } catch (e) { return e.code || e.message; } };

function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return { b64: der.subarray(der.length - 32).toString('base64'), privateKey };
}
const key = keypair(), other = keypair();
const sign = (raw, k = key) => crypto.sign(null, raw, k.privateKey);
const fp = (n) => crypto.createHash('sha256').update(`fp-${n}`).digest('hex');
const doc = (over = {}) => Buffer.from(JSON.stringify({ schema: 1, sequence: 1, issued: '2026-11-19', add: {}, deny: {}, patch: { deny_sha256: [] }, ...over }));
const pk = m.publicKey(key.b64);

// ── 서명·형식 ──
{
  const raw = doc({ add: { chat: [fp(1)] } });
  check('valid manifest accepted', code(() => m.verify(raw, sign(raw), pk)) === 'ok');
  check('signature by another key rejected', code(() => m.verify(raw, sign(raw, other), pk)) === 'bad_signature');
  const tampered = Buffer.from(raw); tampered[tampered.length - 3] ^= 1;
  check('tampered manifest rejected', code(() => m.verify(tampered, sign(raw), pk)) === 'bad_signature');
  check('63-byte signature rejected', code(() => m.verify(raw, sign(raw).subarray(0, 63), pk)) === 'bad_signature');
  check('65-byte signature rejected', code(() => m.verify(raw, Buffer.concat([sign(raw), Buffer.from([0])]), pk)) === 'bad_signature');
  const big = Buffer.alloc(m.MAX_MANIFEST + 1, 0x20);
  check('over 16KB rejected before signature check', code(() => m.verify(big, sign(big), pk)) === 'too_large');
  const notJson = Buffer.from('{"schema":1,'); check('signed non-JSON rejected', code(() => m.verify(notJson, sign(notJson), pk)) === 'invalid_manifest');
  const schema2 = doc({ schema: 2 }); check('unknown schema rejected', code(() => m.verify(schema2, sign(schema2), pk)) === 'unsupported_schema');
  const seq0 = doc({ sequence: 0 }); check('sequence 0 rejected', code(() => m.verify(seq0, sign(seq0), pk)) === 'invalid_manifest');
  const seqText = doc({ sequence: '2' }); check('non-integer sequence rejected', code(() => m.verify(seqText, sign(seqText), pk)) === 'invalid_manifest');
  const badFp = doc({ add: { chat: ['XYZ'] } }); check('malformed fingerprint rejects whole manifest', code(() => m.verify(badFp, sign(badFp), pk)) === 'invalid_manifest');
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), raw]); check('UTF-8 BOM tolerated', code(() => m.verify(bom, sign(bom), pk)) === 'ok');
  check('placeholder public key is refused', code(() => m.publicKey('REPLACE_WITH_COMPAT_SIGNING_PUB')) === 'bad_public_key');
}

// ── 롤백 방지 ──
{
  const r5 = doc({ sequence: 5 }), r5b = doc({ sequence: 5, issued: 'x' }), r4 = doc({ sequence: 4 }), r6 = doc({ sequence: 6 });
  const cached = { sequence: 5, raw: r5 };
  const p = (raw) => m.verify(raw, sign(raw), pk);
  check('no cache -> newer', m.compareSequence(p(r4), r4, null) === 'newer');
  check('older sequence -> rollback', m.compareSequence(p(r4), r4, cached) === 'rollback');
  check('same sequence same bytes -> unchanged', m.compareSequence(p(r5), r5, cached) === 'unchanged');
  check('same sequence other bytes -> sequence_reuse', m.compareSequence(p(r5b), r5b, cached) === 'sequence_reuse');
  check('higher sequence -> newer', m.compareSequence(p(r6), r6, cached) === 'newer');
}

// ── 병합·권한 ──
{
  const base = bundled.policy.chat.fingerprints;
  const added = m.merge(bundled, m.parse({ schema: 1, sequence: 1, add: { chat: [fp(1)] } }));
  check('add: bundle ∪ remote', added.policy.chat.fingerprints.length === base.length + 1 && added.policy.chat.fingerprints.includes(fp(1)) && base.every((v) => added.policy.chat.fingerprints.includes(v)));
  check('add: other features unchanged', JSON.stringify(added.policy.profiles) === JSON.stringify(bundled.policy.profiles));
  const denied = m.merge(bundled, m.parse({ schema: 1, sequence: 1, deny: { chat: [base[0]] } }));
  check('deny: removes a bundled fingerprint (restrict)', !denied.policy.chat.fingerprints.includes(base[0]) && denied.policy.chat.fingerprints.length === base.length - 1);
  const widen = m.parse({ schema: 1, sequence: 1, add: { chat: [fp(2)], foo: [fp(3)] },
    policy: { chat: { tier: 'T0', gate: null } }, features: {}, assemblies: [], native: {}, tier: 'T0',
    patch: { deny_sha256: [], allow_sha256: [fp(4)], remote: 'widen', tier: 'T0', recovery: 'data', rules: 'any' } });
  const ignored = new Set(widen.ignored);
  check('widening keys are ignored, not applied', ['policy', 'features', 'assemblies', 'native', 'tier', 'add.foo', 'patch.allow_sha256', 'patch.remote', 'patch.tier', 'patch.recovery', 'patch.rules'].every((k) => ignored.has(k)), [...ignored].join(','));
  const w = m.merge(bundled, widen);
  check('tiers/gates/recovery/probe spec/native stay bundled', JSON.stringify(m.FEATURES.map((f) => [w.policy[f].tier, w.policy[f].gate, w.policy[f].recovery])) === JSON.stringify(m.FEATURES.map((f) => [bundled.policy[f].tier, bundled.policy[f].gate, bundled.policy[f].recovery]))
    && JSON.stringify(w.features) === JSON.stringify(bundled.features) && JSON.stringify(w.native) === JSON.stringify(bundled.native) && JSON.stringify(w.assemblies) === JSON.stringify(bundled.assemblies));
  check('patch rules stay restrict-only (T3, app recovery)', w.patch.remote === 'restrict' && w.patch.tier === 'T3' && w.patch.recovery === 'app' && !('allow_sha256' in w.patch));
  const withDeny = JSON.parse(JSON.stringify(bundled)); withDeny.patch.deny_sha256 = [fp(10)];
  const kept = m.merge(withDeny, m.parse({ schema: 1, sequence: 1, patch: { deny_sha256: [] } }));
  check('remote cannot drop a bundled patch block', kept.patch.deny_sha256.includes(fp(10)));
  const grown = m.merge(withDeny, m.parse({ schema: 1, sequence: 1, patch: { deny_sha256: [fp(11)] } }));
  check('remote can add a patch block', grown.patch.deny_sha256.includes(fp(10)) && grown.patch.deny_sha256.includes(fp(11)));
  const many = m.parse({ schema: 1, sequence: 1, add: { chat: Array.from({ length: m.MAX_FINGERPRINTS }, (_, i) => fp(100 + i)) } });
  check('over 64 fingerprints per feature rejected', code(() => m.merge(bundled, many)) === 'too_many');
  // 병합 결과가 사이드카(파이썬) 계약 검증을 통과하는지 — 실제 environment.compatibility_contract로 본다
  const tmp = path.join(os.tmpdir(), `cattalk-effective-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify(m.merge(bundled, m.parse({ schema: 1, sequence: 1, add: { chat: [fp(1)], privacy: [fp(2)] }, deny: { lobby: [bundled.policy.lobby.fingerprints[0]] }, patch: { deny_sha256: [fp(12)] } }))));
  let py = '';
  try {
    py = execFileSync('py', ['-3.11', '-c', 'import sys; from bongo_chat.environment import compatibility_contract as c; c(sys.argv[1]); print("ok")', tmp],
      { cwd: REPO, env: { ...process.env, PYTHONPATH: path.join(REPO, 'src') }, encoding: 'utf-8' }).trim();
  } catch (e) { py = String(e.stderr || e.message).trim().split('\n').pop(); }
  fs.rmSync(tmp, { force: true });
  check('merged contract passes the sidecar validator (python)', py === 'ok', py);
}

// ── 받기·캐시·폴백(가짜 네트워크) ──
function fakeTimers() {
  const pending = new Map(); let next = 1;
  return {
    pending,
    setTimeout: (fn, ms) => { const id = next++; pending.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => { pending.delete(id); },
    setInterval: (fn, ms) => { const id = next++; pending.set(id, { fn, ms, every: true }); return { id, unref() {} }; },
    clearInterval: (h) => { if (h) pending.delete(h.id); },
  };
}
function response(status, buf) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => null }, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
}
function server() {
  const s = { manifest: null, sig: null, offline: false, status: 200, calls: 0 };
  s.fetch = async (url) => {
    s.calls++;
    if (s.offline) throw new TypeError('fetch failed');
    if (s.status !== 200) return response(s.status, Buffer.alloc(0));
    return response(200, url.endsWith('.sig') ? s.sig : s.manifest);
  };
  s.publish = (raw, k = key) => { s.manifest = raw; s.sig = sign(raw, k); };
  return s;
}
const effective = (r) => JSON.parse(fs.readFileSync(r.effectivePath, 'utf-8'));

(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'cattalk-compat-'));
  const logs = [];
  const make = (s, extra = {}) => {
    let changed = 0;
    const r = createCompatRemote({ bundledPath: BUNDLED_PATH, dataDir: data, fetch: s.fetch, publicKeyB64: key.b64, url: 'https://example.invalid/compat/manifest.json',
      log: (event, d) => logs.push([event, d]), onChanged: () => { changed++; }, timers: fakeTimers(), ...extra });
    r.changes = () => changed;
    return r;
  };
  try {
    const s = server();
    const a = make(s);
    const p = a.prepare();
    check('prepare without cache -> bundle as effective', p === a.effectivePath && JSON.stringify(effective(a).policy) === JSON.stringify(bundled.policy));
    s.status = 404;
    check('no manifest published (404) -> fetch_failed, bundle kept', await a.check('t') === 'fetch_failed' && JSON.stringify(effective(a).policy) === JSON.stringify(bundled.policy));
    s.status = 200;
    s.publish(doc({ sequence: 2, add: { chat: [fp(1)] } }));
    check('signed manifest accepted', await a.check('t') === 'accepted' && effective(a).policy.chat.fingerprints.includes(fp(1)) && a.changes() === 1);
    check('same manifest again -> unchanged, no reload', await a.check('t') === 'unchanged' && a.changes() === 1);
    s.publish(doc({ sequence: 1, add: { chat: [fp(9)] } }));
    check('rollback (older sequence) rejected, effective kept', await a.check('t') === 'rejected' && effective(a).policy.chat.fingerprints.includes(fp(1)) && !effective(a).policy.chat.fingerprints.includes(fp(9)));
    s.publish(doc({ sequence: 3, add: { chat: [fp(9)] } }), other);
    check('wrong signer rejected, effective kept', await a.check('t') === 'rejected' && !effective(a).policy.chat.fingerprints.includes(fp(9)));
    const raw3 = doc({ sequence: 3, add: { chat: [fp(9)] } }); s.manifest = Buffer.from(raw3); s.sig = sign(raw3); s.manifest[20] ^= 1;
    check('tampered in transit rejected', await a.check('t') === 'rejected' && !effective(a).policy.chat.fingerprints.includes(fp(9)));
    s.manifest = Buffer.alloc(m.MAX_MANIFEST + 10, 0x20); s.sig = sign(s.manifest);
    check('oversized body refused while reading', await a.check('t') === 'fetch_failed' && logs.some(([e, d]) => e === 'compat_remote' && d.reason === 'too_large'));

    // 앱 재시작 + 오프라인: 검증된 캐시로 시작(번들 + 받은 지문)
    const offline = server(); offline.offline = true;
    const b = make(offline);
    b.prepare();
    check('offline restart uses verified cache', effective(b).policy.chat.fingerprints.includes(fp(1)));
    check('offline check -> fetch_failed, cache kept', await b.check('t') === 'fetch_failed' && effective(b).policy.chat.fingerprints.includes(fp(1)));
    // 캐시가 디스크에서 바뀌면(서명 불일치) 버리고 번들로 시작
    const cacheFile = path.join(data, 'compat', m.keyId(key.b64), 'manifest.json');
    const bytes = fs.readFileSync(cacheFile); bytes[10] ^= 1; fs.writeFileSync(cacheFile, bytes);
    const c = make(offline);
    c.prepare();
    check('corrupted cache ignored -> bundle fallback', JSON.stringify(effective(c).policy) === JSON.stringify(bundled.policy) && logs.some(([e, d]) => e === 'compat_cache' && d.result === 'ignored'));
    // 다른 공개키(시험 키↔실제 키)는 캐시를 공유하지 않는다
    check('cache is per public key', m.keyId(key.b64) !== m.keyId(other.b64));

    // 백오프: 모르는 지문이면 즉시 + 1·2·4·8·16·30·30분, 없어지면 멈춘다
    const t = fakeTimers();
    const s2 = server(); s2.status = 404;
    const d = make(s2, { timers: t });
    d.prepare();
    d.status({ unknown: ['chat'] });
    await new Promise((r) => setImmediate(r));
    const firstCalls = s2.calls;
    const delays = [];
    for (let i = 0; i < 7; i++) {
      const entry = [...t.pending.entries()].find(([, v]) => v.ms >= 60000 && !v.every);
      if (!entry) break;
      delays.push(entry[1].ms / 60000);
      t.pending.delete(entry[0]);
      await entry[1].fn();
    }
    check('unsupported -> immediate fetch', firstCalls === 2, `calls=${firstCalls}`);
    check('backoff 1,2,4,8,16,30,30 minutes', JSON.stringify(delays) === JSON.stringify([1, 2, 4, 8, 16, 30, 30]), JSON.stringify(delays));
    d.status({ unknown: ['chat'] });
    check('repeated unsupported does not restart backoff', [...t.pending.values()].filter((v) => v.ms >= 60000 && !v.every).length === 1);
    d.status({ unknown: [] });
    check('known again -> backoff stops', [...t.pending.values()].filter((v) => v.ms >= 60000 && !v.every).length === 0);
    d.start();
    check('regular check every 6 hours', [...t.pending.values()].some((v) => v.every && v.ms === 6 * 60 * 60 * 1000));
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
  process.exit(failed ? 1 : 0);
})();
