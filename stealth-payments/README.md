# Fresh-address STX payments (stealth addresses) kit — TESTNET ONLY

Nothing here has touched mainnet or a real key.

## What it does, in plain English
You publish one "pay me" code. Every payment made to that code lands at a brand-new Stacks address that only you can open. People watching the chain see a payer sending money to some fresh address, but they can't tell that all those fresh addresses belong to you. Money goes straight from the payer to the fresh address; nothing is pooled and the contract never holds anything.

## v2 (2026-10-24): safer codes, payer-paid fees, a standard draft

Read `SPEC.md` first. v1 files stay as they are so the running testnet scanner keeps working.

| File | What |
|---|---|
| `SPEC.md` | Draft standard (SIP-style), modelled on Bitcoin's BIP-352. |
| `stealth2.js`, `stealth2.py` | v2 library: bech32m pay-me codes (`tspstx1…` / `spstx1…`) with a checksum and the network built in, tagged hashes, optional labels. The JS and Python versions match on 200 random cases. |
| `stealth-announcer-v2.clar` | Clarity 4. Refuses wrong-network and contract addresses and a reused eph. `stealth-pay-ft` takes `gas` (STX for future fees, sent to the same fresh address, so no sponsor is needed and nothing links the addresses) and runs the token inside `restrict-assets?`, so a fake token can't take more than the amount or touch the payer's STX. |
| `stealth-registry.clar` | Clarity 4. Publish your pay-me keys under your own address (like ERC-6538), so wallets can pay `name.btc` privately. No admin. |
| `vectors2.json` | 6 valid vectors (mainnet, testnet, labelled) + 8 invalid codes. Public throwaway keys. |
| `tests/stealth2.test.mjs`, `tests/announcer2.test.mjs` | 650 library checks (including all 3,503 one-character typos) and 29 contract checks, using the real sBTC token contract in simnet, plus a 600-step random stress test. Results: `TEST-RESULTS2.txt`. |
| `examples/wallet-pay.mjs` | Wallet example: pay-me code to a ready-to-sign call with deny-mode post-conditions (exact amounts). 9 checks in `tests/wallet-pay.test.mjs`. |
| `contracts-test/evil-token.clar`, `greedy-token.clar` | Fake tokens for tests only. Never deploy. |

Sponsored fees are dropped: a sponsor's address is public on chain and would link every fresh address it pays for.

## Files (v1)
| File | What |
|---|---|
| `stealth-announcer.clar` | Clarity 3 / epoch 3.1 contract. `stealth-pay` (STX) and `stealth-pay-ft` (SIP-010) move funds straight from `tx-sender` to `to` and print the announcement. No owner, no admin, no withdraw; only state is a counter. |
| `stealth.js` | ES module (browser + node), only @noble/curves + @noble/hashes. Payer side (`derivePayment`) and receiver side (`scan`, `spendKey`), plus its own c32check addresses. |
| `stealth.py` | Python 3 standard library only, for your own machine. Key generation, `scan`, `spend_key`, and a decoder for the contract's print event. Byte-identical to stealth.js (tested). |
| `vectors.json` | 6 fixed test vectors from PUBLIC throwaway keys (sha256 of labelled strings). Never fund them. |
| `tests/` | `stealth.test.mjs`, `announcer.test.mjs`, `gen-vectors.mjs` (rebuilds vectors.json). |
| `contracts-test/` | Local SIP-010 trait copy + two mock tokens. Mocks are simnet-only, never deploy them. |
| `Clarinet.toml`, `settings/Devnet.toml` | Simnet project. Devnet.toml is a stub: add Clarinet's public test accounts (deployer, wallet_1, wallet_2) to run the tests. |
| `SECURITY.md`, `TEST-RESULTS.txt` | Dependency check and test output. |

Run tests (needs node; install outside this shared folder): copy the kit somewhere local, `npm ci`, `npm test`.

## Pay-me code format (version 1)
```
stx-stealth:1:<scanPub hex, 33 bytes compressed><spendPub hex, 33 bytes compressed>
```
146 characters, lowercase hex, scan key first. Example (vector 1, throwaway): see `vectors.json`.

## The math
- Receiver keys: scan `s`, `S = s·G`; spend `b`, `B = b·G`. Both secrets stay on your own machine.
- Payer: random `r`, `R = r·G` (this is `eph`), `shared = r·S`,
  `t = sha256("blip-stealth-v1" ‖ compressed(shared)) mod n`, `P = B + t·G`,
  `addr = c32check(26, hash160(compressed P))` (26 = testnet P2PKH, `ST…`),
  `tag = sha256("blip-stealth-tag-v1" ‖ compressed(shared))[0]`.
- Receiver: `s·R` is the same `shared`, so it rebuilds `t`, checks the tag (skips 255/256 of other people's payments), then the address.
- Spend key `p = (b + t) mod n`. **For stacks.js use `p + "01"`** (a bare 64-hex key is treated as uncompressed and gives a different address; tested).

## Payer flow (pay page)
1. `const { addr, R, tag } = derivePayment(code)` (default version 26 = testnet).
2. Wallet signs `stealth-pay(amount, addr, R, tag)` or `stealth-pay-ft(token, amount, addr, R, tag)`.
   Use deny-mode post-conditions: payer sends exactly `amount` STX (or exactly `amount` of that token).
3. Contract errors: `u400` amount 0, `u401` eph not 33 bytes starting 02/03, `u402` tag not 1 byte, `u403` `to` is the contract itself; plus the native transfer errors (`u1` not enough balance, `u2` paying yourself).

Print event (a Clarity tuple):
`{ event: "stealth", to, amount, eph, tag, sender, token: none | (some <token contract>), id }`
`token` and `id` are there so the scanner knows which asset moved and has an order.

## How a scanner should read announcements
- Endpoint: `GET https://api.testnet.hiro.so/extended/v1/contract/<deployer>.stealth-announcer/events?limit=50&offset=<n>`
- Expected shape: `{ limit, offset, results: [ { event_index, event_type: "smart_contract_log", tx_id, contract_log: { contract_id, topic: "print", value: { hex, repr } } } ] }`
- Check this shape against the Hiro docs and one real response before relying on it, including page order (believed newest first) and max `limit`.
- For each result with `topic == "print"`, pass `contract_log.value.hex` to `stealth.py`:
  - CLI: `python3 -I stealth.py scan-event KEYFILE 0x0c...` prints `{"addr", "amount", "token", "id"}` or `no match`.
  - Code: `e = parse_event(hex)` then `scan(s, pubkey(b), e["eph"], e["tag"], e["to"])`. Always pass `to`.
  The decoder is tested against the real serialized print event from simnet.
- Before showing a match as money: confirm the tx succeeded (`GET /extended/v1/tx/<tx_id>`) and check the fresh address's real balance (`GET /extended/v1/address/<addr>/balances`). For `stealth-pay-ft`, only trust tokens on an allowlist (e.g. sBTC): anyone can pass a fake token contract that prints a convincing announcement.
- Page until you reach a `tx_id` you've already seen; keep your own "seen" list locally.

## Other CLI
```
python3 -I stealth.py keygen KEYFILE        # 0600, refuses to overwrite, prints ONLY the pay-me code
python3 -I stealth.py code KEYFILE
python3 -I stealth.py scan KEYFILE R TAG [TO]
```
There's no CLI that prints a spend key; call `spend_key()` from the sweep code.

## Testnet deploy notes
- Deploy `contracts-test/sip-010-trait.clar` as `sip-010-trait` first (it's only a trait definition), then `stealth-announcer.clar`. Or edit the `use-trait` line to point at an existing testnet SIP-010 trait. Clarity 2+ checks trait arguments by shape, so real tokens (sBTC) work with a local trait copy; this is tested with a token that has no `impl-trait` line.
- Never deploy `mock-token*.clar`.

## Honest limits
- **Sweeping re-links.** Moving many fresh addresses into one wallet in one go (or one after another to the same place) links them again. Move them one at a time, to different places, or leave them apart.
- **Payer and amount stay public.** This hides only who received it. The payer's address, the amount, and the fact that a stealth payment happened (a call to this contract) are all public.
- 1-byte view tag: the scanner still does one EC multiply per announcement; the tag only saves the second step.
- sBTC at a fresh address has no STX for fees; sweeping it needs STX at that address. v1 doesn't handle this; v2's `gas` does.
- No wallet supports this natively; payers use the pay page.
- A no-contract memo fallback is not built.
- stealth.py's EC math is not constant-time; keep it local.
- Needs an outside review before mainnet.
