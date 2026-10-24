// stealth.js: fresh-address (stealth address) payments for Stacks. TESTNET ONLY until reviewed.
// ES module for browsers and node. Depends only on @noble/curves and @noble/hashes (see SECURITY.md).
//
// Pay-me code format (version 1):
//   "stx-stealth:1:" + hex(scanPub, 33 bytes compressed) + hex(spendPub, 33 bytes compressed)
//   = 14 + 66 + 66 = 146 characters, lowercase hex. Scan key first, then spend key.
//
// Payer:    r random, R = r*G, shared = r*S,
//           t = sha256("blip-stealth-v1" || compressed(shared)) mod n,  P = B + t*G,
//           addr = c32check(version, hash160(compressed P)),
//           tag  = first byte of sha256("blip-stealth-tag-v1" || compressed(shared)).
// Receiver: shared = s*R (same point), so it can rebuild t, P and addr; spend key p = (b + t) mod n.
// To spend from addr with stacks.js, use the "compressed" private key form p + "01".
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { bytesToHex, hexToBytes, concatBytes, utf8ToBytes, randomBytes } from '@noble/hashes/utils.js';

const Point = secp256k1.Point;
export const N = Point.Fn.ORDER;
export const PREFIX = 'stx-stealth:1:';
export const TESTNET_P2PKH = 26; // 'T'  (ST... addresses)
export const MAINNET_P2PKH = 22; // 'P'  (SP...) - do not use until reviewed
const DOMAIN_T = utf8ToBytes('blip-stealth-v1');
const DOMAIN_TAG = utf8ToBytes('blip-stealth-tag-v1');
const C32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const toBytes = (x, what) => {
  if (x instanceof Uint8Array) return x;
  if (typeof x === 'string' && /^(0x)?([0-9a-fA-F]{2})*$/.test(x)) return hexToBytes(x.replace(/^0x/, '').toLowerCase());
  throw new Error(`${what}: expected hex string or Uint8Array`);
};
const bytesToBig = b => BigInt('0x' + (bytesToHex(b) || '0'));
const bigTo32 = n => hexToBytes(n.toString(16).padStart(64, '0'));

/** A private key as bigint in [1, n-1]; accepts 32-byte hex/bytes (or 33 bytes ending 01). */
export function scalar(k, what = 'key') {
  let b = toBytes(k, what);
  if (b.length === 33 && b[32] === 1) b = b.slice(0, 32);
  if (b.length !== 32) throw new Error(`${what}: must be 32 bytes`);
  const n = bytesToBig(b);
  if (n <= 0n || n >= N) throw new Error(`${what}: out of range`);
  return n;
}

/** A public key point; must be 33-byte compressed, on the curve, not infinity. */
export function point(pub, what = 'public key') {
  const b = toBytes(pub, what);
  if (b.length !== 33 || (b[0] !== 2 && b[0] !== 3)) throw new Error(`${what}: must be 33-byte compressed (02/03)`);
  const P = Point.fromBytes(b); // throws if not on curve
  P.assertValidity();
  return P;
}

export const pubFromPriv = priv => bytesToHex(Point.BASE.multiply(scalar(priv)).toBytes(true));
export const hash160 = b => ripemd160(sha256(b));

/** c32 encoding as used by Stacks (one '0' per leading zero byte). */
export function c32encode(bytes) {
  let n = bytesToBig(bytes), s = '';
  while (n > 0n) { s = C32[Number(n % 32n)] + s; n /= 32n; }
  let lead = 0; while (lead < bytes.length && bytes[lead] === 0) lead++;
  return '0'.repeat(lead) + s;
}

/** Stacks c32check address: "S" + c32[version] + c32(h160 || sha256d(version||h160)[0..4]). */
export function c32address(version, h160) {
  const h = toBytes(h160, 'hash160');
  if (h.length !== 20 || !Number.isInteger(version) || version < 0 || version > 31) throw new Error('bad address input');
  const chk = sha256(sha256(concatBytes(Uint8Array.of(version), h))).slice(0, 4);
  return 'S' + C32[version] + c32encode(concatBytes(h, chk));
}

export const addressFromPub = (pub, version = TESTNET_P2PKH) => c32address(version, hash160(point(pub).toBytes(true)));

export function makeMetaAddress(scanPub, spendPub) {
  const S = point(scanPub, 'scan public key'), B = point(spendPub, 'spend public key');
  return PREFIX + bytesToHex(S.toBytes(true)) + bytesToHex(B.toBytes(true));
}

export function parseMetaAddress(code) {
  if (typeof code !== 'string') throw new Error('code must be a string');
  const c = code.trim();
  if (!c.startsWith(PREFIX)) throw new Error('not a stx-stealth:1: code');
  const body = c.slice(PREFIX.length).toLowerCase();
  if (!/^[0-9a-f]{132}$/.test(body)) throw new Error('code must carry 2 x 33-byte keys in hex');
  const scanPub = body.slice(0, 66), spendPub = body.slice(66);
  point(scanPub, 'scan public key'); point(spendPub, 'spend public key');
  return { scanPub, spendPub };
}

// shared point -> (t, tag)
function fromShared(sharedPoint) {
  const sb = sharedPoint.toBytes(true);
  const t = bytesToBig(sha256(concatBytes(DOMAIN_T, sb))) % N;
  const tag = sha256(concatBytes(DOMAIN_TAG, sb))[0];
  return { t, tag };
}

/** Payer side. Returns { addr, R, tag, pub } (hex). `rand` (32 bytes hex/Uint8Array) only for tests. */
export function derivePayment(code, version = TESTNET_P2PKH, rand) {
  const { scanPub, spendPub } = parseMetaAddress(code);
  const S = point(scanPub), B = point(spendPub);
  for (let tries = 0; tries < 64; tries++) {
    let r;
    if (rand !== undefined) r = scalar(rand, 'rand');
    else { r = bytesToBig(randomBytes(32)); if (r <= 0n || r >= N) continue; }
    const shared = S.multiply(r);
    const { t, tag } = fromShared(shared);
    const P = t === 0n ? null : B.add(Point.BASE.multiply(t));
    if (P === null || P.is0()) { if (rand !== undefined) throw new Error('degenerate rand (t = 0 or P = infinity)'); continue; }
    const pub = P.toBytes(true);
    return { addr: c32address(version, hash160(pub)), R: bytesToHex(Point.BASE.multiply(r).toBytes(true)), tag: tag.toString(16).padStart(2, '0'), pub: bytesToHex(pub) };
  }
  throw new Error('could not derive a payment');
}

function receiverT(scanPriv, R) {
  const s = scalar(scanPriv, 'scan private key');
  return fromShared(point(R, 'R').multiply(s));
}

/**
 * Receiver side. Checks the 1-byte view tag first (cheap filter), then rebuilds the address.
 * Returns the address, or null. ALWAYS pass `to` (the announced recipient): the tag alone
 * matches 1 in 256 foreign payments, so without `to` a caller must compare the result itself.
 */
export function scan(scanPriv, spendPub, R, tag, to, version = TESTNET_P2PKH) {
  const tg = toBytes(tag, 'tag');
  if (tg.length !== 1) throw new Error('tag must be 1 byte');
  const { t, tag: mine } = receiverT(scanPriv, R);
  if (mine !== tg[0] || t === 0n) return null;
  const P = point(spendPub, 'spend public key').add(Point.BASE.multiply(t));
  if (P.is0()) return null;
  const addr = c32address(version, hash160(P.toBytes(true)));
  if (to !== undefined && to !== null && to !== addr) return null;
  return addr;
}

/** The one-time private key p = (b + t) mod n, as 64 hex chars. For stacks.js use p + '01'. */
export function spendKey(scanPriv, spendPriv, R) {
  const b = scalar(spendPriv, 'spend private key');
  const { t } = receiverT(scanPriv, R);
  const p = (b + t) % N;
  if (p === 0n) throw new Error('degenerate spend key');
  return bytesToHex(bigTo32(p));
}
