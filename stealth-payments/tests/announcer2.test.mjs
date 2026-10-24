// stealth-announcer-v2 + stealth-registry checks on a simulated chain, including the REAL sBTC token
// contract that Clarinet's simnet ships, fake tokens, and a 600-step random stress test.
import { initSimnet } from '@stacks/clarinet-sdk';
import { Cl } from '@stacks/transactions';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import * as S from '../stealth2.js';

const kit = new URL('..', import.meta.url).pathname;
process.chdir(kit);
const s = await initSimnet('./Clarinet.toml');
const A = s.getAccounts(), dep = A.get('deployer'), w1 = A.get('wallet_1'), w2 = A.get('wallet_2');
let fails = 0, passes = 0;
const chk = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); c ? passes++ : fails++; };
const P = r => Cl.prettyPrint(r.result);
const C = 'stealth-announcer-v2', ANN = dep + '.' + C;
const SBTC = 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token';
const bal = (a, asset = 'STX') => (s.getAssetsMap().get(asset) || new Map()).get(a) || 0n;
const sbtc = a => bal(a, '.sbtc-token.sbtc-token');
const payStx = (amt, d, who = w1) => s.callPublicFn(C, 'stealth-pay', [Cl.uint(amt), Cl.principal(d.addr), Cl.bufferFromHex(d.R), Cl.bufferFromHex(d.tag)], who);
const payFt = (tok, amt, gas, d, who = w1) => s.callPublicFn(C, 'stealth-pay-ft', [Cl.principal(tok), Cl.uint(amt), Cl.uint(gas), Cl.principal(d.addr), Cl.bufferFromHex(d.R), Cl.bufferFromHex(d.tag)], who);
const randKey = () => bytesToHex(secp256k1.utils.randomSecretKey());
const newCode = () => { const sk = randKey(), bk = randKey(); return { sk, bk, code: S.encodeCode(S.pubFromPriv(sk), S.pubFromPriv(bk), 'testnet') }; };

// surface
const iface = s.getContractsInterfaces().get(ANN);
const pub = iface.functions.filter(f => f.access === 'public').map(f => f.name).sort();
chk(JSON.stringify(pub) === '["stealth-pay","stealth-pay-ft"]', 'only the two pay functions are public: ' + pub);
chk(!readFileSync(join(kit, 'stealth-announcer-v2.clar'), 'utf8').match(/as-contract|define-constant OWNER|var-set owner/), 'no as-contract, no owner in the contract source');

// STX
const me = newCode();
let d = S.derivePayment(me.code);
let b0 = bal(w1);
let r = payStx(5_000_000, d);
chk(P(r) === '(ok u1)' && bal(d.addr) === 5_000_000n && b0 - bal(w1) === 5_000_000n, 'STX goes straight from payer to the fresh address');
chk(bal(ANN) === 0n, 'contract holds 0 STX');
const ev = r.events.find(e => e.event === 'print_event');
chk(/v: u2/.test(Cl.prettyPrint(ev.data.value)) && /gas: u0/.test(Cl.prettyPrint(ev.data.value)), 'print event says v2 and gas 0');
const f = S.scan(me.sk, S.pubFromPriv(me.bk), d.R, d.tag, d.addr, 'testnet');
chk(f && f.addr === d.addr, 'the receiver\'s scan finds the payment from the event fields');
chk(P(payStx(1, d)) === '(err u404)', 'the same one-time key (eph) can\'t be used twice');
chk(P(payStx(0, S.derivePayment(me.code))) === '(err u400)', 'amount 0 refused');
const main = S.derivePayment(S.encodeCode(S.pubFromPriv(me.sk), S.pubFromPriv(me.bk), 'mainnet'));
chk(P(payStx(1, main)) === '(err u403)', 'a mainnet address is refused on testnet (is-standard)');
chk(P(s.callPublicFn(C, 'stealth-pay', [Cl.uint(1), Cl.principal(dep + '.stealth-registry'), Cl.bufferFromHex(S.derivePayment(me.code).R), Cl.bufferFromHex('00')], w1)) === '(err u403)', 'a contract address is refused (fresh addresses are always plain addresses)');
chk(P(s.callPublicFn(C, 'stealth-pay', [Cl.uint(1), Cl.principal(w2), Cl.bufferFromHex('04' + '11'.repeat(32)), Cl.bufferFromHex('00')], w1)) === '(err u401)', 'a bad eph is refused');

// real sBTC with gas
d = S.derivePayment(me.code);
const sb0 = sbtc(w1), st0 = bal(w1);
r = payFt(SBTC, 2500, 100_000, d);
chk(P(r) === '(ok u2)', 'stealth-pay-ft with the real sBTC contract: ' + P(r));
chk(sbtc(d.addr) === 2500n && sb0 - sbtc(w1) === 2500n, 'exactly 2,500 sats of sBTC went straight to the fresh address');
chk(bal(d.addr) === 100_000n && st0 - bal(w1) === 100_000n, 'plus 0.1 STX for future fees, from the payer, to the same address');
chk(sbtc(ANN) === 0n && bal(ANN) === 0n, 'contract holds 0 sBTC and 0 STX');

// the fresh address can move its sBTC itself (no sponsor): spend key -> address -> transfer
const p = S.spendKey(me.sk, me.bk, d.R);
const { getAddressFromPrivateKey } = await import('@stacks/transactions');
chk(getAddressFromPrivateKey(p + '01', 'testnet') === d.addr, 'the spend key opens the fresh address');
r = s.callPublicFn(SBTC, 'transfer', [Cl.uint(1000), Cl.principal(d.addr), Cl.principal(w2), Cl.none()], d.addr);
chk(P(r) === '(ok true)' && sbtc(w2) > 0n, 'the fresh address sends its own sBTC onward (simnet signs as that address)');

// fake tokens
for (const t of ['evil-token', 'greedy-token', 'mock-token']) s.callPublicFn(t, 'mint', [Cl.uint(10_000), Cl.principal(w1)], dep);
b0 = bal(w1);
r = payFt(dep + '.evil-token', 100, 0, S.derivePayment(me.code));
chk(P(r).startsWith('(err') && bal(w1) === b0, `a fake token that also grabs the payer's STX is stopped, payer loses nothing: ${P(r)}`);
const g0 = bal(w1, '.greedy-token.greedy');
r = payFt(dep + '.greedy-token', 100, 0, S.derivePayment(me.code));
chk(P(r) === '(err u0)' && bal(w1, '.greedy-token.greedy') === g0, 'a fake token that moves more than the amount is stopped');
chk(P(payFt(dep + '.mock-token', 100, 0, S.derivePayment(me.code))) === '(ok u3)', 'an honest token with gas 0 works');

// registry
const scanPub = S.pubFromPriv(me.sk), spendPub = S.pubFromPriv(me.bk);
r = s.callPublicFn('stealth-registry', 'set-code', [Cl.uint(0), Cl.bufferFromHex(scanPub), Cl.bufferFromHex(spendPub)], w2);
chk(P(r) === '(ok true)', 'registry: wallet_2 publishes its pay-me keys');
const got = Cl.prettyPrint(s.callReadOnlyFn('stealth-registry', 'get-code', [Cl.principal(w2)], w1).result);
chk(got.includes(scanPub) && got.includes(spendPub), 'registry: anyone reads them back');
const rebuilt = S.encodeCode(scanPub, spendPub, 'testnet');
chk(S.decodeCode(rebuilt).spendPub === spendPub, 'registry keys rebuild a working pay-me code');
chk(P(s.callPublicFn('stealth-registry', 'set-code', [Cl.uint(0), Cl.bufferFromHex('04' + '11'.repeat(32)), Cl.bufferFromHex(spendPub)], w2)) === '(err u410)', 'registry: bad key refused');
chk(P(s.callPublicFn('stealth-registry', 'set-code', [Cl.uint(1), Cl.bufferFromHex(scanPub), Cl.bufferFromHex(spendPub)], w2)) === '(err u411)', 'registry: unknown version refused');
s.callPublicFn('stealth-registry', 'clear-code', [], w1);
chk(Cl.prettyPrint(s.callReadOnlyFn('stealth-registry', 'get-code', [Cl.principal(w2)], w1).result) !== 'none', 'registry: someone else clearing does not touch wallet_2\'s entry');
s.callPublicFn('stealth-registry', 'clear-code', [], w2);
chk(Cl.prettyPrint(s.callReadOnlyFn('stealth-registry', 'get-code', [Cl.principal(w2)], w1).result) === 'none', 'registry: wallet_2 clears its own entry');
const rif = s.getContractsInterfaces().get(dep + '.stealth-registry');
chk(JSON.stringify(rif.functions.filter(x => x.access === 'public').map(x => x.name).sort()) === '["clear-code","set-code"]', 'registry: only set-code and clear-code are public (no admin)');

// random stress test: 600 random calls, good and bad; the contract must never hold anything,
// every success must move exactly what it says, and every failure must move nothing.
const payers = [w1, w2, dep], toks = [SBTC, dep + '.mock-token', dep + '.evil-token', dep + '.greedy-token'];
for (const t of toks.slice(1)) for (const w of payers) s.callPublicFn(t.split('.')[1], 'mint', [Cl.uint(1_000_000), Cl.principal(w)], dep);
let okCalls = 0, errCalls = 0, broken = 0;
const assetKeys = () => [...s.getAssetsMap().keys()];
const snapshot = who => Object.fromEntries(assetKeys().map(k => [k, bal(who, k)]));
const rnd = n => Math.floor(Math.random() * n);
for (let i = 0; i < 600; i++) {
  const who = payers[rnd(3)], dd = S.derivePayment(newCode().code);
  if (rnd(10) === 0) dd.tag = 'zz'.replace(/z/g, () => '0123456789abcdef'[rnd(16)]) + (rnd(5) === 0 ? '00' : '');
  const before = snapshot(who), toBefore = snapshot(dd.addr);
  let res, amt = rnd(8) === 0 ? 0 : 1 + rnd(5000), gas = rnd(3) === 0 ? rnd(200_000) : 0, tok = null;
  try {
    if (rnd(2)) res = s.callPublicFn(C, 'stealth-pay', [Cl.uint(amt), Cl.principal(dd.addr), Cl.bufferFromHex(dd.R), Cl.bufferFromHex(dd.tag)], who);
    else { tok = toks[rnd(4)]; res = s.callPublicFn(C, 'stealth-pay-ft', [Cl.principal(tok), Cl.uint(amt), Cl.uint(gas), Cl.principal(dd.addr), Cl.bufferFromHex(dd.R), Cl.bufferFromHex(dd.tag)], who); }
  } catch { res = { result: Cl.error(Cl.uint(999)) }; } // a wrong-size tag is rejected before the contract runs
  const after = snapshot(who), toAfter = snapshot(dd.addr), ok = P(res).startsWith('(ok');
  for (const k of assetKeys()) if (bal(ANN, k) !== 0n) broken++;
  if (ok) {
    okCalls++;
    const key = tok ? (tok === SBTC ? '.sbtc-token.sbtc-token' : '.' + tok.split('.')[1] + '.' + { 'mock-token': 'mock', 'evil-token': 'evil', 'greedy-token': 'greedy' }[tok.split('.')[1]]) : 'STX';
    const stxSent = tok ? BigInt(gas) : BigInt(amt);
    if ((toAfter.STX || 0n) - (toBefore.STX || 0n) !== stxSent || (before.STX || 0n) - (after.STX || 0n) !== stxSent) broken++;
    if (tok && ((toAfter[key] || 0n) - (toBefore[key] || 0n) !== BigInt(amt))) broken++;
    for (const k of assetKeys()) if (k !== 'STX' && k !== key && (before[k] || 0n) !== (after[k] || 0n)) broken++;
  } else {
    errCalls++;
    for (const k of assetKeys()) if ((before[k] || 0n) !== (after[k] || 0n)) broken++;
  }
}
chk(broken === 0 && okCalls > 150 && errCalls > 150, `stress test: ${okCalls} successful + ${errCalls} refused random calls, contract always empty, amounts always exact, refusals move nothing (problems: ${broken})`);

console.log(`\n${passes} checks passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
