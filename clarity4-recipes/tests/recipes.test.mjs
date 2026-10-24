// Checks all five recipes on a simulated chain (Clarinet SDK). Run: npm test
import { initSimnet } from '@stacks/clarinet-sdk';
import { Cl } from '@stacks/transactions';
import crypto from 'node:crypto';

const s = await initSimnet('./Clarinet.toml');
const A = s.getAccounts(), dep = A.get('deployer'), w1 = A.get('wallet_1'), w2 = A.get('wallet_2');
const pp = r => Cl.prettyPrint(r.result);
const stx = a => s.getAssetsMap().get('STX')?.get(a) ?? 0n;
const c = name => Cl.contractPrincipal(dep, name);
const pub = (n, f, args, who) => pp(s.callPublicFn(n, f, args, who));
const ro = (n, f, args) => pp(s.callReadOnlyFn(n, f, args, w1));
let fails = 0, n = 0;
const chk = (ok, m) => { n++; console.log((ok ? 'ok   ' : 'FAIL ') + m); if (!ok) fails++; };

console.log('\n1. Spending limit (restrict-assets?)');
let before = stx(w1);
let r = pub('spend-limit', 'call-with-limit', [c('honest-shop'), Cl.uint(10_000_000)], w1);
chk(r === '(ok true)' && before - stx(w1) === 5_000_000n, `honest shop takes 5 STX under a 10 STX limit: ${r}`);
before = stx(w1);
r = pub('spend-limit', 'call-with-limit', [c('greedy-shop'), Cl.uint(10_000_000)], w1);
chk(r === '(err u0)' && stx(w1) === before, `greedy shop trying 500 STX is stopped and nothing moves: ${r}`);
r = pub('spend-limit', 'call-with-limit', [c('greedy-shop'), Cl.uint(600_000_000)], w1);
chk(r === '(ok true)', `same shop works if you knowingly allow 600 STX: ${r}`);

console.log('\n2. Capped vault (as-contract?)');
pub('capped-vault', 'tip', [Cl.uint(50_000_000)], w1);
chk(ro('capped-vault', 'balance', []) === 'u50000000', 'vault holds 50 STX of tips');
r = pub('capped-vault', 'pay-out', [Cl.uint(5_000_000), Cl.principal(w2)], w1);
chk(r === '(err u100)', `a stranger can't pay out: ${r}`);
r = pub('capped-vault', 'pay-out', [Cl.uint(8_000_000), Cl.principal(w2)], dep);
chk(r === '(ok true)', `owner pays out 8 STX (under the 10 STX cap): ${r}`);
r = pub('capped-vault', 'pay-out', [Cl.uint(20_000_000), Cl.principal(w2)], dep);
chk(r === '(err u0)', `owner can't pay out 20 STX in one go: ${r}`);
r = pub('capped-vault', 'buggy-pay-everything', [Cl.principal(w2)], dep);
chk(r === '(err u0)' && ro('capped-vault', 'balance', []) === 'u42000000', `the buggy "send everything" is stopped, 42 STX still there: ${r}`);

console.log('\n3. Audited code (contract-hash?)');
chk(ro('audited-code', 'is-audited', [c('template-a')]) === 'false', 'nothing is audited before the owner approves');
r = pub('audited-code', 'approve-code-of', [c('template-a'), Cl.stringAscii('reviewed 2026-10')], w1);
chk(r === '(err u100)', `a stranger can't approve: ${r}`);
r = pub('audited-code', 'approve-code-of', [c('template-a'), Cl.stringAscii('reviewed 2026-10')], dep);
chk(r === '(ok true)', `owner approves template-a's code: ${r}`);
chk(ro('audited-code', 'is-audited', [c('template-a')]) === 'true', 'template-a counts as audited');
chk(ro('audited-code', 'is-audited', [c('template-copy')]) === 'true', 'an exact copy under another name also counts');
chk(ro('audited-code', 'is-audited', [c('template-edited')]) === 'false', 'a copy with one comment changed does NOT count');
chk(ro('audited-code', 'is-audited', [Cl.principal(w1)]) === 'false', 'a plain wallet address is never "audited"');

console.log('\n4. Deadlines (stacks-block-time)');
r = pub('deadline', 'open-challenge', [Cl.uint(51900)], w1);
chk(r === '(ok u1)', `challenge 1 opened: ${r}`);
const left = Number(ro('deadline', 'seconds-left', [Cl.uint(1)]).slice(1));
chk(left > 86000 && left <= 86400, `about 24 hours left: ${left} s`);
s.mineEmptyBlocks(10);
r = pub('deadline', 'answer', [Cl.uint(1), Cl.uint(60000)], w2);
chk(r === '(ok true)', `friend answers in time and beats it: ${r}`);
r = pub('deadline', 'answer', [Cl.uint(1), Cl.uint(70000)], w2);
chk(r === '(err u102)', `can't answer twice: ${r}`);
pub('deadline', 'open-challenge', [Cl.uint(100)], w1);
s.mineEmptyBlocks(150);
r = pub('deadline', 'answer', [Cl.uint(2), Cl.uint(200)], w2);
chk(r === '(err u101)', `answer after 24 hours is refused: ${r}`);
chk(ro('deadline', 'seconds-left', [Cl.uint(2)]) === 'u0', 'seconds-left shows 0 after the deadline');

console.log('\n5. Device key (secp256r1-verify)');
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = publicKey.export({ format: 'jwk' });
const y = Buffer.from(jwk.y, 'base64url');
const key33 = Buffer.concat([Buffer.from([y[31] & 1 ? 3 : 2]), Buffer.from(jwk.x, 'base64url')]);
const msg = crypto.createHash('sha256').update('genesis-run week 42 score 51900').digest();
// WebCrypto-style: ECDSA with SHA-256 over the 32-byte message.
const sign = m => crypto.sign('sha256', m, { key: privateKey, dsaEncoding: 'ieee-p1363' });
r = pub('device-key', 'submit', [Cl.principal(w1), Cl.buffer(msg), Cl.buffer(sign(msg))], w2);
chk(r === '(err u100)', `no key registered yet: ${r}`);
pub('device-key', 'register-key', [Cl.buffer(key33)], w1);
r = pub('device-key', 'submit', [Cl.principal(w1), Cl.buffer(msg), Cl.buffer(sign(msg))], w2);
chk(r === '(ok true)', `a signature from the registered device key is accepted: ${r}`);
chk(ro('device-key', 'signer-of', [Cl.buffer(msg)]) === `(some '${w1})`, 'the message is recorded as signed by wallet_1');
r = pub('device-key', 'submit', [Cl.principal(w1), Cl.buffer(msg), Cl.buffer(sign(msg))], w2);
chk(r === '(err u102)', `the same message can't be replayed: ${r}`);
const msg2 = crypto.createHash('sha256').update('genesis-run week 42 score 99999').digest();
r = pub('device-key', 'submit', [Cl.principal(w1), Cl.buffer(msg2), Cl.buffer(sign(msg))], w2);
chk(r === '(err u101)', `an old signature on a changed score is rejected: ${r}`);
let ok20 = 0;
for (let i = 0; i < 20; i++) {
  const m = crypto.randomBytes(32);
  if (pub('device-key', 'submit', [Cl.principal(w1), Cl.buffer(m), Cl.buffer(sign(m))], w2) === '(ok true)') ok20++;
}
chk(ok20 === 20, `20 fresh signatures in a row all check out: ${ok20}/20`);
// The quirk: a signature made over a 32-byte hash AS the digest (common in
// other tools) fails here, because Clarity 4 hashes the 32 bytes again.
const preimage = 'some longer data';
const digest = crypto.createHash('sha256').update(preimage).digest();
const overDigest = crypto.sign('sha256', Buffer.from(preimage), { key: privateKey, dsaEncoding: 'ieee-p1363' });
chk(pub('device-key', 'submit', [Cl.principal(w1), Cl.buffer(digest), Cl.buffer(overDigest)], w2) === '(err u101)', 'quirk confirmed: a signature over a ready-made hash does not check in Clarity 4');

console.log(`\n${n - fails}/${n} checks pass` + (fails ? `, ${fails} FAILED` : ''));
process.exit(fails ? 1 : 0);
