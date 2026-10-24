// Regenerates vectors.json from PUBLIC strings. Every key here is a public throwaway test key.
import { writeFileSync } from 'node:fs';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { makeMetaAddress, derivePayment, spendKey, pubFromPriv } from '../stealth.js';
const h = s => bytesToHex(sha256(utf8ToBytes(s)));
const vectors = [];
for (let i = 1; i <= 6; i++) {
  const src = k => `stx-stealth PUBLIC TEST VECTOR ${i} ${k}`;
  const scanPriv = h(src('scan')), spendPriv = h(src('spend')), r = h(src('r'));
  const code = makeMetaAddress(pubFromPriv(scanPriv), pubFromPriv(spendPriv));
  const { addr, R, tag } = derivePayment(code, 26, r);
  vectors.push({ label: `vector ${i}: PUBLIC THROWAWAY TEST KEYS, never fund`, source: { scanPriv: `sha256("${src('scan')}")`, spendPriv: `sha256("${src('spend')}")`, r: `sha256("${src('r')}")` },
    scanPriv, spendPriv, r, code, R, tag, addr, spendKey: spendKey(scanPriv, spendPriv, R), version: 26 });
}
writeFileSync(new URL('../vectors.json', import.meta.url), JSON.stringify({
  warning: 'PUBLIC THROWAWAY TEST KEYS. Each key is sha256 of the public string shown in `source`. Anyone can spend from these addresses. Never send real funds.',
  scheme: 't = sha256("blip-stealth-v1" || compressed(r*S)) mod n; P = B + t*G; addr = c32check(26, hash160(compressed P)); tag = sha256("blip-stealth-tag-v1" || compressed(r*S))[0]; spendKey = (b + t) mod n (stacks.js form: spendKey + "01")',
  vectors }, null, 2) + '\n');
console.log('wrote', vectors.length, 'vectors');
