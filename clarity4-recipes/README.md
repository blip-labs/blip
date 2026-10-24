# Clarity 4 recipes

Five tiny contracts you can copy, each showing one new Clarity 4 feature, with tests that prove what it does. Made alongside the [Fair Play Kit](../fairplay-kit/).

| # | Recipe | Clarity 4 feature | In one line |
|---|---|---|---|
| 1 | `spend-limit` | `restrict-assets?` | Call another app, but cap how much STX of yours it can take. If it tries more, the whole call is undone. |
| 2 | `capped-vault` | `as-contract?` with allowances | A contract wallet whose own code can pay out at most 10 STX per payout, so even a bug can't empty it in one go. |
| 3 | `audited-code` | `contract-hash?` | A list of reviewed code fingerprints. An exact copy of reviewed code counts as reviewed; change one comment and it doesn't. |
| 4 | `deadline` | `stacks-block-time` | A challenge your friend must answer within 24 real hours, not a guessed number of blocks. |
| 5 | `device-key` | `secp256r1-verify` | Sign a score with a phone or browser key (P-256), no wallet popup. |

## Run the checks

```
npm install
npm test        # 28 checks on a simulated chain
```

`settings/Devnet.toml` needs Clarinet's test accounts. Run `clarinet check` once to fill them in, or copy them from Clarinet's docs. They're public and worthless. Never put a real seed phrase in this folder.

## Things we found while testing (worth knowing)

- **Allowance errors are numbers.** When an allowance is broken, you get `(err u0)`, where `u0` is the position of the broken allowance in the list. Your own errors (like `err u100`) pass through unchanged, and everything inside the call is undone either way.
- **The body can't end with a response.** Inside `restrict-assets?` and `as-contract?`, end with a plain value. Use `try!` on calls inside it.
- **`contract-hash?` is exact.** It fingerprints the deployed text, so whitespace and comments count. Approve the code exactly as deployed.
- **`stacks-block-time` comes from the block producer.** Good for hours and days. Don't rely on it to the second.
- **`secp256r1-verify` hashes again in Clarity 4.** It runs SHA-256 over the 32 bytes you pass before it checks. So pass the 32-byte message itself and sign it the normal WebCrypto way (ECDSA with SHA-256). A signature over a ready-made hash won't check, and passkey (WebAuthn) logins sign longer data, so they don't check directly. The tests prove both sides.
- **Device-key messages should name the app.** Put the app name and a week or nonce inside what gets signed, so a signature can't be reused somewhere else. The recipe already refuses the same message twice.

## Safety

These are teaching examples, checked on a simulated chain only. They haven't had an outside review. Get one before you use them with real money.

MIT licence.
