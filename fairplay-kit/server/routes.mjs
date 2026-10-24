// Fair Play Kit: the two server routes a game needs, ready for a Cloudflare Worker or any server with fetch and Response.
//   GET /api/anchor -> today's Bitcoin block and map seed ({ day, height, time, hash, seed }, or { day, pending: true } until it's mined)
//   GET /api/seal   -> the latest week sealed by the scoreboard contract ({ week, root, entries, top, url }), or 404 before the first seal
// Players' phones call only these. This server reads public chain data from the Stacks API; nothing personal is sent anywhere.
import { todaysAnchor } from '../seed/server.mjs';
import { dayKey } from '../seed/fairseed.js';

const json = (body, status = 200, maxAge = 60) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${maxAge}` } });

// contract: "ST....fairplay-board" once it's deployed (leave empty and /api/seal answers 404).
// chain: 'testnet' or 'mainnet' (mainnet only after an outside security review).
// apiKey: optional free Hiro API key (keep it a server secret). cache: optional Cache API object (in a Cloudflare Worker pass caches.default)
// so a found anchor is shared across server copies and the block APIs are asked about once a day.
export function fairplayRoutes({ contract = '', chain = 'testnet', fetchImpl = fetch, apiKey = '', cache = null } = {}) {
  const api = chain === 'mainnet' ? 'https://api.hiro.so' : 'https://api.testnet.hiro.so';
  let anchor = null, tried = 0, failed = null, seal = null, sealAt = 0;
  async function getAnchor(now) {
    const day = dayKey(now), key = `https://fairplay.internal/anchor/${day}`;
    if (anchor && anchor.day === day && !anchor.pending) return anchor;
    if (cache) { try { const hit = await cache.match(key); if (hit) { anchor = await hit.json(); return anchor; } } catch {} }
    // ask the block APIs at most once a minute, whether the last try was pending or failed
    if (now - tried < 60e3) { if (failed) throw failed; if (anchor && anchor.day === day) return anchor; }
    tried = now; failed = null;
    try { anchor = await todaysAnchor({ now, fetchImpl, apiKey }); }
    catch (e) { failed = e; throw e; }
    if (cache && !anchor.pending) { try { await cache.put(key, new Response(JSON.stringify(anchor), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=86400' } })); } catch {} }
    return anchor;
  }
  async function getSeal(now) {
    if (seal !== null && now - sealAt < 10 * 60e3) return seal;
    const r = await fetchImpl(`${api}/extended/v1/contract/${contract}/events?limit=20`);
    if (!r.ok) throw new Error('events API ' + r.status);
    const ev = ((await r.json()).results || []).map(e => ({ repr: (e.contract_log && e.contract_log.value && e.contract_log.value.repr) || '', tx: e.tx_id })).find(e => /\(event "seal-week"\)/.test(e.repr));
    if (!ev) { seal = false; sealAt = now; return seal; }
    const g = k => (ev.repr.match(new RegExp(`\\(${k} (u\\d+|0x[0-9a-f]{64})\\)`)) || [])[1];
    seal = ev && /^0x[0-9a-f]{64}$/.test(g('root') || '') && /^0x[0-9a-f]{64}$/.test(ev.tx || '')
      ? { week: +g('week').slice(1), root: g('root').slice(2), entries: +g('entries').slice(1), top: +g('top-score').slice(1), url: `https://explorer.hiro.so/txid/${ev.tx}?chain=${chain}` } : false;
    sealAt = now; return seal;
  }
  return async function route(path, now = Date.now()) {
    try {
      if (path === '/api/anchor') { const a = await getAnchor(now); return json(a, 200, a.pending ? 60 : 3600); }
      if (path === '/api/seal') { if (!contract) return json({ error: 'not sealed yet' }, 404); const s = await getSeal(now); return s ? json(s, 200, 600) : json({ error: 'not sealed yet' }, 404); }
    } catch (e) { return json({ error: 'chain API unreachable', detail: String(e.message || e).slice(0, 200) }, 503, 30); }
    return null; // not ours
  };
}
