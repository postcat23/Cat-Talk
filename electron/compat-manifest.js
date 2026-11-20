// 호환성 데이터 핫업데이트(②, 1.0.8): 원격 매니페스트의 검증·병합 규칙. 순수 함수만 둔다(Electron 없이 시험·서명 도구가 같이 쓴다).
// 형식은 업스트림 updates.py와 같은 틀이다: 매니페스트 원문(UTF-8 JSON, 16KB 이하)에 대한 Ed25519 서명 64바이트(.sig),
// 공개키는 32바이트 base64. 서명은 원문 바이트 그대로 검사한다(파싱 전).
// 원격 권한(사용자 명세 2026-11-19): 연결 지문은 '추가'(add)와 '철회'(deny)만, 게임 패치(T3)는 차단 목록(patch.deny_sha256)
// '추가'만 받는다. 티어·게이트·FeatureProbe 대상·패치 허용 같은 나머지 키는 읽지 않는다 — DLL 패치 규칙은 앱 릴리스로만 바뀐다.
const crypto = require('crypto');

// 앱에 든 서명 공개키(tools/compat/manifest-sign.js keygen이 만든 compat-signing.pub). 개인키는 레포·CI 밖에만 있다
const PUBLIC_KEY = 'H6M0MOLn0HDzWk9SJvdNtyu9TxAxirnTD5jvwNzDGbk=';
const MANIFEST_URL = 'https://raw.githubusercontent.com/postcat23/Cat-Talk/main/compat/manifest.json';
const MAX_MANIFEST = 16384;   // 업스트림 updates.py verify_manifest와 같은 상한
const SIGNATURE_BYTES = 64;
// 이 앱이 받는 가장 낮은 sequence(새 설치의 롤백 기준). 매니페스트를 올린 뒤 앱을 낼 때 그 sequence로 올린다
const MIN_SEQUENCE = 1;
const FEATURES = ['chat', 'reactions', 'profiles', 'lobby', 'privacy'];
// src/bongo_chat/environment.py compatibility_contract와 같은 상한(넘으면 사이드카가 계약 전체를 거부한다)
const MAX_FINGERPRINTS = 64;
const MAX_PATCH_DENY = 256;
const HEX64 = /^[0-9a-f]{64}$/;
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');
const TOP_KEYS = new Set(['schema', 'sequence', 'issued', 'note', 'add', 'deny', 'patch']);

class ManifestError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function publicKey(b64 = PUBLIC_KEY) {
  const raw = Buffer.from(String(b64), 'base64');
  if (raw.length !== 32) throw new ManifestError('bad_public_key');
  return crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, raw]), format: 'der', type: 'spki' });
}

// 캐시 폴더 이름. 공개키마다 캐시를 따로 두어 시험 키로 받은 매니페스트가 실제 키의 캐시와 섞이지 않게 한다
function keyId(b64 = PUBLIC_KEY) {
  return crypto.createHash('sha256').update(String(b64)).digest('hex').slice(0, 12);
}

const hexList = (values) => Array.isArray(values) && values.every((v) => typeof v === 'string' && HEX64.test(v));
const plainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

// 읽는 키만 꺼낸다. 알려진 키의 값이 틀리면 매니페스트 전체를 거부하고(부분 적용 없음), 모르는 키는 무시 목록에 남긴다.
function parse(manifest) {
  if (!plainObject(manifest)) throw new ManifestError('invalid_manifest');
  if (manifest.schema !== 1) throw new ManifestError('unsupported_schema');
  if (!Number.isSafeInteger(manifest.sequence) || manifest.sequence < 1) throw new ManifestError('invalid_manifest');
  const ignored = Object.keys(manifest).filter((key) => !TOP_KEYS.has(key));
  const lists = (value, where) => {
    const out = {};
    if (value === undefined) return out;
    if (!plainObject(value)) throw new ManifestError('invalid_manifest');
    for (const [feature, values] of Object.entries(value)) {
      if (!FEATURES.includes(feature)) { ignored.push(`${where}.${feature}`); continue; }
      if (!hexList(values)) throw new ManifestError('invalid_manifest');
      out[feature] = [...new Set(values)];
    }
    return out;
  };
  const add = lists(manifest.add, 'add');
  const deny = lists(manifest.deny, 'deny');
  let patchDeny = [];
  if (manifest.patch !== undefined) {
    if (!plainObject(manifest.patch)) throw new ManifestError('invalid_manifest');
    for (const key of Object.keys(manifest.patch)) if (key !== 'deny_sha256') ignored.push(`patch.${key}`);
    if (manifest.patch.deny_sha256 !== undefined) {
      if (!hexList(manifest.patch.deny_sha256)) throw new ManifestError('invalid_manifest');
      patchDeny = [...new Set(manifest.patch.deny_sha256)];
    }
  }
  return { sequence: manifest.sequence, issued: typeof manifest.issued === 'string' ? manifest.issued.slice(0, 40) : '',
    add, deny, patchDeny, ignored };
}

// 원문과 서명을 검사하고 읽는다. 실패는 코드만 낸다(내용·경로는 로그에 남기지 않는다).
function verify(raw, signature, key = publicKey()) {
  if (!Buffer.isBuffer(raw) || raw.length === 0) throw new ManifestError('invalid_manifest');
  if (raw.length > MAX_MANIFEST) throw new ManifestError('too_large');
  if (!Buffer.isBuffer(signature) || signature.length !== SIGNATURE_BYTES) throw new ManifestError('bad_signature');
  let ok = false;
  try { ok = crypto.verify(null, raw, key, signature); } catch { ok = false; }
  if (!ok) throw new ManifestError('bad_signature');
  let manifest;
  try { manifest = JSON.parse(raw.toString('utf-8').replace(/^﻿/, '')); } catch { throw new ManifestError('invalid_manifest'); }
  return parse(manifest);
}

// 롤백 방지: 받은 적 있는 sequence보다 낮으면 거부하고, 같으면 원문까지 같을 때만 '변화 없음'(같은 번호로 내용을 바꾸지 못한다).
// cached = { sequence, raw } | null
function compareSequence(parsed, raw, cached) {
  if (parsed.sequence < MIN_SEQUENCE) return 'rollback';
  if (!cached) return 'newer';
  if (parsed.sequence < cached.sequence) return 'rollback';
  if (parsed.sequence === cached.sequence) return Buffer.compare(raw, cached.raw) === 0 ? 'unchanged' : 'sequence_reuse';
  return 'newer';
}

// 유효 계약 = 기능별 (번들 ∪ 원격 add) − 원격 deny, 패치 차단 = 번들 ∪ 원격. 그 밖(티어·게이트·FeatureProbe 대상·native·패치 규칙)은 번들 그대로.
// 상한을 넘으면 거부한다(사이드카가 계약 전체를 버리고 T1·T2를 멈추는 일을 만들지 않는다).
function merge(bundled, parsed) {
  const out = JSON.parse(JSON.stringify(bundled));
  if (!parsed) return out;
  for (const feature of FEATURES) {
    const row = out.policy && out.policy[feature];
    if (!row) continue;
    const set = new Set([...(row.fingerprints || []), ...(parsed.add[feature] || [])]);
    for (const value of parsed.deny[feature] || []) set.delete(value);
    row.fingerprints = [...set];
    if (row.fingerprints.length > MAX_FINGERPRINTS) throw new ManifestError('too_many');
  }
  if (out.patch) {
    out.patch.deny_sha256 = [...new Set([...(out.patch.deny_sha256 || []), ...parsed.patchDeny])];
    if (out.patch.deny_sha256.length > MAX_PATCH_DENY) throw new ManifestError('too_many');
  }
  return out;
}

module.exports = {
  PUBLIC_KEY, MANIFEST_URL, MAX_MANIFEST, SIGNATURE_BYTES, MIN_SEQUENCE, FEATURES, MAX_FINGERPRINTS, MAX_PATCH_DENY,
  ManifestError, publicKey, keyId, parse, verify, compareSequence, merge,
};
