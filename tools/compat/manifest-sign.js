#!/usr/bin/env node
// 호환성 매니페스트 서명 도구(②, 1.0.8). 사용법은 docs/compat-manifest.md.
// 개인키는 암호로 감싸(PKCS#8, aes-256-cbc) 레포 밖(기본 %USERPROFILE%\.cattalk\compat-signing.key)에 둔다 — CI·git에 넣지 않는다.
// 암호는 터미널에서만 입력받는다(화면에 표시하지 않고, 파이프·인자·환경 변수로 받지 않는다).
//
//   node tools/compat/manifest-sign.js keygen [--key <경로>]                 키쌍 만들기(한 번). 공개키를 .pub로 저장·출력
//   node tools/compat/manifest-sign.js draft [--sequence N] [--out <경로>]    번들 계약의 지문으로 초기 매니페스트 초안
//   node tools/compat/manifest-sign.js sign [매니페스트] [--key <경로>]        서명(.sig 생성)
//   node tools/compat/manifest-sign.js verify [매니페스트] [--pub <base64|파일>] 앱에 든 공개키(또는 지정 키)로 확인
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const m = require('../../electron/compat-manifest');

const REPO = path.resolve(__dirname, '..', '..');
const DEFAULT_KEY = path.join(os.homedir(), '.cattalk', 'compat-signing.key');
const DEFAULT_MANIFEST = path.join(REPO, 'compat', 'manifest.json');
const BUNDLED = path.join(REPO, 'sidecar', 'compat', 'contract.json');

const die = (text) => { console.error(`오류: ${text}`); process.exit(1); };

function options(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') out.force = true;
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
    else out._.push(a);
  }
  return out;
}

function insideRepo(file) {
  const rel = path.relative(REPO, path.resolve(file));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// 화면에 표시하지 않는 입력(raw mode). TTY가 아니면 거부한다.
function askHidden(question) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) { reject(new Error('터미널에서 직접 실행하세요(암호는 파이프·인자로 받지 않습니다).')); return; }
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const cleanup = () => { stdin.removeListener('data', onData); stdin.setRawMode(false); stdin.pause(); process.stdout.write('\n'); };
    function onData(chunk) {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') { cleanup(); resolve(value); return; }
        if (ch === '\u0003') { cleanup(); reject(new Error('취소했습니다.')); return; }   // Ctrl+C
        if (ch === '\u0008' || ch === '\u007f') { value = value.slice(0, -1); continue; }
        value += ch;
      }
    }
    stdin.on('data', onData);
  });
}

async function keygen(opt) {
  const keyPath = path.resolve(opt.key || DEFAULT_KEY);
  const pubPath = `${keyPath.replace(/\.key$/i, '')}.pub`;
  if (insideRepo(keyPath)) die('개인키는 레포 밖에 두어야 합니다.');
  if (fs.existsSync(keyPath) || fs.existsSync(pubPath)) die(`이미 있습니다: ${keyPath} — 덮어쓰지 않습니다(키를 바꾸면 앱 릴리스로 공개키도 바꿔야 합니다).`);
  const passphrase = await askHidden('새 암호: ');
  if (!passphrase) die('암호가 비어 있습니다.');
  if (await askHidden('암호 확인: ') !== passphrase) die('두 암호가 다릅니다.');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase },
  });
  const pub = publicKey.subarray(publicKey.length - 32).toString('base64');
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, privateKey, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(pubPath, `${pub}\n`, { flag: 'wx' });
  console.log(`개인키(암호로 보호): ${keyPath}`);
  console.log(`공개키: ${pubPath}`);
  console.log(`공개키 값: ${pub}`);
  console.log('개인키와 암호를 따로 백업해 두세요. 잃으면 새 매니페스트를 서명할 수 없어 앱 릴리스로 공개키를 바꿔야 합니다.');
}

function draft(opt) {
  const out = path.resolve(opt.out || DEFAULT_MANIFEST);
  if (fs.existsSync(out) && !opt.force) die(`이미 있습니다: ${out} — 고칠 때는 파일을 직접 편집하고 sequence를 올리세요(--force로 덮어쓰기).`);
  const contract = JSON.parse(fs.readFileSync(BUNDLED, 'utf-8'));
  const add = {};
  for (const feature of m.FEATURES) add[feature] = contract.policy[feature].fingerprints;
  const sequence = Number(opt.sequence || 1);
  if (!Number.isSafeInteger(sequence) || sequence < 1) die('sequence는 1 이상의 정수여야 합니다.');
  const doc = { schema: 1, sequence, issued: new Date().toISOString().slice(0, 10),
    note: 'Cat Talk 번들 계약의 연결 지문 전체(봉고캣 빌드 26754239 포함)', add, deny: {},
    patch: { deny_sha256: contract.patch.deny_sha256 || [] } };
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  m.parse(JSON.parse(text));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
  console.log(`초안: ${out} (sequence ${sequence}, ${Buffer.byteLength(text)}바이트). 서명: node tools/compat/manifest-sign.js sign`);
}

function summary(parsed, raw) {
  const counts = m.FEATURES.map((f) => `${f} +${(parsed.add[f] || []).length}/-${(parsed.deny[f] || []).length}`).join(', ');
  console.log(`sequence ${parsed.sequence}, issued ${parsed.issued || '-'}, ${raw.length}바이트`);
  console.log(`지문: ${counts}; 패치 차단 ${parsed.patchDeny.length}`);
  if (parsed.ignored.length) console.log(`무시되는 키(앱이 읽지 않음): ${parsed.ignored.join(', ')}`);
}

async function sign(opt) {
  const file = path.resolve(opt._[1] || DEFAULT_MANIFEST);
  const keyPath = path.resolve(opt.key || DEFAULT_KEY);
  const raw = fs.readFileSync(file);
  if (raw.length > m.MAX_MANIFEST) die(`${raw.length}바이트 — 상한 ${m.MAX_MANIFEST}바이트를 넘습니다.`);
  let parsed;
  try { parsed = m.parse(JSON.parse(raw.toString('utf-8').replace(/^﻿/, ''))); } catch (e) { die(`매니페스트 형식: ${e.code || e.message}`); }
  try { m.merge(JSON.parse(fs.readFileSync(BUNDLED, 'utf-8')), parsed); } catch (e) { die(`번들과 합치면 상한을 넘습니다: ${e.code || e.message}`); }
  summary(parsed, raw);
  const pem = fs.readFileSync(keyPath, 'utf-8');
  let privateKey;
  try { privateKey = crypto.createPrivateKey({ key: pem, format: 'pem', passphrase: await askHidden('암호: ') }); }
  catch (e) { die(e.message === '취소했습니다.' ? e.message : '개인키를 열지 못했습니다(암호 확인).'); }
  const signature = crypto.sign(null, raw, privateKey);
  const pub = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const pubB64 = pub.subarray(pub.length - 32).toString('base64');
  m.verify(raw, signature, m.publicKey(pubB64));
  fs.writeFileSync(`${file}.sig`, signature);
  console.log(`서명: ${file}.sig (${signature.length}바이트)`);
  if (pubB64 !== m.PUBLIC_KEY) console.log('주의: 이 키는 앱에 든 공개키(electron/compat-manifest.js PUBLIC_KEY)와 다릅니다 — 앱이 받아들이지 않습니다.');
  console.log('다음: 매니페스트와 .sig를 함께 커밋해 main에 push하면, 받는 앱이 재설치 없이 반영합니다.');
}

function verifyCommand(opt) {
  const file = path.resolve(opt._[1] || DEFAULT_MANIFEST);
  const raw = fs.readFileSync(file);
  const sig = fs.readFileSync(`${file}.sig`);
  let pub = opt.pub || m.PUBLIC_KEY;
  if (opt.pub && fs.existsSync(opt.pub)) pub = fs.readFileSync(opt.pub, 'utf-8').trim();
  try {
    const parsed = m.verify(raw, sig, m.publicKey(pub));
    summary(parsed, raw);
    m.merge(JSON.parse(fs.readFileSync(BUNDLED, 'utf-8')), parsed);
    console.log(`OK — ${opt.pub ? '지정한' : '앱에 든'} 공개키로 서명이 맞습니다.`);
  } catch (e) {
    die(`확인 실패: ${e.code || e.message}`);
  }
}

(async () => {
  const opt = options(process.argv.slice(2));
  const command = opt._[0];
  try {
    if (command === 'keygen') await keygen(opt);
    else if (command === 'draft') draft(opt);
    else if (command === 'sign') await sign(opt);
    else if (command === 'verify') verifyCommand(opt);
    else {
      console.log('사용: node tools/compat/manifest-sign.js <keygen|draft|sign|verify> (docs/compat-manifest.md)');
      process.exit(command ? 1 : 0);
    }
  } catch (e) {
    die(e.message);
  }
})();
