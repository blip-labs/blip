#!/usr/bin/env python3
"""stealth2.py: fresh-address (stealth) payments for Stacks, scheme v2 (see SPEC.md). TESTNET ONLY until reviewed.

Python 3 standard library only; reuses the curve math in stealth.py. Byte-identical to stealth2.js (tested).
Not constant-time: run it on your own machine only, never as a network service.

  python3 -I stealth2.py code KEYFILE testnet|mainnet [LABEL]   print a pay-me code (never prints a private key)
"""
import hashlib, json, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from stealth import N, _add, _mul, compress, decompress, scalar, hash160, address  # noqa: E402

NETWORKS = {"mainnet": ("spstx", 22), "testnet": ("tspstx", 26)}
CODE_VERSION = 0

def tagged_hash(tag, msg):
    th = hashlib.sha256(tag.encode()).digest()
    return hashlib.sha256(th + th + msg).digest()

# ---------- bech32m (BIP-350), 1023-char limit as in BIP-352 ----------
B32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
BECH32M = 0x2BC830A3

def _polymod(values):
    gen = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3]
    chk = 1
    for v in values:
        top = chk >> 25
        chk = (chk & 0x1FFFFFF) << 5 ^ v
        for i in range(5):
            if (top >> i) & 1: chk ^= gen[i]
    return chk

def _hrp_expand(hrp):
    return [ord(c) >> 5 for c in hrp] + [0] + [ord(c) & 31 for c in hrp]

def _convert_bits(data, frm, to, pad):
    acc = bits = 0; out = []; maxv = (1 << to) - 1
    for v in data:
        if v < 0 or v >> frm: raise ValueError("bad data")
        acc = (acc << frm) | v; bits += frm
        while bits >= to:
            bits -= to; out.append((acc >> bits) & maxv)
    if pad:
        if bits: out.append((acc << (to - bits)) & maxv)
    elif bits >= frm or ((acc << (to - bits)) & maxv):
        raise ValueError("bad padding")
    return out

def bech32m_encode(hrp, data5):
    pm = _polymod(_hrp_expand(hrp) + data5 + [0] * 6) ^ BECH32M
    return hrp + "1" + "".join(B32[d] for d in data5 + [(pm >> 5 * (5 - i)) & 31 for i in range(6)])

def bech32m_decode(s):
    if len(s) > 1023: raise ValueError("code too long")
    if s != s.lower() and s != s.upper(): raise ValueError("mixed case")
    s = s.lower(); pos = s.rfind("1")
    if pos < 1 or pos + 7 > len(s): raise ValueError("bad separator")
    hrp = s[:pos]
    try: data = [B32.index(c) for c in s[pos + 1:]]
    except ValueError: raise ValueError("bad character")
    if _polymod(_hrp_expand(hrp) + data) != BECH32M: raise ValueError("checksum failed (typo?)")
    return hrp, data[:-6]

# ---------- codes ----------
def encode_code(scan_pub, spend_pub, network):
    hrp, _ = NETWORKS[network]
    decompress(scan_pub); decompress(spend_pub)
    return bech32m_encode(hrp, [CODE_VERSION] + _convert_bits(scan_pub + spend_pub, 8, 5, True))

def decode_code(code):
    hrp, data = bech32m_decode(code.strip())
    net = next((k for k, v in NETWORKS.items() if v[0] == hrp), None)
    if net is None: raise ValueError('unknown code prefix "%s"' % hrp)
    if not data or data[0] != CODE_VERSION: raise ValueError("unsupported code version")
    payload = bytes(_convert_bits(data[1:], 5, 8, False))
    if len(payload) != 66: raise ValueError("code must carry two 33-byte keys")
    decompress(payload[:33]); decompress(payload[33:])
    return {"network": net, "version": NETWORKS[net][1], "scan_pub": payload[:33], "spend_pub": payload[33:]}

# ---------- labels ----------
def label_tweak(scan_priv, m):
    if not 0 < m < 2**32: raise ValueError("label must be 1..2^32-1")
    t = int.from_bytes(tagged_hash("StacksStealth/Label", scan_priv.to_bytes(32, "big") + m.to_bytes(4, "big")), "big") % N
    if t == 0: raise ValueError("degenerate label")
    return t

def labelled_spend_pub(scan_priv, spend_pub, m):
    return compress(_add(decompress(spend_pub), _mul(label_tweak(scan_priv, m))))

# ---------- payer / receiver ----------
def _from_shared(shared):
    sb = compress(shared)
    return int.from_bytes(tagged_hash("StacksStealth/SharedSecret", sb), "big") % N, tagged_hash("StacksStealth/ViewTag", sb)[0]

def derive_payment(code, r):
    """Payer side with a given r (int). Returns dict addr, R (bytes), tag (int), network."""
    c = decode_code(code)
    t, tag = _from_shared(_mul(r, decompress(c["scan_pub"])))
    if t == 0: raise ValueError("degenerate r")
    pt = _add(decompress(c["spend_pub"]), _mul(t))
    if pt is None: raise ValueError("degenerate r")
    return {"addr": address(hash160(compress(pt)), c["version"]), "R": compress(_mul(r)), "tag": tag, "network": c["network"]}

def scan(scan_priv, spend_pub, R, tag, to, network, labels=()):
    """Tag first, then the base address and each label. Returns (addr, label) or None. `to` is required."""
    _, version = NETWORKS[network]
    t, mine = _from_shared(_mul(scan_priv, decompress(R)))
    if mine != tag or t == 0: return None
    tG = _mul(t); B = decompress(spend_pub)
    for m in (0,) + tuple(labels):
        Bm = B if m == 0 else _add(B, _mul(label_tweak(scan_priv, m)))
        pt = _add(Bm, tG)
        if pt is not None and address(hash160(compress(pt)), version) == to: return (to, m)
    return None

def spend_key(scan_priv, spend_priv, R, label=0):
    t, _ = _from_shared(_mul(scan_priv, decompress(R)))
    p = (spend_priv + (label_tweak(scan_priv, label) if label else 0) + t) % N
    if p == 0: raise ValueError("degenerate spend key")
    return p.to_bytes(32, "big").hex()

def main(argv):
    if len(argv) >= 3 and argv[0] == "code":
        with open(argv[1]) as f: k = json.load(f)
        s, b = scalar(k["scan"], "scan"), scalar(k["spend"], "spend")
        spend_pub = compress(_mul(b))
        if len(argv) > 3: spend_pub = labelled_spend_pub(s, spend_pub, int(argv[3]))
        print(encode_code(compress(_mul(s)), spend_pub, argv[2])); return 0
    if len(argv) == 2 and argv[0] == "decode":
        c = decode_code(argv[1]); print(json.dumps({"network": c["network"], "scan_pub": c["scan_pub"].hex(), "spend_pub": c["spend_pub"].hex()})); return 0
    print(__doc__); return 2

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
