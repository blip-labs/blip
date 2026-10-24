"""stealth.py: receiver side of Stacks fresh-address (stealth) payments. TESTNET ONLY until reviewed.
Python 3 standard library only (no pip). Byte-identical to stealth.js (tested in tests/stealth.test.mjs).
secp256k1 / hash160 / c32 code copied from an earlier tool of mine (pure Python, not constant-time:
run it on your own machine only).

  python3 -I stealth.py keygen KEYFILE           new scan+spend keys (0600, refuses to overwrite); prints ONLY the pay-me code
  python3 -I stealth.py code KEYFILE             print the pay-me code again
  python3 -I stealth.py scan KEYFILE R TAG [TO]  print the fresh address if this payment is yours, else "no match" (exit 1)
  python3 -I stealth.py scan-event KEYFILE HEX   same, from a print event's Clarity hex (contract_log.value.hex)
  python3 -I stealth.py check VECTORS.json       recompute test vectors (throwaway keys only) and compare

Code format: "stx-stealth:1:" + hex(scanPub 33 bytes) + hex(spendPub 33 bytes).
There is deliberately no CLI that prints a spend key; call spend_key() from your own code.
"""
import hashlib, hmac, json, os, secrets, struct, sys

# ---------- secp256k1 ----------
P = 2**256 - 2**32 - 977
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G = (0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
     0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)

def _add(a, b):
    if a is None: return b
    if b is None: return a
    if a[0] == b[0] and (a[1] + b[1]) % P == 0: return None
    if a == b: l = 3 * a[0] * a[0] * pow(2 * a[1], P - 2, P) % P
    else: l = (b[1] - a[1]) * pow(b[0] - a[0], P - 2, P) % P
    x = (l * l - a[0] - b[0]) % P
    return (x, (l * (a[0] - x) - a[1]) % P)

def _mul(k, pt=G):
    r = None
    while k:
        if k & 1: r = _add(r, pt)
        pt = _add(pt, pt); k >>= 1
    return r

# ---------- hashes (pure RIPEMD-160 fallback when OpenSSL lacks it) ----------
def _ripemd160_pure(m):
    f = [lambda x, y, z: x ^ y ^ z, lambda x, y, z: (x & y) | (~x & z), lambda x, y, z: (x | ~y) ^ z,
         lambda x, y, z: (x & z) | (y & ~z), lambda x, y, z: x ^ (y | ~z)]
    K1 = [0, 0x5A827999, 0x6ED9EBA1, 0x8F1BBCDC, 0xA953FD4E]; K2 = [0x50A28BE6, 0x5C4DD124, 0x6D703EF3, 0x7A6D76E9, 0]
    R1 = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15, 7,4,13,1,10,6,15,3,12,0,9,5,2,14,11,8, 3,10,14,4,9,15,8,1,2,7,0,6,13,11,5,12,
          1,9,11,10,0,8,12,4,13,3,7,15,14,5,6,2, 4,0,5,9,7,12,2,10,14,1,3,8,11,6,15,13]
    R2 = [5,14,7,0,9,2,11,4,13,6,15,8,1,10,3,12, 6,11,3,7,0,13,5,10,14,15,8,12,4,9,1,2, 15,5,1,3,7,14,6,9,11,8,12,2,10,0,4,13,
          8,6,4,1,3,11,15,0,5,12,2,13,9,7,10,14, 12,15,10,4,1,5,8,7,6,2,13,14,0,3,9,11]
    S1 = [11,14,15,12,5,8,7,9,11,13,14,15,6,7,9,8, 7,6,8,13,11,9,7,15,7,12,15,9,11,7,13,12, 11,13,6,7,14,9,13,15,14,8,13,6,5,12,7,5,
          11,12,14,15,14,15,9,8,9,14,5,6,8,6,5,12, 9,15,5,11,6,8,13,12,5,12,13,14,11,8,5,6]
    S2 = [8,9,9,11,13,15,15,5,7,7,8,11,14,14,12,6, 9,13,15,7,12,8,9,11,7,7,12,7,6,15,13,11, 9,7,15,11,8,6,6,14,12,13,5,14,13,13,7,5,
          15,5,8,11,14,14,6,14,6,9,12,9,12,5,15,8, 8,5,12,9,12,5,14,6,8,13,6,5,15,13,11,11]
    M = 0xFFFFFFFF; rol = lambda x, n: ((x << n) | (x >> (32 - n))) & M
    h = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0]; l = len(m)
    m += b"\x80" + b"\x00" * ((55 - l) % 64) + (l * 8).to_bytes(8, "little")
    for i in range(0, len(m), 64):
        X = struct.unpack("<16I", m[i:i + 64])
        a1, b1, c1, d1, e1 = h; a2, b2, c2, d2, e2 = h
        for j in range(80):
            r = j // 16
            t = (rol((a1 + (f[r](b1, c1, d1) & M) + X[R1[j]] + K1[r]) & M, S1[j]) + e1) & M
            a1, e1, d1, c1, b1 = e1, d1, rol(c1, 10), b1, t
            t = (rol((a2 + (f[4 - r](b2, c2, d2) & M) + X[R2[j]] + K2[r]) & M, S2[j]) + e2) & M
            a2, e2, d2, c2, b2 = e2, d2, rol(c2, 10), b2, t
        t = (h[1] + c1 + d2) & M
        h = [t, (h[2] + d1 + e2) & M, (h[3] + e1 + a2) & M, (h[4] + a1 + b2) & M, (h[0] + b1 + c2) & M]
    return b"".join(x.to_bytes(4, "little") for x in h)

def hash160(b):
    s = hashlib.sha256(b).digest()
    try: return hashlib.new("ripemd160", s).digest()
    except (ValueError, TypeError): return _ripemd160_pure(s)

# ---------- addresses ----------
C32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
TESTNET_P2PKH = 26

def c32encode(b):
    n = int.from_bytes(b, "big"); s = ""
    while n: s = C32[n % 32] + s; n //= 32
    lead = len(b) - len(b.lstrip(b"\x00"))
    return "0" * lead + s

def c32decode(s):
    n = 0
    for ch in s: n = n * 32 + C32.index(ch)
    lead = len(s) - len(s.lstrip("0")); body = n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b""
    return b"\x00" * lead + body

def address(h160, version=TESTNET_P2PKH):
    chk = hashlib.sha256(hashlib.sha256(bytes([version]) + h160).digest()).digest()[:4]
    return "S" + C32[version] + c32encode(h160 + chk)

def parse_address(a):
    assert a[0] == "S"; v = C32.index(a[1]); raw = c32decode(a[2:])[-24:]
    assert address(raw[:20], v) == a, "bad address checksum"
    return v, raw[:20]

# ---------- stealth ----------
PREFIX = "stx-stealth:1:"
DOMAIN_T = b"blip-stealth-v1"
DOMAIN_TAG = b"blip-stealth-tag-v1"

def compress(pt):
    return bytes([2 + (pt[1] & 1)]) + pt[0].to_bytes(32, "big")

def decompress(pub):
    """33-byte compressed key -> point. Rejects anything not on the curve."""
    if len(pub) != 33 or pub[0] not in (2, 3): raise ValueError("public key must be 33-byte compressed (02/03)")
    x = int.from_bytes(pub[1:], "big")
    if x >= P: raise ValueError("public key x out of range")
    y2 = (x * x * x + 7) % P; y = pow(y2, (P + 1) // 4, P)
    if y * y % P != y2: raise ValueError("public key not on curve")
    if (y & 1) != (pub[0] & 1): y = P - y
    return (x, y)

def scalar(h, what="key"):
    b = bytes.fromhex(h[2:] if h.startswith("0x") else h)
    if len(b) == 33 and b[32] == 1: b = b[:32]
    if len(b) != 32: raise ValueError(what + ": must be 32 bytes")
    n = int.from_bytes(b, "big")
    if not 0 < n < N: raise ValueError(what + ": out of range")
    return n

def pubkey(priv):
    return compress(_mul(priv))

def make_meta_address(scan_pub, spend_pub):
    decompress(scan_pub); decompress(spend_pub)
    return PREFIX + scan_pub.hex() + spend_pub.hex()

def parse_meta_address(code):
    code = code.strip()
    if not code.startswith(PREFIX): raise ValueError("not a stx-stealth:1: code")
    body = bytes.fromhex(code[len(PREFIX):])
    if len(body) != 66: raise ValueError("code must carry 2 x 33-byte keys")
    decompress(body[:33]); decompress(body[33:])
    return body[:33], body[33:]

def _from_shared(shared):
    sb = compress(shared)
    t = int.from_bytes(hashlib.sha256(DOMAIN_T + sb).digest(), "big") % N
    tag = hashlib.sha256(DOMAIN_TAG + sb).digest()[0]
    return t, tag

def _receiver_t(scan_priv, R):
    return _from_shared(_mul(scan_priv, decompress(R)))

def scan(scan_priv, spend_pub, R, tag, to=None, version=TESTNET_P2PKH):
    """scan_priv int, spend_pub/R bytes, tag int 0..255. Tag first (cheap), then the address.
    Returns the address or None. Always pass `to` (the announced recipient)."""
    t, mine = _receiver_t(scan_priv, R)
    if mine != tag or t == 0: return None
    pt = _add(decompress(spend_pub), _mul(t))
    if pt is None: return None
    addr = address(hash160(compress(pt)), version)
    if to is not None and to != addr: return None
    return addr

def spend_key(scan_priv, spend_priv, R):
    """One-time private key p = (b + t) mod n as 64 hex chars. For stacks.js use p + '01'."""
    t, _ = _receiver_t(scan_priv, R)
    p = (spend_priv + t) % N
    if p == 0: raise ValueError("degenerate spend key")
    return p.to_bytes(32, "big").hex()

def new_keys():
    return {"scan": (secrets.randbelow(N - 1) + 1).to_bytes(32, "big").hex(),
            "spend": (secrets.randbelow(N - 1) + 1).to_bytes(32, "big").hex()}

def code_from_keys(k):
    return make_meta_address(pubkey(scalar(k["scan"], "scan")), pubkey(scalar(k["spend"], "spend")))

# ---------- Clarity value decoding (for print events from the Hiro API) ----------
def decode_cv(b, i=0):
    """Deserialize one Clarity value from bytes at offset i -> (python value, new offset)."""
    t = b[i]; i += 1
    if t in (0, 1):
        v = int.from_bytes(b[i:i + 16], "big", signed=(t == 0)); return v, i + 16
    if t == 2:
        n = struct.unpack(">I", b[i:i + 4])[0]; i += 4; return b[i:i + n], i + n
    if t == 3: return True, i
    if t == 4: return False, i
    if t == 5: return address(b[i + 1:i + 21], b[i]), i + 21
    if t == 6:
        a = address(b[i + 1:i + 21], b[i]); i += 21; n = b[i]; i += 1
        return a + "." + b[i:i + n].decode("ascii"), i + n
    if t in (7, 8, 10):
        v, i = decode_cv(b, i); return {7: ("ok", v), 8: ("err", v), 10: ("some", v)}[t], i
    if t == 9: return None, i
    if t == 11:
        n = struct.unpack(">I", b[i:i + 4])[0]; i += 4; out = []
        for _ in range(n): v, i = decode_cv(b, i); out.append(v)
        return out, i
    if t == 12:
        n = struct.unpack(">I", b[i:i + 4])[0]; i += 4; out = {}
        for _ in range(n):
            k = b[i + 1:i + 1 + b[i]].decode("ascii"); i += 1 + b[i]
            out[k], i = decode_cv(b, i)
        return out, i
    if t in (13, 14):
        n = struct.unpack(">I", b[i:i + 4])[0]; i += 4
        return b[i:i + n].decode("ascii" if t == 13 else "utf-8"), i + n
    raise ValueError("unknown Clarity type %d" % t)

def parse_event(hexstr):
    """A stealth-announcer print event (hex) -> dict with to, amount, eph (bytes), tag (int), sender, token, id.
    Returns None for any other print event."""
    b = bytes.fromhex(hexstr[2:] if hexstr.startswith("0x") else hexstr)
    v, end = decode_cv(b)
    if end != len(b) or not isinstance(v, dict) or v.get("event") != "stealth": return None
    if not isinstance(v.get("eph"), bytes) or len(v["eph"]) != 33 or not isinstance(v.get("tag"), bytes) or len(v["tag"]) != 1:
        return None
    tok = v.get("token")
    return {"to": v["to"], "amount": v["amount"], "eph": v["eph"], "tag": v["tag"][0], "sender": v["sender"],
            "token": tok[1] if isinstance(tok, tuple) else None, "id": v.get("id")}

# ---------- CLI ----------
def _load(path):
    with open(path) as f: k = json.load(f)
    return scalar(k["scan"], "scan"), scalar(k["spend"], "spend"), k

def _keygen(path):
    k = new_keys()
    code = code_from_keys(k)
    data = json.dumps({"scan": k["scan"], "spend": k["spend"], "code": code,
                       "note": "stx-stealth TESTNET keys. Secret: never share, never commit."}).encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        os.fchmod(fd, 0o600); os.write(fd, data)
    finally:
        os.close(fd)
    return code

def _check(path):
    with open(path) as f: doc = json.load(f)
    bad = 0; out = []
    for v in doc["vectors"]:
        s, b = scalar(v["scanPriv"]), scalar(v["spendPriv"])
        code = make_meta_address(pubkey(s), pubkey(b))
        R = bytes.fromhex(v["R"]); tag = int(v["tag"], 16)
        a = scan(s, pubkey(b), R, tag, v["addr"])
        p = spend_key(s, b, R)
        pa = address(hash160(pubkey(int(p, 16))))
        ok = code == v["code"] and a == v["addr"] and p == v["spendKey"] and pa == v["addr"]
        wrong = scan(s, pubkey(b), R, (tag + 1) % 256, v["addr"])
        ok = ok and wrong is None
        bad += not ok
        out.append({"label": v.get("label"), "ok": ok, "code": code, "addr": a, "spendKey": p})
    print(json.dumps({"checked": len(out), "failed": bad, "results": out}))
    return 0 if bad == 0 else 1

def main(argv):
    if len(argv) >= 2 and argv[0] == "keygen":
        print(_keygen(argv[1])); return 0
    if len(argv) >= 2 and argv[0] == "code":
        print(code_from_keys(_load(argv[1])[2])); return 0
    if len(argv) >= 4 and argv[0] == "scan":
        s, b, _ = _load(argv[1])
        a = scan(s, pubkey(b), bytes.fromhex(argv[2].removeprefix("0x")), int(argv[3].removeprefix("0x"), 16), argv[4] if len(argv) > 4 else None)
        print(a or "no match"); return 0 if a else 1
    if len(argv) >= 3 and argv[0] == "scan-event":
        s, b, _ = _load(argv[1]); e = parse_event(argv[2])
        a = e and scan(s, pubkey(b), e["eph"], e["tag"], e["to"])
        print(json.dumps({"addr": a, "amount": e["amount"], "token": e["token"], "id": e["id"]}) if a else "no match")
        return 0 if a else 1
    if len(argv) >= 2 and argv[0] == "check":
        return _check(argv[1])
    print(__doc__); return 2

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
