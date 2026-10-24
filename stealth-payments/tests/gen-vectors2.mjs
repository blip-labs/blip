// Regenerates vectors2.json (scheme v2) from PUBLIC strings. Every key here is a public throwaway test key.
import { writeFileSync } from 'node:fs';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import * as S from '../stealth2.js';
const h = s => bytesToHex(sha256(utf8ToBytes(s)));
const valid = [];
const cases = [['testnet', 0], ['testnet', 0], ['mainnet', 0], ['testnet', 1], ['testnet', 7], ['mainnet', 3]];
cases.forEach(([network, label], i) => {
  const src = k => `stx-stealth v2 PUBLIC TEST VECTOR ${i + 1} ${k}`;
  const scanPriv = h(src('scan')), spendPriv = h(src('spend')), r = h(src('r'));
  const spendPub = S.pubFromPriv(spendPriv);
  const code = label ? S.encodeLabelledCode(scanPriv, spendPub, label, network) : S.encodeCode(S.pubFromPriv(scanPriv), spendPub, network);
  const d = S.derivePayment(code, r);
  valid.push({ comment: `vector ${i + 1}: ${network}${label ? ', label ' + label : ''}. PUBLIC THROWAWAY KEYS, never fund`,
    source: { scanPriv: `sha256("${src('scan')}")`, spendPriv: `sha256("${src('spend')}")`, r: `sha256("${src('r')}")` },
    network, label, scanPriv, spendPriv, spendPub, r, code, R: d.R, tag: d.tag, addr: d.addr, spendKey: S.spendKey(scanPriv, spendPriv, d.R, label) });
});
const good = valid[0].code;
const flip = (s, i) => s.slice(0, i) + (s[i] === 'q' ? 'p' : 'q') + s.slice(i + 1);
const invalid = [
  { comment: 'one character changed (typo): checksum fails', code: flip(good, 20) },
  { comment: 'last character changed: checksum fails', code: flip(good, good.length - 1) },
  { comment: 'two characters swapped', code: good.slice(0, 30) + good[31] + good[30] + good.slice(32) },
  { comment: 'mixed case', code: good.slice(0, 10).toUpperCase() + good.slice(10) },
  { comment: 'unknown prefix (bitcoin silent payment code prefix "sp")', code: S.bech32mEncode('sp', [0, ...Array(106).fill(0)]) },
  { comment: 'unknown code version 1', code: (() => { const { data } = S.bech32mDecode(good); return S.bech32mEncode('tspstx', [1, ...data.slice(1)]); })() },
  { comment: 'scan key not on the curve (x = 5)', code: S.bech32mEncode('tspstx', [0, ...convert(Uint8Array.from([2, ...Array(31).fill(0), 5, ...hexBytes(valid[0].spendPub)]))]) },
  { comment: 'old v1 format is not a v2 code', code: 'stx-stealth:1:' + '02'.padEnd(132, '1') },
];
for (const v of invalid) { try { S.decodeCode(v.code); throw new Error('vector unexpectedly valid: ' + v.comment); } catch (e) { if (e.message.startsWith('vector unexpectedly')) throw e; v.error = e.message; } }
function hexBytes(hx) { return hx.match(/../g).map(x => parseInt(x, 16)); }
function convert(bytes) { let acc = 0, bits = 0; const out = []; for (const v of bytes) { acc = (acc << 8) | v; bits += 8; while (bits >= 5) { bits -= 5; out.push((acc >> bits) & 31); } } if (bits) out.push((acc << (5 - bits)) & 31); return out; }
writeFileSync(new URL('../vectors2.json', import.meta.url), JSON.stringify({
  warning: 'PUBLIC THROWAWAY TEST KEYS. Each key is sha256 of the public string in `source`. Anyone can spend from these addresses. Never send real funds.',
  scheme: 'See SPEC.md. t = H_SharedSecret(ser(r*S)) mod n; tag = H_ViewTag(ser(r*S))[0]; P = B_m + t*G; B_m = B + H_Label(ser32(s)||ser32(m))*G for m >= 1; addr = c32check(22 mainnet | 26 testnet, hash160(ser(P))); H_x = BIP-340 tagged hash "StacksStealth/x".',
  valid, invalid }, null, 2) + '\n');
console.log('wrote', valid.length, 'valid and', invalid.length, 'invalid vectors');
