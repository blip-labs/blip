import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fairplayRoutes } from '../server/routes.mjs';
const T = Date.UTC(2026, 9, 24, 12) / 1000;
const blocks = [{ burn_block_height: 972850, burn_block_time: T - 3600 * 11, burn_block_hash: '0x' + '11'.repeat(32) }, { burn_block_height: 972849, burn_block_time: T - 3600 * 12 + 793, burn_block_hash: '0x000000000000000000009d3d02bcbc8257429485e4026d15ddf82f85cfa36d63' }, { burn_block_height: 972848, burn_block_time: T - 3600 * 12 - 1380, burn_block_hash: '0x' + '22'.repeat(32) }];
const repr = '(tuple (entries u37) (event "seal-week") (root 0x' + 'b1'.repeat(32) + ') (top-score u18250) (week u42))';
function fake() { const calls = []; return { calls, fetchImpl: async u => { calls.push(u);
  if (u.includes('burn-blocks')) return new Response(JSON.stringify({ results: u.includes('offset=0') ? blocks : [] }));
  if (u.includes('/events')) return new Response(JSON.stringify({ results: [{ tx_id: '0x' + 'ab'.repeat(32), contract_log: { value: { repr } } }] }));
  return new Response('no', { status: 404 }); } }; }
test('anchor: real block for the day, cached', async () => {
  const f = fake(), r = fairplayRoutes({ fetchImpl: f.fetchImpl });
  const a = await (await r('/api/anchor', T * 1000)).json();
  assert.equal(a.height, 972849); assert.equal(a.seed, 2745670345); assert.equal(a.day, '2026-10-24');
  const n = f.calls.length; await r('/api/anchor', T * 1000 + 5000); assert.equal(f.calls.length, n, 'second call is cached');
});
test('seal: parses the contract event, testnet explorer link', async () => {
  const f = fake(), r = fairplayRoutes({ contract: 'ST1EXAMPLE.fairplay-board', fetchImpl: f.fetchImpl });
  const s = await (await r('/api/seal', T * 1000)).json();
  assert.deepEqual(s, { week: 42, root: 'b1'.repeat(32), entries: 37, top: 18250, url: 'https://explorer.hiro.so/txid/0x' + 'ab'.repeat(32) + '?chain=testnet' });
  assert.ok(f.calls[0].startsWith('https://api.testnet.hiro.so/'));
});
test('seal: 404 with no contract, 503 when the API is down, null for other paths', async () => {
  assert.equal((await fairplayRoutes()('/api/seal')).status, 404);
  const down = fairplayRoutes({ contract: 'ST1.x', fetchImpl: async () => new Response('x', { status: 500 }) });
  assert.equal((await down('/api/seal')).status, 503);
  assert.equal(await fairplayRoutes()('/api/score'), null);
  const none = fairplayRoutes({ contract: 'ST1.x', fetchImpl: async () => new Response(JSON.stringify({ results: [] })) });
  assert.equal((await none('/api/seal')).status, 404, 'no seal event yet is a 404');
});
const mp = blocks.map(b => ({ height: b.burn_block_height, timestamp: b.burn_block_time, id: b.burn_block_hash.slice(2) }));
test('anchor: falls back to mempool.space when Hiro refuses, and sends a User-Agent', async () => {
  const calls = []; const r = fairplayRoutes({ fetchImpl: async (u, o) => { calls.push([u, o && o.headers && o.headers['user-agent']]);
    if (u.includes('hiro')) return new Response('slow down', { status: 429 });
    if (u === 'https://mempool.space/api/v1/blocks') return new Response(JSON.stringify(mp));
    return new Response('[]'); } });
  const a = await (await r('/api/anchor', T * 1000)).json();
  assert.equal(a.height, 972849); assert.equal(a.seed, 2745670345);
  assert.ok(calls.every(c => c[1]), 'every call has a User-Agent');
});
test('anchor: after a failure, waits a minute before asking again, and says why', async () => {
  let n = 0; const r = fairplayRoutes({ fetchImpl: async () => { n++; return new Response('no', { status: 429 }); } });
  const res = await r('/api/anchor', T * 1000); assert.equal(res.status, 503); assert.match((await res.json()).detail, /hiro 429; mempool 429/);
  const n1 = n; assert.equal((await r('/api/anchor', T * 1000 + 30e3)).status, 503); assert.equal(n, n1, 'no new calls inside the minute');
  await r('/api/anchor', T * 1000 + 61e3); assert.ok(n > n1, 'asks again after a minute');
});
test('anchor: shared cache means a second server copy asks no API', async () => {
  const store = new Map(), cache = { match: async k => store.has(k) ? new Response(store.get(k)) : undefined, put: async (k, v) => store.set(k, await v.text()) };
  const f = fake(); await fairplayRoutes({ fetchImpl: f.fetchImpl, cache })('/api/anchor', T * 1000);
  let n = 0; const a = await (await fairplayRoutes({ fetchImpl: async () => { n++; return new Response('no', { status: 500 }); }, cache })('/api/anchor', T * 1000)).json();
  assert.equal(a.height, 972849); assert.equal(n, 0);
});
