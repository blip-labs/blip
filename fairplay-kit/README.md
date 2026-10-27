# Fair Play Kit

Small open tools that make Stacks games provably fair. Drop in the parts you want. Genesis Run is the first game to use it.

Provably fair: see the math and what it doesn't prove → https://blip-yield.blipyield.workers.dev/fair/

| Part | What it does | File |
|---|---|---|
| Block seed | Today's map comes from a real Bitcoin block hash, so every player gets the same map and nobody can pick it. | `seed/` |
| Duel links | A challenge link carries the map, the score to beat and an optional wallet signature. No game server needed. | `duel/` |
| Scoreboard fingerprint | One SHA-256 fingerprint of a week's top scores. Change any score and it no longer matches. | `board/` |
| Scoreboard contract | A tiny Clarity contract that stores each week's fingerprint once and never lets it change. | `contract/` |
| .btc names | Players who opt in can show their .btc name on the board. Read-only. | `names/` |
| Server routes | `/api/anchor` and `/api/seal`, ready for a Cloudflare Worker or any server. | `server/` |
| Example game | "Block Dodge", about 100 lines, uses the block seed and duel links. | `example/` |
| Starter | One command makes a new game folder with all of the above, the tests and the example. | `starter/` |

**House rules for the kit:** no wallet needed to play, no token, no money prizes, no keys ever asked for. Signing is always optional.

## Start a new game

```
node starter/create-fair-game.mjs my-game
cd my-game && npm install && npm test && npm start
```

## Try it

```
node --test test/kit.test.mjs test/routes.test.mjs test/anchorfix.test.mjs   # the JavaScript parts (24 checks)
python3 -m http.server 8124          # then open http://localhost:8124/example/
```

The contract has its own checks: see `contract/README.md`.

## How the parts fit

1. Your server answers `/api/anchor` with `server/routes.mjs`, handing players today's anchor block and seed. Players' phones only talk to your server.
2. Your game makes every random choice from `rng(seed)` and steps at a fixed rate, so the same block gives the same map on every phone.
3. After a run, `encodeDuel()` makes a link. A friend's game opens it with `decodeDuel()` and plays the same map.
4. Once a week, `fingerprint()` turns the top scores into 64 hex characters, and you seal them with `seal-week` in the contract.
5. Anyone can recompute the fingerprint from your public board and call `check-week` to compare.

## Status

Testnet proof. The contract is not on mainnet. Mainnet waits for an outside security review.

## Local-first report card

1. Fast: yes. Games play with no waiting. The seed is fetched once a day and cached.
2. All your devices: yes. Plain JavaScript and one Clarity file, no accounts.
3. Offline: mostly. A game can keep the last seed and play offline; only the daily seed and sealing need the internet.
4. Works with others: yes. Duels and .btc names are optional.
5. Outlives us: yes. The fingerprints live on Stacks and Bitcoin, the code is open, and any Stacks API can replace Hiro.
6. Private: players' phones talk only to the game's own server. The server reads public chain data. Nothing personal goes on-chain, only fingerprints.
7. You're in control: boards are plain JSON, fingerprints can be recomputed by anyone, and nothing is hidden.
