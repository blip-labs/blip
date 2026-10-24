// Fair Play Kit: block seed, server side.
// Run this on YOUR server (for example a Cloudflare Worker) so players' phones only talk to you.
// It reads recent Bitcoin blocks from a public API (Hiro first, mempool.space if Hiro fails) and returns today's anchor.
import { dayStart, dayKey, pickAnchor, seedFromHash } from './fairseed.js';

const UA = 'FairPlayKit/1.0 (+https://github.com/blip-labs)';

// Hiro: newest first, 30 per page.
async function* hiroPages(fetchImpl, apiKey) {
  const headers = { 'user-agent': UA, accept: 'application/json', ...(apiKey ? { 'x-api-key': apiKey } : {}) };
  for (let page = 0; ; page++) {
    const r = await fetchImpl(`https://api.hiro.so/extended/v2/burn-blocks?limit=30&offset=${page * 30}`, { headers });
    if (!r.ok) throw new Error('hiro ' + r.status);
    yield ((await r.json()).results || []).map(b => ({ height: b.burn_block_height, time: b.burn_block_time, hash: b.burn_block_hash }));
  }
}
// mempool.space: newest first, 15 per page, each page starts below the last one.
async function* mempoolPages(fetchImpl) {
  let below = '';
  for (;;) {
    const r = await fetchImpl('https://mempool.space/api/v1/blocks' + below, { headers: { 'user-agent': UA, accept: 'application/json' } });
    if (!r.ok) throw new Error('mempool ' + r.status);
    const page = (await r.json()).map(b => ({ height: b.height, time: b.timestamp, hash: b.id }));
    yield page;
    if (!page.length) return;
    below = '/' + (Math.min(...page.map(b => b.height)) - 1);
  }
}
async function fromSource(pages, start, maxPages) {
  const blocks = []; let extra = -1, n = 0;
  for await (const page of pages) { // Bitcoin timestamps can run up to 2 hours fast, so read one more page past midnight
    blocks.push(...page);
    if (extra < 0 && blocks.some(b => b.time < start)) extra = n + 1;
    if (n === extra || !page.length || ++n >= maxPages + (extra >= 0 ? 1 : 0)) break;
  }
  if (!blocks.some(b => b.time < start)) throw new Error('could not reach back to midnight');
  return pickAnchor(blocks, start);
}

// Returns { day, pending: true } until the anchor block is mined, then { day, height, time, hash, seed }.
// Cache the answer for the rest of the day once it isn't pending: it never changes.
// apiKey (optional): a free Hiro API key, kept as a server secret, never in the repo.
export async function todaysAnchor({ now = Date.now(), fetchImpl = fetch, maxPages = 12, apiKey = '' } = {}) {
  const start = dayStart(now), errs = [];
  for (const pages of [() => hiroPages(fetchImpl, apiKey), () => mempoolPages(fetchImpl)]) {
    try {
      const a = await fromSource(pages(), start, maxPages);
      return a ? { day: dayKey(now), ...a, seed: seedFromHash(a.hash) } : { day: dayKey(now), pending: true };
    } catch (e) { errs.push(e.message); }
  }
  throw new Error(errs.join('; '));
}
