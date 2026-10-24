// stealth-announcer checks on a simulated chain (Clarinet SDK simnet). Throwaway keys only.
import { initSimnet } from '@stacks/clarinet-sdk';
import { Cl, cvToHex } from '@stacks/transactions';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { derivePayment, scan, parseMetaAddress } from '../stealth.js';

const kit = new URL('..', import.meta.url).pathname;
process.chdir(kit);
const simnet = await initSimnet('./Clarinet.toml');
const A = simnet.getAccounts(), dep = A.get('deployer'), w1 = A.get('wallet_1');
const w2 = A.get('wallet_2') || dep;
let fails = 0, passes = 0;
const chk = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); c ? passes++ : fails++; };
const P = r => Cl.prettyPrint(r.result);
const C = 'stealth-announcer', ANN = dep + '.' + C, TOKEN = dep + '.mock-token', TOKEN2 = dep + '.mock-token-noimpl';
const assets = () => simnet.getAssetsMap();
const bal = (a, asset = 'STX') => (assets().get(asset) || new Map()).get(a) || 0n;
const ftKey = name => { const k = [...assets().keys()].find(x => x === name); if (!k) throw new Error('no asset ' + name); return k; };
const count = () => P(simnet.callReadOnlyFn(C, 'get-count', [], w1));
const pay = (amt, to, eph, tag, who = w1) => simnet.callPublicFn(C, 'stealth-pay', [Cl.uint(amt), Cl.principal(to), Cl.bufferFromHex(eph), Cl.bufferFromHex(tag)], who);
const payFt = (tok, amt, to, eph, tag, who = w1) => simnet.callPublicFn(C, 'stealth-pay-ft', [Cl.principal(tok), Cl.uint(amt), Cl.principal(to), Cl.bufferFromHex(eph), Cl.bufferFromHex(tag)], who);
const printOf = r => r.events.find(e => e.event === 'print_event');

const V = JSON.parse(readFileSync(join(kit, 'vectors.json'), 'utf8')).vectors;
const v = V[0], v2 = V[1];

// the contract surface: only the two pay functions are public
const iface = simnet.getContractsInterfaces().get(ANN);
const pub = iface.functions.filter(f => f.access === 'public').map(f => f.name).sort();
chk(JSON.stringify(pub) === '["stealth-pay","stealth-pay-ft"]', 'only stealth-pay and stealth-pay-ft are public: ' + pub);
chk(iface.maps.length === 0 && iface.variables.filter(x => x.access === 'variable').length === 1, 'no maps, one data-var (the counter): ' + iface.variables.map(x => x.name));

// STX path
const payer0 = bal(w1), stealth0 = bal(v.addr);
let r = pay(5_000_000, v.addr, v.R, v.tag);
chk(P(r) === '(ok u1)', 'stealth-pay 5 STX to a fresh address: ' + P(r));
chk(bal(v.addr) - stealth0 === 5_000_000n, 'the fresh address got exactly 5 STX');
chk(payer0 - bal(w1) === 5_000_000n, 'the payer paid exactly 5 STX');
chk(bal(ANN) === 0n, 'the contract balance stays 0');
const tr = r.events.find(e => e.event === 'stx_transfer_event');
chk(tr && tr.data.sender === w1 && tr.data.recipient === v.addr && tr.data.amount === '5000000', 'transfer goes straight payer -> fresh address');
const pe = printOf(r);
const repr = pe ? Cl.prettyPrint(pe.data.value) : '';
chk(repr.includes('0x' + v.R) && repr.includes('tag: 0x' + v.tag) && repr.includes('event: "stealth"'), 'print event carries eph and tag: ' + repr);
chk(repr.includes("to: '" + v.addr) && repr.includes('amount: u5000000') && repr.includes("sender: '" + w1) && repr.includes('token: none'), 'print event carries to, amount, sender, token none');
chk(count() === 'u1', 'counter = 1');
// the receiver finds it from the event alone
const pv = pe.data.value.value;
const ev = { to: pv.to.value, eph: pv.eph.value, tag: pv.tag.value };
chk(scan(v.scanPriv, parseMetaAddress(v.code).spendPub, ev.eph, ev.tag, ev.to) === v.addr, 'JS scan of the decoded event finds the payment');
const dir = mkdtempSync(join(tmpdir(), 'stealth-ann-'));
try {
  const kf = join(dir, 'vector1-throwaway-keys.json');
  writeFileSync(kf, JSON.stringify({ scan: v.scanPriv, spend: v.spendPriv, note: 'PUBLIC THROWAWAY TEST VECTOR 1' }), { mode: 0o600 });
  const hex = cvToHex(pe.data.value);
  let p = spawnSync('python3', ['-I', join(kit, 'stealth.py'), 'scan-event', kf, hex], { encoding: 'utf8' });
  let o = p.status === 0 ? JSON.parse(p.stdout) : {};
  chk(o.addr === v.addr && o.amount === 5000000 && o.token === null && o.id === 1, 'python scan-event decodes the real Clarity print hex and finds it: ' + p.stdout.trim() + p.stderr);
  const kf2 = join(dir, 'vector2-throwaway-keys.json');
  writeFileSync(kf2, JSON.stringify({ scan: v2.scanPriv, spend: v2.spendPriv }), { mode: 0o600 });
  p = spawnSync('python3', ['-I', join(kit, 'stealth.py'), 'scan-event', kf2, hex], { encoding: 'utf8' });
  chk(p.status === 1 && p.stdout.trim() === 'no match', 'python scan-event with other keys: no match');

  // refusals (nothing moves, nothing printed, counter unchanged)
  const before = bal(w1);
  const refuse = (rr, code, m) => chk(P(rr) === code && !printOf(rr) && bal(w1) === before, m + ': ' + P(rr));
  refuse(pay(1, v.addr, '04' + v.R.slice(2), v.tag), '(err u401)', 'eph with 0x04 prefix refused');
  refuse(pay(1, v.addr, '00' + v.R.slice(2), v.tag), '(err u401)', 'eph with 0x00 prefix refused');
  refuse(pay(1, v.addr, v.R.slice(0, 64), v.tag), '(err u401)', '32-byte eph refused');
  refuse(pay(1, v.addr, '', v.tag), '(err u401)', 'empty eph refused');
  refuse(pay(0, v.addr, v.R, v.tag), '(err u400)', 'amount 0 refused');
  refuse(pay(1, v.addr, v.R, ''), '(err u402)', 'empty tag refused');
  refuse(pay(1, ANN, v.R, v.tag), '(err u403)', 'paying the contract itself refused');
  refuse(pay(1, w1, v.R, v.tag), '(err u2)', 'paying yourself refused (stx-transfer? err u2)');
  refuse(pay(before + 1n, v.addr, v.R, v.tag), '(err u1)', 'more than the balance refused (err u1)');
  chk(count() === 'u1', 'counter unchanged after refusals');
  chk(bal(ANN) === 0n, 'contract balance still 0');

  // SIP-010 path with the mock token (test only)
  r = simnet.callPublicFn('mock-token', 'mint', [Cl.uint(1000), Cl.principal(w1)], w1);
  chk(P(r) === '(ok true)', 'mint 1000 mock tokens to the payer');
  const FT = ftKey('.mock-token.mock');
  const ft0 = bal(w1, FT);
  r = payFt(TOKEN, 250, v2.addr, v2.R, v2.tag);
  chk(P(r) === '(ok u2)', 'stealth-pay-ft 250 mock to a fresh address: ' + P(r));
  chk(bal(v2.addr, FT) === 250n && ft0 - bal(w1, FT) === 250n, 'fresh address got 250, payer paid 250');
  chk(bal(ANN, FT) === 0n && bal(ANN) === 0n, 'contract holds 0 tokens and 0 STX');
  const fe = r.events.find(e => e.event === 'ft_transfer_event');
  chk(fe && fe.data.sender === w1 && fe.data.recipient === v2.addr, 'token goes straight payer -> fresh address');
  const fr = Cl.prettyPrint(printOf(r).data.value);
  chk(fr.includes('0x' + v2.R) && fr.includes('tag: 0x' + v2.tag) && fr.includes(`token: (some '${TOKEN})`), 'ft print event carries eph, tag, token: ' + fr);
  const ph = spawnSync('python3', ['-I', join(kit, 'stealth.py'), 'scan-event', kf2, cvToHex(printOf(r).data.value)], { encoding: 'utf8' });
  o = ph.status === 0 ? JSON.parse(ph.stdout) : {};
  chk(o.addr === v2.addr && o.amount === 250 && o.token === TOKEN, 'python scan-event finds the token payment: ' + ph.stdout.trim());
  const fb = bal(w1, FT);
  r = payFt(TOKEN, 1, v2.addr, '05' + v2.R.slice(2), v2.tag);
  chk(P(r) === '(err u401)' && bal(w1, FT) === fb, 'ft: bad eph refused');
  r = payFt(TOKEN, 0, v2.addr, v2.R, v2.tag);
  chk(P(r) === '(err u400)' && bal(w1, FT) === fb, 'ft: amount 0 refused');
  r = payFt(TOKEN, 1, v2.addr, v2.R, v2.tag, w2);
  chk(P(r) === '(err u1)' && bal(w1, FT) === fb, 'ft: another caller cannot spend the payer\'s tokens (always from tx-sender): ' + P(r));
  r = payFt(TOKEN, fb + 1n, v2.addr, v2.R, v2.tag);
  chk(P(r) === '(err u1)' && bal(w1, FT) === fb, 'ft: more than balance refused');

  // a token with the same shape but no impl-trait line also works (trait args are checked by shape)
  simnet.callPublicFn('mock-token-noimpl', 'mint', [Cl.uint(10), Cl.principal(w1)], w1);
  const FT2 = ftKey('.mock-token-noimpl.mock');
  r = payFt(TOKEN2, 10, V[2].addr, V[2].R, V[2].tag);
  chk(P(r) === '(ok u3)' && bal(V[2].addr, FT2) === 10n && bal(ANN, FT2) === 0n, 'shape-compatible token without impl-trait works: ' + P(r));
  chk(count() === 'u3', 'counter = 3');
} finally { rmSync(dir, { recursive: true, force: true }); }

console.log(`${passes} checks passed, ${fails} failed`);
console.log(fails ? 'FAILED ' + fails : 'ALL PASS');
process.exit(fails ? 1 : 0);
