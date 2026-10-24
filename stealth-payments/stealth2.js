// stealth2.js: fresh-address (stealth address) payments for Stacks, scheme v2. See SPEC.md.
// TESTNET ONLY until reviewed. ES module for browsers and node; depends only on @noble/curves + @noble/hashes.
//
// What changed from v1 (stealth.js):
// - Pay-me codes are bech32m with a checksum and say which network they're for:
//   "spstx1q..." (mainnet) or "tspstx1q..." (testnet). A typo fails the checksum instead of
//   sending money to a key nobody holds. The payer never chooses the network; the code does.
// - BIP-340 style tagged hashes with neutral names ("StacksStealth/...").
// - Optional labels (as in BIP-352): one person can hand out separate codes for tips,
//   payroll and donations, and scan them all with one scan key.
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { bytesToHex, hexToBytes, concatBytes, utf8ToBytes, randomBytes } from '@noble/hashes/utils.js';

const Point = secp256k1.Point;
export const N = Point.Fn.ORDER;
export const NETWORKS = {
  mainnet: { hrp: 'spstx', version: 22 }, // SP... addresses
  testnet: { hrp: 'tspstx', version: 26 }, // ST... addresses
};
export const CODE_VERSION = 0;
const C32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// ---------- small helpers ----------
const toBytes = (x, what) => {
  if (x instanceof Uint8Array) return x;
  if (typeof x === 'string' && /^(0x)?([0-9a-fA-F]{2})*$/.test(x)) return hexToBytes(x.replace(/^0x/, '').toLowerCase());
  throw new Error(`${what}: expected hex string or Uint8Array`);
};
const bytesToBig = b => BigInt('0x' + (bytesToHex(b) || '0'));
const bigTo32 = n => hexToBytes(n.toString(16).padStart(64, '0'));
const ser32 = n => { if (n < 0 || n > 0xffffffff || !Number.isInteger(n)) throw new Error('label must be an integer 1..2^32-1'); return Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255); };

export function scalar(k, what = 'key') {
  let b = toBytes(k, what);
  if (b.length === 33 && b[32] === 1) b = b.slice(0, 32);
  if (b.length !== 32) throw new Error(`${what}: must be 32 bytes`);
  const n = bytesToBig(b);
  if (n <= 0n || n >= N) throw new Error(`${what}: out of range`);
  return n;
}
export function point(pub, what = 'public key') {
  const b = toBytes(pub, what);
  if (b.length !== 33 || (b[0] !== 2 && b[0] !== 3)) throw new Error(`${what}: must be 33-byte compressed (02/03)`);
  const P = Point.fromBytes(b);
  P.assertValidity();
  return P;
}
export const pubFromPriv = priv => bytesToHex(Point.BASE.multiply(scalar(priv)).toBytes(true));
export const hash160 = b => ripemd160(sha256(b));

/** BIP-340 tagged hash: sha256(sha256(tag) || sha256(tag) || msg). */
export function taggedHash(tag, msg) {
  const th = sha256(utf8ToBytes(tag));
  return sha256(concatBytes(th, th, msg));
}
const TAG_SHARED = 'StacksStealth/SharedSecret';
const TAG_VIEW = 'StacksStealth/ViewTag';
const TAG_LABEL = 'StacksStealth/Label';

// ---------- Stacks c32check addresses ----------
function c32encode(bytes) {
  let n = bytesToBig(bytes), s = '';
  while (n > 0n) { s = C32[Number(n % 32n)] + s; n /= 32n; }
  let lead = 0; while (lead < bytes.length && bytes[lead] === 0) lead++;
  return '0'.repeat(lead) + s;
}
export function c32address(version, h160) {
  const h = toBytes(h160, 'hash160');
  if (h.length !== 20 || !Number.isInteger(version) || version < 0 || version > 31) throw new Error('bad address input');
  const chk = sha256(sha256(concatBytes(Uint8Array.of(version), h))).slice(0, 4);
  return 'S' + C32[version] + c32encode(concatBytes(h, chk));
}

// ---------- bech32m (BIP-350), length limit lifted to 1023 as in BIP-352 ----------
const B32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32M = 0x2bc830a3;
function polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}
const hrpExpand = hrp => [...hrp].map(c => c.charCodeAt(0) >> 5).concat([0], [...hrp].map(c => c.charCodeAt(0) & 31));
function convertBits(data, from, to, pad) {
  let acc = 0, bits = 0; const out = [], maxv = (1 << to) - 1;
  for (const v of data) {
    if (v < 0 || v >> from) throw new Error('bad data');
    acc = (acc << from) | v; bits += from;
    while (bits >= to) { bits -= to; out.push((acc >> bits) & maxv); }
  }
  if (pad) { if (bits) out.push((acc << (to - bits)) & maxv); }
  else if (bits >= from || ((acc << (to - bits)) & maxv)) throw new Error('bad padding');
  return out;
}
export function bech32mEncode(hrp, data5) {
  const pm = polymod(hrpExpand(hrp).concat(data5, [0, 0, 0, 0, 0, 0])) ^ BECH32M;
  const chk = [0, 1, 2, 3, 4, 5].map(i => (pm >>> (5 * (5 - i))) & 31);
  return hrp + '1' + data5.concat(chk).map(d => B32[d]).join('');
}
export function bech32mDecode(str) {
  if (typeof str !== 'string' || str.length > 1023) throw new Error('code too long or not a string');
  if (str !== str.toLowerCase() && str !== str.toUpperCase()) throw new Error('mixed case');
  const s = str.toLowerCase(), pos = s.lastIndexOf('1');
  if (pos < 1 || pos + 7 > s.length) throw new Error('bad separator');
  const hrp = s.slice(0, pos), data = [];
  for (const c of s.slice(pos + 1)) { const d = B32.indexOf(c); if (d < 0) throw new Error('bad character'); data.push(d); }
  if (polymod(hrpExpand(hrp).concat(data)) !== BECH32M) throw new Error('checksum failed (typo?)');
  return { hrp, data: data.slice(0, -6) };
}

// ---------- pay-me codes ----------
export function networkOf(name) {
  const n = NETWORKS[name];
  if (!n) throw new Error('network must be "mainnet" or "testnet"');
  return n;
}

/** Make a pay-me code from the two public keys. `network` is required, so it's never a silent default. */
export function encodeCode(scanPub, spendPub, network) {
  const { hrp } = networkOf(network);
  const S = point(scanPub, 'scan public key'), B = point(spendPub, 'spend public key');
  const payload = concatBytes(S.toBytes(true), B.toBytes(true));
  return bech32mEncode(hrp, [CODE_VERSION].concat(convertBits(payload, 8, 5, true)));
}

/** Parse a code. Returns { network, version, scanPub, spendPub }. Throws on any typo or unknown network. */
export function decodeCode(code) {
  const { hrp, data } = bech32mDecode(typeof code === 'string' ? code.trim() : code);
  const network = Object.keys(NETWORKS).find(k => NETWORKS[k].hrp === hrp);
  if (!network) throw new Error(`unknown code prefix "${hrp}"`);
  if (data.length < 1 || data[0] !== CODE_VERSION) throw new Error('unsupported code version');
  const payload = Uint8Array.from(convertBits(data.slice(1), 5, 8, false));
  if (payload.length !== 66) throw new Error('code must carry two 33-byte keys');
  const scanPub = bytesToHex(payload.slice(0, 33)), spendPub = bytesToHex(payload.slice(33));
  point(scanPub, 'scan public key'); point(spendPub, 'spend public key');
  return { network, version: NETWORKS[network].version, scanPub, spendPub };
}

// ---------- labels ----------
/** Label tweak for label m (1..2^32-1): taggedHash("StacksStealth/Label", ser32(s) || ser32(m)) mod n. */
export function labelTweak(scanPriv, m) {
  if (m === 0) throw new Error('label 0 means "no label"; use 1 or higher');
  const s = scalar(scanPriv, 'scan private key');
  const t = bytesToBig(taggedHash(TAG_LABEL, concatBytes(bigTo32(s), ser32(m)))) % N;
  if (t === 0n) throw new Error('degenerate label');
  return t;
}
/** The labelled spend public key B_m = B + labelTweak*G. */
export function labelledSpendPub(scanPriv, spendPub, m) {
  return bytesToHex(point(spendPub, 'spend public key').add(Point.BASE.multiply(labelTweak(scanPriv, m))).toBytes(true));
}
/** A labelled pay-me code (e.g. one for tips, one for payroll). Needs the scan private key, so make it on your own machine. */
export function encodeLabelledCode(scanPriv, spendPub, m, network) {
  return encodeCode(pubFromPriv(scanPriv), labelledSpendPub(scanPriv, spendPub, m), network);
}

// ---------- payer and receiver ----------
function fromShared(sharedPoint) {
  const sb = sharedPoint.toBytes(true);
  const t = bytesToBig(taggedHash(TAG_SHARED, sb)) % N;
  const tag = taggedHash(TAG_VIEW, sb)[0];
  return { t, tag };
}

/** Payer side. The network comes from the code. Returns { addr, R, tag, network } (hex). `rand` only for tests. */
export function derivePayment(code, rand) {
  const { scanPub, spendPub, network, version } = decodeCode(code);
  const S = point(scanPub), B = point(spendPub);
  for (let tries = 0; tries < 64; tries++) {
    let r;
    if (rand !== undefined) r = scalar(rand, 'rand');
    else { r = bytesToBig(randomBytes(32)); if (r <= 0n || r >= N) continue; }
    const { t, tag } = fromShared(S.multiply(r));
    const P = t === 0n ? null : B.add(Point.BASE.multiply(t));
    if (P === null || P.is0()) { if (rand !== undefined) throw new Error('degenerate rand'); continue; }
    return { addr: c32address(version, hash160(P.toBytes(true))), R: bytesToHex(Point.BASE.multiply(r).toBytes(true)),
      tag: tag.toString(16).padStart(2, '0'), network };
  }
  throw new Error('could not derive a payment');
}

/**
 * Receiver side. Checks the 1-byte view tag first, then the address for the base key and each label.
 * `labels` is a list of label numbers you've handed out (may be empty).
 * Returns { addr, label } (label 0 = no label) or null. `to` is the announced address and is required.
 */
export function scan(scanPriv, spendPub, R, tag, to, network, labels = []) {
  const { version } = networkOf(network);
  const tg = toBytes(tag, 'tag');
  if (tg.length !== 1) throw new Error('tag must be 1 byte');
  if (typeof to !== 'string') throw new Error('pass the announced address `to`');
  const s = scalar(scanPriv, 'scan private key');
  const { t, tag: mine } = fromShared(point(R, 'R').multiply(s));
  if (mine !== tg[0] || t === 0n) return null;
  const tG = Point.BASE.multiply(t), B = point(spendPub, 'spend public key');
  for (const m of [0, ...labels]) {
    const Bm = m === 0 ? B : B.add(Point.BASE.multiply(labelTweak(scanPriv, m)));
    const P = Bm.add(tG);
    if (P.is0()) continue;
    if (c32address(version, hash160(P.toBytes(true))) === to) return { addr: to, label: m };
  }
  return null;
}

/** One-time private key p = (b + labelTweak + t) mod n, as 64 hex. For stacks.js use p + '01'. */
export function spendKey(scanPriv, spendPriv, R, label = 0) {
  const b = scalar(spendPriv, 'spend private key'), s = scalar(scanPriv, 'scan private key');
  const { t } = fromShared(point(R, 'R').multiply(s));
  const p = (b + (label ? labelTweak(scanPriv, label) : 0n) + t) % N;
  if (p === 0n) throw new Error('degenerate spend key');
  return bytesToHex(bigTo32(p));
}
