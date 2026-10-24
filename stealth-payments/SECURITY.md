# Security notes (checked 2026-10-24, TESTNET ONLY)

## Runtime dependencies of stealth.js (pinned exactly in package.json)

| Package | Version | Published | npm maintainer | Integrity (package-lock) |
|---|---|---|---|---|
| @noble/curves | 2.4.0 | 2026-08-27 (8 weeks old) | paulmillr only | sha512-P4/62zrgfH33CneE3Dn4WhJVA22YUU0eR51wKIan4NVRvwsA0YnPTwWGpNbpuacSujmSFLvyzpyuR30+fbq2Ew== |
| @noble/hashes | 2.4.0 | 2026-08-27 (8 weeks old) | paulmillr only | sha512-X5XaVWZIBCT7HHZGm5I7ZQXDwLG+bGXuSrMQAW+7Zvl87h1kmc1ZB1VSRJcpUfoUrGQp4Fkoxm5kZ+Ms+aW+eA== |

- `npm view ... maintainers`: both list only `paulmillr <paul@paulmillr.com>`.
- Recent releases: 2.0.0 (2025-08), 2.0.1 (2025-09), 2.2.0 (2026-04), 2.3.0 (2026-08-06), 2.4.0 (2026-08-27). Active, steady cadence.
- `@noble/curves@2.4.0` ships npm provenance (SLSA v1 attestation). Its only dependency is `@noble/hashes@2.4.0`.
- `npm audit` (full tree incl. dev deps) and `npm audit --omit=dev`: **found 0 vulnerabilities**.
- Not checked here: the GitHub advisory database directly , and the noble audit reports themselves (noble-curves/hashes have had public third-party audits; we did not re-read them).

## Dev/test-only dependencies (never shipped to payers)
@stacks/transactions 7.6.0, @stacks/network 7.6.0 (2026-07-29), @hirosystems/clarinet-sdk 3.8.1 (2025-10-10). They pull older copies of @noble/hashes (1.1.5, 1.8.0) and @noble/secp256k1 1.7.1 for themselves; `npm audit` reports nothing for them. stealth.js does not use them.

## Scheme / code notes
- All keys in this kit (vectors.json, tests) are PUBLIC throwaway keys (sha256 of public strings) or random keys created and deleted inside a test run.
- stealth.py's secp256k1 math is plain Python big integers (copied from an earlier tool of mine): correct, but **not constant-time**. Run it only on your own machine; do not expose it as a network service.
- stealth.js uses noble's Point.multiply (constant-time) for secret scalars.
- The view tag is 1 byte, so 1 in 256 foreign payments pass the tag. `scan` must be given the announced `to` address (or the caller must compare) to rule those out. Tested.
- stacks.js reads a bare 64-hex private key as "uncompressed" and gives a different address. Spend from a fresh address with `spendKey + "01"`. Tested.
- Key file: `stealth.py keygen` uses O_CREAT|O_EXCL with mode 0600 (refuses to overwrite) and prints only the pay-me code. There is no CLI command that prints a spend key.
- The announcer contract holds no funds and has no admin, but it still needs an outside review before any mainnet use.

## v2 notes (2026-10-24)
- Dev/test now uses @stacks/clarinet-sdk 3.25.0 (stx-labs/clarinet, maintainers @stackslabs.com, published 2026-10-15, npm audit 0). @hirosystems/clarinet-sdk 3.8.1 can't parse Clarity 4. Runtime deps unchanged (noble 2.4.0 only).
- `stealth2.py` reuses stealth.py's curve math: still not constant-time, local use only.
- The stress test samples random calls; it's evidence, not a proof. An outside review is still required before mainnet.
