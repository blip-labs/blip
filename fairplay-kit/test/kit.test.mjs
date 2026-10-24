import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayStart, dayKey, pickAnchor, seedFromHash, rng, verifySeed } from '../seed/fairseed.js';
import { todaysAnchor } from '../seed/server.mjs';
import { encodeDuel, decodeDuel, result, sameMap, duelMessage } from '../duel/duel.js';
import { canonical, fingerprint, weekOf } from '../board/fingerprint.js';

const H = '00000000000000000000b5c487d89cbb1529b2dee4f1033d17cc9c703f77d6f7';
const mid = Date.UTC(2026, 9, 24) / 1000;

test('day helpers', () => { assert.equal(dayStart(Date.UTC(2026, 9, 24, 13, 5)), mid); assert.equal(dayKey(Date.UTC(2026, 9, 24, 23, 59)), '2026-10-24'); });
test('seed is stable and 32-bit', () => { const s = seedFromHash(H); assert.equal(s, seedFromHash('0x' + H.toUpperCase())); assert.ok(s >= 0 && s < 2 ** 32); assert.ok(verifySeed(H, s)); assert.ok(!verifySeed(H, s + 1)); });
test('different hashes, different seeds', () => assert.notEqual(seedFromHash(H), seedFromHash(H.replace(/f7$/, 'f8'))));
test('bad hash refused', () => assert.throws(() => seedFromHash('abc')));
test('rng repeats exactly', () => { const a = rng(42), b = rng(42); for (let i = 0; i < 1000; i++) assert.equal(a(), b()); const r = rng(7)(); assert.ok(r >= 0 && r < 1); });
test('rng matches the game generator', () => { // same formula Genesis Run already uses
  const game = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  for (const s of [1, 12345, 0xdeadbeef, seedFromHash(H)]) { const a = rng(s), b = game(s); for (let i = 0; i < 200; i++) assert.equal(a(), b()); } });
test('anchor = lowest height at or after midnight', () => {
  const B = [{ height: 100, time: mid - 900, hash: H }, { height: 101, time: mid + 30, hash: H.replace(/f7$/, '01') }, { height: 102, time: mid + 600, hash: H.replace(/f7$/, '02') }];
  assert.equal(pickAnchor(B, mid).height, 101);
  assert.equal(pickAnchor(B.slice(0, 1), mid), null, 'pending until mined');
  assert.equal(pickAnchor(B.slice(1), mid), null, 'list must reach back past midnight');
  // a fast miner clock: block 99 stamped after midnight wins, because it is lower
  assert.equal(pickAnchor([{ height: 99, time: mid + 5, hash: H }, ...B], mid).height, 99);
});
test('server reads pages until past midnight, plus one', async () => {
  const chain = []; for (let h = 1000; h >= 800; h--) chain.push({ burn_block_height: h, burn_block_time: mid + (h - 900) * 600, burn_block_hash: '0x' + h.toString(16).padStart(64, '0') });
  let calls = 0; const fetchImpl = async u => { calls++; const off = +new URL(u).searchParams.get('offset'); return { ok: true, json: async () => ({ results: chain.slice(off, off + 30) }) }; };
  const a = await todaysAnchor({ now: (mid + 3600 * 20) * 1000, fetchImpl });
  assert.equal(a.height, 900); assert.equal(a.seed, seedFromHash(a.hash)); assert.equal(a.day, '2026-10-24'); assert.ok(calls <= 6, 'calls ' + calls);
  const p = await todaysAnchor({ now: (mid + 3600 * 20) * 1000, fetchImpl: async u => ({ ok: true, json: async () => ({ results: chain.filter(b => b.burn_block_height < 900).slice(+new URL(u).searchParams.get('offset'), +new URL(u).searchParams.get('offset') + 30) }) }) });
  assert.equal(p.pending, true);
});
const D = { game: 'gr', day: '2026-10-24', height: 972812, hash8: '00000000', score: 48200, name: 'satoshi.btc' };
test('duel link round trip', () => { const c = encodeDuel(D); assert.match(c, /^[A-Za-z0-9_-]+$/); assert.deepEqual(decodeDuel(c), { ...D, sig: null, pubkey: null }); });
test('changed duel link refused', () => { const c = encodeDuel(D), j = JSON.parse(Buffer.from(c, 'base64url').toString()); j.s = 99999; assert.throws(() => decodeDuel(Buffer.from(JSON.stringify(j)).toString('base64url')), /changed/); assert.throws(() => decodeDuel('###'), /broken/); });
test('duel unicode name', () => { const c = encodeDuel({ ...D, name: 'Blip ⚡' }); assert.equal(decodeDuel(c).name, 'Blip ⚡'); });
test('duel results', () => { assert.equal(result(D, { ...D, score: 50000 }), 'win'); assert.equal(result(D, { ...D, score: 48200 }), 'lose'); assert.equal(result(D, { ...D, height: 1 }), 'different-map'); assert.ok(sameMap(D, { ...D })); assert.match(duelMessage(D), /score: 48200/); });
test('fingerprint: order and edits matter, input order does not', async () => {
  const E = [{ name: 'a', score: 10 }, { name: 'b', score: 30 }, { name: 'c', score: 30 }];
  assert.equal(canonical(E), '1|b|30\n2|c|30\n3|a|10');
  const f = await fingerprint(E, 42); assert.match(f, /^[0-9a-f]{64}$/);
  assert.equal(f, await fingerprint([...E].reverse(), 42));
  assert.notEqual(f, await fingerprint([{ ...E[0], score: 11 }, E[1], E[2]], 42));
  assert.notEqual(f, await fingerprint(E, 43));
  assert.equal(weekOf(Date.UTC(2026, 0, 5)), 0); assert.equal(weekOf(Date.UTC(2026, 0, 12, 1)), 1);
});
import { btcName, displayName } from '../names/btcname.mjs';
test('.btc names: read-only lookup', async () => {
  const fake = names => async () => ({ ok: true, status: 200, json: async () => ({ names }) });
  const addr = 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7';
  assert.equal(await btcName(addr, { fetchImpl: fake(['blip.btc']) }), 'blip.btc');
  assert.equal(await btcName(addr, { fetchImpl: fake(['other.stx']) }), null, 'only .btc names');
  assert.equal(await btcName(addr, { fetchImpl: fake(['<script>.btc']) }), null, 'odd names refused');
  assert.equal(await btcName(addr, { fetchImpl: async () => ({ ok: false, status: 404 }) }), null);
  await assert.rejects(btcName('not-an-address', { fetchImpl: fake([]) }), /not a Stacks address/);
  assert.equal(displayName('nick', 'blip.btc'), 'blip.btc'); assert.equal(displayName('nick', null), 'nick');
});
