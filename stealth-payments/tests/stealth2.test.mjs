// stealth2.js / stealth2.py checks (scheme v2): fixed vectors, every one-character typo rejected,
// Python agreement, stacks.js address agreement, labels, 200 random round trips. Throwaway keys only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { getAddressFromPrivateKey } from '@stacks/transactions';
import * as S from '../stealth2.js';

const kit = new URL('..', import.meta.url).pathname;
let fails = 0, passes = 0;
const chk = (c, m) => { if (c) passes++; else { fails++; console.log('FAIL ' + m); } return c; };
const say = m => console.log('ok   ' + m);
const randKey = () => bytesToHex(secp256k1.utils.randomSecretKey());
const throws = f => { try { f(); return false; } catch { return true; } };

// 1. fixed vectors
const VV = JSON.parse(readFileSync(join(kit, 'vectors2.json'), 'utf8'));
for (const v of VV.valid) {
  const code = v.label ? S.encodeLabelledCode(v.scanPriv, v.spendPub, v.label, v.network) : S.encodeCode(S.pubFromPriv(v.scanPriv), v.spendPub, v.network);
  chk(code === v.code, v.comment + ': code');
  const d = S.derivePayment(code, v.r);
  chk(d.addr === v.addr && d.R === v.R && d.tag === v.tag && d.network === v.network, v.comment + ': derivePayment');
  chk(d.addr.startsWith(v.network === 'mainnet' ? 'SP' : 'ST'), v.comment + ': address is for the code\'s network');
  const found = S.scan(v.scanPriv, v.spendPub, v.R, v.tag, v.addr, v.network, [1, 3, 7]);
  chk(found && found.addr === v.addr && found.label === v.label, v.comment + ': scan finds it with the right label');
  chk(S.spendKey(v.scanPriv, v.spendPriv, v.R, v.label) === v.spendKey, v.comment + ': spendKey');
  chk(getAddressFromPrivateKey(v.spendKey + '01', v.network) === v.addr, v.comment + ': stacks.js agrees the spend key opens the address');
}
for (const v of VV.invalid) chk(throws(() => S.decodeCode(v.code)), 'invalid vector rejected: ' + v.comment);
say(`${VV.valid.length} valid + ${VV.invalid.length} invalid fixed vectors`);

// 2. every single-character typo of a code is rejected (bech32m catches all of them)
const good = VV.valid[0].code, B32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
let typos = 0, caught = 0;
for (let i = good.indexOf('1') + 1; i < good.length; i++) for (const c of B32) {
  if (c === good[i]) continue; typos++;
  if (throws(() => S.decodeCode(good.slice(0, i) + c + good.slice(i + 1)))) caught++;
}
chk(typos > 3000 && caught === typos, `typos caught ${caught}/${typos}`);
say(`every one-character typo is rejected: ${caught}/${typos}`);

// 3. network is required, never a silent default
chk(throws(() => S.encodeCode(S.pubFromPriv(randKey()), S.pubFromPriv(randKey()))), 'encodeCode without a network throws');
chk(throws(() => S.scan(randKey(), S.pubFromPriv(randKey()), VV.valid[0].R, '00', 'ST000', undefined)), 'scan without a network throws');
chk(throws(() => S.labelTweak(randKey(), 0)), 'label 0 is refused');
say('network must be stated; label 0 refused');

// 4. Python agreement: fixed vectors + random cases through one python process
const cases = [];
for (let i = 0; i < 200; i++) {
  const s = randKey(), b = randKey(), r = randKey(), network = i % 3 ? 'testnet' : 'mainnet', label = i % 4 === 0 ? 1 + (i % 9) : 0;
  const B = S.pubFromPriv(b);
  const code = label ? S.encodeLabelledCode(s, B, label, network) : S.encodeCode(S.pubFromPriv(s), B, network);
  const d = S.derivePayment(code, r);
  const found = S.scan(s, B, d.R, d.tag, d.addr, network, label ? [label] : []);
  chk(found && found.addr === d.addr && found.label === label, `random ${i}: scan`);
  const p = S.spendKey(s, b, d.R, label);
  chk(getAddressFromPrivateKey(p + '01', network) === d.addr, `random ${i}: stacks.js address`);
  chk(S.scan(randKey(), B, d.R, d.tag, d.addr, network, [label || 1]) === null, `random ${i}: a stranger's scan key finds nothing`);
  cases.push({ s, b, r, network, label, code, addr: d.addr, R: d.R, tag: d.tag, p });
}
const pyScript = `
import json, sys
sys.path.insert(0, ${JSON.stringify(kit)})
import stealth2 as S
from stealth import scalar, compress, _mul
out = []
for c in json.load(sys.stdin):
    s, b, r = scalar(c["s"]), scalar(c["b"]), scalar(c["r"])
    B = compress(_mul(b))
    code = S.encode_code(compress(_mul(s)), S.labelled_spend_pub(s, B, c["label"]) if c["label"] else B, c["network"])
    d = S.derive_payment(code, r)
    f = S.scan(s, B, d["R"], d["tag"], d["addr"], c["network"], [c["label"]] if c["label"] else [])
    out.append([code == c["code"], d["addr"] == c["addr"], d["R"].hex() == c["R"], "%02x" % d["tag"] == c["tag"], f == (c["addr"], c["label"]), S.spend_key(s, b, d["R"], c["label"]) == c["p"]])
bad = 0
for v in json.load(open(${JSON.stringify(join(kit, 'vectors2.json'))}))["invalid"]:
    try: S.decode_code(v["code"])
    except Exception: continue
    bad += 1
print(json.dumps({"rows": out, "invalid_accepted": bad}))
`;
const res = spawnSync('python3', ['-I', '-c', pyScript], { input: JSON.stringify(cases), encoding: 'utf8' });
if (res.status !== 0) { console.log(res.stderr); chk(false, 'python ran'); }
else {
  const { rows, invalid_accepted } = JSON.parse(res.stdout);
  const allOk = rows.every(r => r.every(Boolean));
  chk(allOk && rows.length === 200, 'python matches JS on 200 random cases');
  chk(invalid_accepted === 0, 'python rejects every invalid vector');
  say(`python and JS agree on 200 random cases (codes, addresses, R, tags, labels, spend keys); python rejects all ${VV.invalid.length} invalid vectors`);
}
say('200 random round trips: scan finds, stacks.js opens, strangers find nothing');

console.log(`\n${passes} checks passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
