// Fair Play Kit: block seed.
// Turns a real Bitcoin block hash into the seed for a day's map, so every player gets the same map and nobody can pick it.
// The rule: a day's anchor is the FIRST Bitcoin block (lowest height) whose timestamp is at or after 00:00 UTC that day.
// Once that block exists the anchor never changes, because no block can be added below it.
// Until it is mined, the day has no anchor yet: show "the next map arrives with the next block".

export const DAY_MS = 864e5;

// 00:00 UTC of the day containing `when` (a Date or ms), in seconds.
export function dayStart(when = Date.now()) {
  const d = new Date(when);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
}

// "2026-10-24" style key for the day containing `when`.
export function dayKey(when = Date.now()) {
  return new Date(dayStart(when) * 1000).toISOString().slice(0, 10);
}

// blocks: [{ height, time, hash }] in any order (time in seconds, hash hex with or without 0x).
// Returns the anchor block for the day starting at `start`, or null if it isn't mined yet
// The caller must pass every block from well before `start` (2+ hours, since Bitcoin timestamps can run fast) up to the tip.
export function pickAnchor(blocks, start) {
  const s = [...blocks].sort((a, b) => a.height - b.height);
  if (!s.some(b => b.time < start)) return null; // the list must reach back past midnight
  for (const b of s) if (b.time >= start) return { height: b.height, time: b.time, hash: clean(b.hash) };
  return null;
}

// 32-bit seed from a 32-byte block hash: XOR of its eight 32-bit words.
export function seedFromHash(hash) {
  const h = clean(hash);
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error('need a 64-hex-character block hash');
  let x = 0;
  for (let i = 0; i < 64; i += 8) x ^= parseInt(h.slice(i, i + 8), 16);
  return x >>> 0;
}

// Small fast seeded random numbers (mulberry32). Same seed, same numbers, on every device.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Anyone can re-check a map: same hash in, same seed out.
export function verifySeed(hash, seed) { return seedFromHash(hash) === (seed >>> 0); }

// A public explorer page for the block, for "check it yourself" buttons.
export function explorerUrl(height) { return `https://mempool.space/block/${height}`; }

function clean(h) { return String(h).toLowerCase().replace(/^0x/, ''); }
