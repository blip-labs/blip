# Scoreboard contract (Clarity)

`fairplay-board.clar`:

- `seal-week (week, root, entries, top-score)`: owner only. Writes once. A sealed week can never be overwritten, not even by the owner.
- `get-week (week)`, `check-week (week, root)`: anyone can read and check.
- `bitcoin-block-hash (height)`: the chain's own record of a Bitcoin block hash, so a map's seed can be checked on-chain. (Clarity may return the bytes in the opposite order to explorers.)

The owner check uses `contract-caller`, so another contract can't trick the owner into sealing.

## Checks

`test/board.test.mjs` runs 11 checks on a simulated chain with the Clarinet SDK: strangers can't seal, empty weeks are refused, sealed weeks can't change, reads and checks work, and the Bitcoin hash read works.

```
npm i @hirosystems/clarinet-sdk @stacks/transactions
node test/board.test.mjs
```

`settings/Devnet.toml` needs Clarinet's test accounts (run `clarinet` to make them). Never put a real seed phrase in this folder.

## Deploying

Testnet first, from the owner's own computer, with a testnet wallet. Mainnet only after an outside security review.
