# Scoreboard fingerprint

- `canonical(entries)`: sorts `{name, score}` the same way everywhere (score high to low, then name A to Z) and writes one line each.
- `fingerprint(entries, week)`: SHA-256 of that text, as 64 hex characters. This is what goes into the contract.
- `weekOf(when)`: week number since Monday 2026-01-05 UTC.

Publish the full top-scores list on your board. Anyone can run `fingerprint()` on it and compare with the contract's `check-week`.
