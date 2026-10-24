# Stacks Stealth Payments (draft spec, v2)

Status: draft for discussion, not a ratified SIP. Reference code: `stealth2.js`, `stealth2.py`, `stealth-announcer-v2.clar`, `stealth-registry.clar`. Test vectors: `vectors2.json`. Licence: MIT. TESTNET ONLY until an outside review.

## 1. Abstract

A receiver publishes one reusable *pay-me code*. Each payer derives a fresh one-time Stacks address from it, pays that address directly, and announces a 33-byte ephemeral key plus a 1-byte view tag. Only the receiver's scan key can recognise the payment, and only the receiver's spend key can open the address. This is receiver privacy, the same construction as Bitcoin Silent Payments ([BIP-352](https://github.com/bitcoin/bips/blob/master/bip-0352.mediawiki)) and Ethereum stealth addresses ([ERC-5564](https://eips.ethereum.org/EIPS/eip-5564)), adapted to Stacks' account model. Prior Stacks discussion: [2022 forum RFC](https://forum.stacks.org/t/rfc-transaction-privacy-stealth-addresses/13967).

## 2. What it does and doesn't hide

- Hidden: that several payments went to the same receiver, and the receiver's total.
- Not hidden: the payer, the amount, the asset and the time. Nothing is pooled and there's no anonymity set.
- Funds never pass through a contract the receiver doesn't control. The announcer contract is non-custodial and immutable, has no admin and charges no fees.

## 3. Notation

- secp256k1, generator `G`, order `n`. `ser(P)` is the 33-byte compressed point. `ser32(i)` is a 4-byte big-endian integer.
- `H_tag(x) = SHA256(SHA256(tag) || SHA256(tag) || x)` (BIP-340 tagged hash). Tags: `StacksStealth/SharedSecret`, `StacksStealth/ViewTag`, `StacksStealth/Label`.
- `addr(v, P) = c32check(v, HASH160(ser(P)))`, where `v = 22` on mainnet (`SP…`) and `26` on testnet (`ST…`).

## 4. Keys

The receiver holds a scan key `s` (`S = s·G`) and a spend key `b` (`B = b·G`). The scan key finds payments and can be shared with an auditor. The spend key moves money and is never shared.

### Labels (optional)

For a label `m` (1 ≤ m < 2³²): `L_m = H_Label(ser32(s) || ser32(m)) mod n` and `B_m = B + L_m·G`. A labelled code uses `B_m` in place of `B`. One scan key covers all labels, so a receiver can hand out separate codes for tips, payroll and donations and tell incoming payments apart. Label 0 means unlabelled.

## 5. Pay-me code

bech32m ([BIP-350](https://github.com/bitcoin/bips/blob/master/bip-0350.mediawiki)) with the 90-character limit raised to 1023, as in BIP-352.

- HRP: `spstx` (mainnet) or `tspstx` (testnet). The code decides the network; wallets must not let a user pick a different one.
- Data: version character `q` (0), then `ser(S) || ser(B_m)` (66 bytes) as 5-bit groups.
- Decoders must reject: bad checksum, mixed case, an unknown HRP, a version other than 0, a wrong payload length, or a key that isn't a valid compressed point. Any one-character change is caught by the checksum (tested: 3,503 of 3,503).

## 6. Paying (payer)

1. Decode the code to get `S`, `B_m` and the network.
2. Pick a random `r` in [1, n−1]. Let `R = r·G` and `Z = r·S`.
3. `t = H_SharedSecret(ser(Z)) mod n` (retry with a new `r` if `t = 0`). `tag = H_ViewTag(ser(Z))[0]`.
4. `P = B_m + t·G` (retry if it's the point at infinity). One-time address `A = addr(v, P)`.
5. Call the announcer: `stealth-pay(amount, A, ser(R), tag)` for STX, or `stealth-pay-ft(token, amount, gas, A, ser(R), tag)` for a SIP-010 token such as sBTC.
   - `gas` is a small STX amount sent to the same `A`, so the receiver can later move the token without a sponsor. 0.05 to 0.1 STX is a reasonable default.
   - Wallets must attach deny-mode post-conditions: the payer sends exactly `amount` of the token and exactly `gas` (or `amount`) STX.

Without a contract, a wallet could put `ser(R) || tag` (34 bytes) in a plain STX transfer's memo. This is reserved for future versions, because memo handling differs between tools.

## 7. Announcer contract (`stealth-announcer-v2`)

- Moves funds from `tx-sender` straight to `A` and prints `{ event: "stealth", v: u2, to, amount, gas, eph, tag, sender, token, id }`.
- Refuses: amount 0, `eph` that isn't 33 bytes starting 02 or 03, `tag` that isn't 1 byte, `A` that isn't a standard non-contract address on this network (`is-standard`), and an `eph` that was already announced.
- Runs the token's `transfer` inside Clarity 4 `restrict-assets?`, allowing only `amount` of that token to leave the payer. A fake token that tries to move more, or to touch the payer's STX, makes the whole call fail with nothing moved (tested).
- No owner, admin, upgrade, fee or withdraw. Its state is a counter and the set of used `eph` values.

## 8. Scanning (receiver)

For each announcement `(to, eph, tag)`:

1. `Z = s·eph`. If `H_ViewTag(ser(Z))[0] ≠ tag`, skip. This skips about 255 of 256 payments meant for someone else after one point multiplication.
2. `t = H_SharedSecret(ser(Z)) mod n`. For `m` in {0, your labels}, check whether `addr(v, B_m + t·G) = to`.
3. On a match, the one-time private key is `p = b + L_m + t mod n` (use `L_0 = 0`). Most Stacks libraries want the compressed form `hex(p) || 01`.

Scanners read announcements from their own node, or from a public API. A public API sees which contract you poll but not which payments are yours.

## 9. Registry (`stealth-registry`)

Like ERC-6538. `set-code(version, scan, spend)` and `clear-code()` work only on the caller's own entry, and `get-code(principal)` is public. There's no admin. To pay `name.btc`, a wallet looks up the name's owner in BNS, reads that owner's registry entry and builds the code.

## 10. Spending safely

- Spend from a fresh address directly to wherever the money is going, or move one address at a time.
- Moving many fresh addresses into one wallet in one go links them again. Paying fees for many fresh addresses from one wallet, including as a sponsor, does the same, because the fee payer is public. That's why v2 lets the payer include `gas`.

## 11. Auditor access

Sharing `s` (and `B`) lets an auditor or tax adviser see every incoming payment, past and future, but not spend. Sharing can't be taken back, so receivers who want time-limited access should use a new scan key each period (a new code). A per-payment proof (revealing `Z` for one payment) is planned.

## 12. Test vectors

`vectors2.json` holds 6 valid vectors (mainnet, testnet, labelled) and 8 invalid codes with the expected rejection. All keys are sha256 of public strings. Never fund them.

## 13. Differences from BIP-352

There's one ephemeral key per payment rather than one derived from all inputs, because Stacks has accounts, not UTXOs, so the announcement is explicit. That also means no `k` counter. Tags and HRPs use their own names. Labels work the same way.

## 14. Security notes

- `stealth2.py` uses plain Python integers and isn't constant-time. Run it locally only. `stealth2.js` uses noble-curves.
- The scheme's privacy ends where a receiver links addresses on chain (section 10).
- Needs an outside review before mainnet.
