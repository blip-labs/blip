// Fair Play Kit: duel links.
// A duel is a link that carries everything the other player needs: which game, which day's block-seeded map, the score to beat,
// and (optionally) a wallet signature that proves who sent it. No server needed: the link IS the duel.

export const VERSION = 1;

// d: { game, day, height, hash8, score, name, sig?, pubkey? }
// game: short id ("gr"), day: "2026-10-24", height: anchor block height, hash8: first 8 hex chars of the anchor hash.
export function encodeDuel(d) {
  const p = { v: VERSION, g: d.game, d: d.day, h: d.height, x: d.hash8, s: d.score, n: d.name };
  if (d.sig) { p.sig = d.sig; p.pk = d.pubkey; }
  p.c = check(p);
  return b64url(JSON.stringify(p));
}

// Returns the duel, or throws with a plain reason. The check code catches typos and broken links, not cheating:
// a signature (or a replay, in later versions) is what proves a score.
export function decodeDuel(code) {
  let p;
  try { p = JSON.parse(unb64url(code)); } catch { throw new Error('this duel link is broken'); }
  if (p.v !== VERSION) throw new Error('this duel link is from a different version');
  if (p.c !== check(p)) throw new Error('this duel link was changed or cut short');
  if (!Number.isInteger(p.s) || p.s < 0 || !Number.isInteger(p.h) || !/^[0-9a-f]{8}$/.test(p.x)) throw new Error('this duel link has bad numbers');
  return { game: p.g, day: p.d, height: p.h, hash8: p.x, score: p.s, name: String(p.n || '').slice(0, 24), sig: p.sig || null, pubkey: p.pk || null };
}

// The exact text a wallet signs (Stacks "sign message"). Signing moves no money and costs nothing.
export function duelMessage(d) { return `Fair Play duel v${VERSION}\ngame: ${d.game}\nday: ${d.day}\nblock: ${d.height} ${d.hash8}\nscore: ${d.score}\nname: ${d.name}`; }

// Same map? Both players must be on the same anchor block.
export function sameMap(a, b) { return a.height === b.height && a.hash8 === b.hash8 && a.game === b.game; }

// Who won. Ties go to whoever posted first (the challenger).
export function result(challenge, mine) {
  if (!sameMap(challenge, mine)) return 'different-map';
  return mine.score > challenge.score ? 'win' : 'lose';
}

function check(p) {
  const s = [p.v, p.g, p.d, p.h, p.x, p.s, p.n, p.sig || '', p.pk || ''].join('|');
  let h = 2166136261; // FNV-1a, 32 bit
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
function b64url(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64url(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return decodeURIComponent(escape(atob(s))); }
