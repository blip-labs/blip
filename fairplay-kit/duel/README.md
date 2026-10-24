# Duel links

A duel is a link. It carries `game`, `day`, the anchor `height`, the first 8 hex characters of the anchor hash, the `score`, a `name`, and optionally a signature.

- `encodeDuel(d)` makes the link code. `decodeDuel(code)` reads it, or throws a plain reason ("this duel link was changed or cut short").
- `sameMap(a, b)`: true only when both are on the same anchor block. `result(challenge, mine)` returns `win`, `lose` or `different-map`.
- `duelMessage(d)` is the exact text a wallet signs with Stacks "sign message". Signing moves no money and costs nothing.

**What the check code does:** it catches typos and broken links. It does not stop cheating: a signature proves who sent a score, and a replay (later) proves how it was made.
