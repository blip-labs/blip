// Anchor gap fix: Hiro's list skips Bitcoin blocks with no Stacks block. Checks the real 2026-10-27 case (973,313 missing
// from Hiro) picks 973,313 via mempool.space from 2026-10-28 on, keeps the old answer for days before, and a clean list
// still uses Hiro. Fake fetch, no network.
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { todaysAnchor, GAP_CHECK_FROM } from '../seed/server.mjs';
const H = h => h.toString(16).padStart(64, '0');
// blocks around a midnight: heights 100..140, ~10 min apart, block 120 is the first after midnight
function chain(mid) { const bs = []; for (let h = 140; h >= 100; h--) bs.push({ height: h, time: mid + (h - 120) * 600 + 21, hash: H(h) }); return bs; }
function fetcher(bs, hiroSkip) {
  return async url => {
    if (url.includes('api.hiro.so')) { const off = +new URL(url).searchParams.get('offset'); const list = bs.filter(b => !hiroSkip.includes(b.height)).slice(off, off + 30);
      return { ok: true, json: async () => ({ results: list.map(b => ({ burn_block_height: b.height, burn_block_time: b.time, burn_block_hash: '0x' + b.hash })) }) }; }
    const m = url.match(/blocks\/(\d+)$/), below = m ? +m[1] : Infinity, list = bs.filter(b => b.height <= below).slice(0, 15);
    return { ok: true, json: async () => list.map(b => ({ height: b.height, timestamp: b.time, id: b.hash })) };
  };
}
test('from 2026-10-28: Hiro missing the first block after midnight -> mempool.space gives the true first block', async () => {
  const mid = GAP_CHECK_FROM / 1000, a = await todaysAnchor({ now: (mid + 7200) * 1000, fetchImpl: fetcher(chain(mid), [120]) });
  assert.equal(a.height, 120); assert.equal(a.day, '2026-10-28');
});
test('before 2026-10-28: old rule kept (same anchor as already served that day)', async () => {
  const mid = GAP_CHECK_FROM / 1000 - 86400, a = await todaysAnchor({ now: (mid + 7200) * 1000, fetchImpl: fetcher(chain(mid), [120]) });
  assert.equal(a.height, 121);
});
test('a clean Hiro list still uses Hiro and gives the first block', async () => {
  const mid = GAP_CHECK_FROM / 1000 + 86400; let mem = 0; const f = fetcher(chain(mid), []);
  const a = await todaysAnchor({ now: (mid + 7200) * 1000, fetchImpl: async u => { if (u.includes('mempool')) mem++; return f(u); } });
  assert.equal(a.height, 120); assert.equal(mem, 0);
});
test('a gap far from midnight does not matter', async () => {
  const mid = GAP_CHECK_FROM / 1000 + 86400; let mem = 0; const f = fetcher(chain(mid), [101]);
  const a = await todaysAnchor({ now: (mid + 7200) * 1000, fetchImpl: async u => { if (u.includes('mempool')) mem++; return f(u); } });
  assert.equal(a.height, 120); assert.equal(mem, 0);
});
