# Block seed

**Rule:** a day's anchor is the first Bitcoin block (lowest height) with a timestamp at or after 00:00 UTC. Its hash becomes the seed.

- `dayStart(when)`, `dayKey(when)`: midnight UTC and a "2026-10-24" key.
- `pickAnchor(blocks, start)`: picks the anchor from a list of `{height, time, hash}`. Returns `null` while it isn't mined yet.
- `seedFromHash(hash)`: XOR of the hash's eight 32-bit words, giving one 32-bit seed.
- `rng(seed)`: seeded random numbers (mulberry32). Same seed, same numbers, on every device.
- `verifySeed(hash, seed)`, `explorerUrl(height)`: for "check it yourself" buttons.
- `server.mjs`, `todaysAnchor()`: reads recent blocks from the public Stacks API and returns today's anchor, or `{pending: true}`.

**Why "first block after midnight":** once that block exists, nothing can come before it, so the anchor never changes. Until it's mined (usually within 10 minutes), show "the next map arrives with the next block".

**Good to know:** Bitcoin timestamps can run up to 2 hours fast, so `todaysAnchor` reads a little past midnight. A block can very rarely be replaced in the first minutes (a reorg), so cache the anchor after it has a few blocks on top. The hash is shown as explorers show it (leading zeros first).
