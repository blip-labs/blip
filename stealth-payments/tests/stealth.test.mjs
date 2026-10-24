// stealth.js checks: fixed vectors, cross-check with @stacks/transactions, Python agreement, scan rejections,
// 200 random round trips. Only throwaway keys (public vectors or fresh random keys that are never stored).
import { readFileSync, writeFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js';
import { getAddressFromPrivateKey, getAddressFromPublicKey, addressFromVersionHash, addressToString } from '@stacks/transactions';
import * as S from '../stealth.js';

const kit = new URL('..', import.meta.url).pathname;
let fails = 0, passes = 0;
const chk = (c, m) => { if (c) passes++; else { fails++; console.log('FAIL ' + m); } return c; };
const say = m => console.log('ok   ' + m);
const py = (args, opts = {}) => spawnSync('python3', ['-I', join(kit, 'stealth.py'), ...args], { encoding: 'utf8', ...opts });
const randKey = () => bytesToHex(secp256k1.utils.randomSecretKey());
const stacksAddr = (v, h) => addressToString(addressFromVersionHash(v, h));

// 1. fixed vectors
const V = JSON.parse(readFileSync(join(kit, 'vectors.json'), 'utf8')).vectors;
chk(V.length >= 5, 'at least 5 vectors');
for (const v of V) {
  const code = S.makeMetaAddress(S.pubFromPriv(v.scanPriv), S.pubFromPriv(v.spendPriv));
  const d = S.derivePayment(code, 26, v.r);
  chk(code === v.code, v.label + ': code');
  chk(d.addr === v.addr && d.R === v.R && d.tag === v.tag, v.label + ': derivePayment');
  chk(S.scan(v.scanPriv, S.parseMetaAddress(code).spendPub, v.R, v.tag, v.addr) === v.addr, v.label + ': scan finds it');
  chk(S.spendKey(v.scanPriv, v.spendPriv, v.R) === v.spendKey, v.label + ': spendKey');
  chk(getAddressFromPrivateKey(v.spendKey + '01', 'testnet') === v.addr, v.label + ': getAddressFromPrivateKey(spendKey+01) == addr');
  chk(getAddressFromPublicKey(d.pub, 'testnet') === v.addr, v.label + ': getAddressFromPublicKey(P) == addr');
  chk(v.addr.startsWith('ST'), v.label + ': testnet address');
}
say(`${V.length} fixed vectors match (code, R, tag, addr, scan, spendKey, @stacks address checks)`);
// stacks.js reads a bare 32-byte key as "uncompressed": that gives a DIFFERENT address. Document it.
chk(getAddressFromPrivateKey(V[0].spendKey, 'testnet') !== V[0].addr, 'bare 64-hex spendKey maps to the uncompressed address (use +01)');
say('confirmed: stacks.js needs spendKey + "01" (bare 64-hex key = uncompressed pubkey = other address)');

// 2. c32check against @stacks/transactions
const h160s = ['00'.repeat(20), '00'.repeat(19) + '01', '0000' + 'ff'.repeat(18), '00' + 'ab'.repeat(19), 'ff'.repeat(20)];
for (let i = 0; i < 300; i++) h160s.push(bytesToHex(randomBytes(20)));
let c32n = 0;
for (const h of h160s) for (const ver of [20, 21, 22, 26]) { chk(S.c32address(ver, h) === stacksAddr(ver, h), `c32 ${ver} ${h}`); c32n++; }
say(`${c32n} c32check addresses equal @stacks/transactions (incl. leading-zero hashes, versions 20/21/22/26)`);

// 3. code format and input checks
const v0 = V[0], { scanPub, spendPub } = S.parseMetaAddress(v0.code);
chk(v0.code.length === 146 && /^stx-stealth:1:[0-9a-f]{132}$/.test(v0.code), 'code is 146 chars, lowercase hex');
chk(S.parseMetaAddress(v0.code.toUpperCase().replace('STX-STEALTH:1:', 'stx-stealth:1:')).scanPub === scanPub, 'upper-case hex accepted');
const throws = (f, m) => { let t = false; try { f(); } catch { t = true; } chk(t, 'throws: ' + m); };
throws(() => S.parseMetaAddress('stx-stealth:2:' + scanPub + spendPub), 'wrong version');
throws(() => S.parseMetaAddress(S.PREFIX + scanPub + spendPub.slice(2)), 'short code');
throws(() => S.parseMetaAddress(S.PREFIX + scanPub + '04' + spendPub.slice(2)), '04 prefix');
throws(() => S.parseMetaAddress(S.PREFIX + scanPub + '02' + '00'.repeat(31) + '05'), 'x not on curve');
throws(() => S.derivePayment(v0.code, 26, '00'.repeat(32)), 'r = 0');
throws(() => S.derivePayment(v0.code, 26, bytesToHex(new Uint8Array(32).fill(255))), 'r >= n');
throws(() => S.spendKey(v0.scanPriv, '00'.repeat(32), v0.R), 'spend key 0');
throws(() => S.scan(v0.scanPriv, spendPub, '02' + '00'.repeat(31) + '05', v0.tag), 'R not on curve');
say('code format and bad inputs are refused');

// 4. scan rejections
let wrongTag = 0;
for (let t = 0; t < 256; t++) { if (t === parseInt(v0.tag, 16)) continue; chk(S.scan(v0.scanPriv, spendPub, v0.R, t.toString(16).padStart(2, '0')) === null, 'wrong tag ' + t); wrongTag++; }
say(`all ${wrongTag} wrong tags rejected`);
let wrongKey = 0;
for (let i = 0; i < 200; i++) { chk(S.scan(randKey(), spendPub, v0.R, v0.tag, v0.addr) === null, 'wrong scan key'); wrongKey++; }
for (let i = 0; i < 50; i++) { chk(S.scan(v0.scanPriv, S.pubFromPriv(randKey()), v0.R, v0.tag, v0.addr) === null, 'wrong spend key'); wrongKey++; }
say(`${wrongKey} wrong scan/spend keys rejected`);
// a wrong scan key whose view tag collides (1 in 256): with `to` it is still rejected
let collided = null;
for (let i = 0; i < 20000 && !collided; i++) { const k = randKey(); if (S.scan(k, spendPub, v0.R, v0.tag) !== null) collided = k; }
chk(collided !== null, 'found a tag collision');
chk(S.scan(collided, spendPub, v0.R, v0.tag) !== v0.addr, 'collision without `to` yields some other address');
chk(S.scan(collided, spendPub, v0.R, v0.tag, v0.addr) === null, 'collision with `to` is rejected');
say('view-tag collision with a wrong key is rejected when `to` is passed');

// 5. 200 random round trips (JS), then the same cases through Python
const cases = [];
for (let i = 0; i < 200; i++) {
  const s = randKey(), b = randKey(), code = S.makeMetaAddress(S.pubFromPriv(s), S.pubFromPriv(b));
  const d = S.derivePayment(code);
  const p = S.spendKey(s, b, d.R);
  chk(S.scan(s, S.pubFromPriv(b), d.R, d.tag, d.addr) === d.addr, 'random scan ' + i);
  chk(getAddressFromPrivateKey(p + '01', 'testnet') === d.addr, 'random spendKey ' + i);
  cases.push({ label: `random ${i} (throwaway, deleted after test)`, scanPriv: s, spendPriv: b, code, R: d.R, tag: d.tag, addr: d.addr, spendKey: p });
}
say('200 random round trips: derive -> scan -> spendKey -> @stacks address');

// 6. Python agrees (vectors.json + the 200 random cases)
const dir = mkdtempSync(join(tmpdir(), 'stealth-test-'));
try {
  let r = py(['check', join(kit, 'vectors.json')]);
  let out = JSON.parse(r.stdout);
  chk(r.status === 0 && out.failed === 0 && out.checked === V.length, 'python check vectors.json: ' + r.stdout.slice(0, 200) + r.stderr);
  say(`python reproduces all ${out.checked} vectors byte-for-byte`);
  writeFileSync(join(dir, 'cases.json'), JSON.stringify({ vectors: cases }));
  r = py(['check', join(dir, 'cases.json')]);
  out = JSON.parse(r.stdout);
  chk(r.status === 0 && out.failed === 0 && out.checked === 200, 'python check random: ' + r.stderr);
  say(`python agrees with JS on ${out.checked} random payments`);

  // 7. Python CLI: keygen / code / scan
  const kf = join(dir, 'keys.json');
  r = py(['keygen', kf]);
  const code = r.stdout.trim();
  chk(r.status === 0 && r.stdout.split('\n').filter(Boolean).length === 1 && S.parseMetaAddress(code), 'keygen prints only the code');
  chk((statSync(kf).mode & 0o777) === 0o600, 'key file mode 0600');
  const before = readFileSync(kf, 'utf8');
  r = py(['keygen', kf]);
  chk(r.status !== 0 && readFileSync(kf, 'utf8') === before && !/[0-9a-f]{64}/.test(r.stdout + r.stderr), 'keygen refuses to overwrite (O_EXCL), prints no key');
  chk(py(['code', kf]).stdout.trim() === code, 'code reprints the same code');
  const keys = JSON.parse(before);
  chk(S.makeMetaAddress(S.pubFromPriv(keys.scan), S.pubFromPriv(keys.spend)) === code, 'JS builds the same code from the key file');
  const d = S.derivePayment(code);
  r = py(['scan', kf, d.R, d.tag, d.addr]);
  chk(r.status === 0 && r.stdout.trim() === d.addr, 'python scan finds the JS payment: ' + r.stdout + r.stderr);
  r = py(['scan', kf, d.R, d.tag]);
  chk(r.status === 0 && r.stdout.trim() === d.addr, 'python scan without TO prints the address');
  const bad = ((parseInt(d.tag, 16) + 1) % 256).toString(16).padStart(2, '0');
  r = py(['scan', kf, d.R, bad, d.addr]);
  chk(r.status === 1 && r.stdout.trim() === 'no match', 'python scan: wrong tag -> no match');
  r = py(['scan', kf, S.derivePayment(V[0].code).R, d.tag, d.addr]);
  chk(r.status === 1 && r.stdout.trim() === 'no match', 'python scan: someone else\'s payment -> no match');
  chk(S.spendKey(keys.scan, keys.spend, d.R) && getAddressFromPrivateKey(S.spendKey(keys.scan, keys.spend, d.R) + '01', 'testnet') === d.addr, 'spend key for the keygen keys opens the address');
  say('python CLI: keygen (0600, O_EXCL, code only), code, scan hit/miss');
} finally { rmSync(dir, { recursive: true, force: true }); }

console.log(`${passes} checks passed, ${fails} failed`);
console.log(fails ? 'FAILED ' + fails : 'ALL PASS');
process.exit(fails ? 1 : 0);
