// needs: npm i playwright, and the example served on 127.0.0.1:8124
import { chromium } from 'playwright';
const b = await chromium.launch();
let fails = 0; const chk = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
async function play(url, shot) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.route('**/*', r => /^http:\/\/(127\.0\.0\.1|localhost)/.test(r.request().url()) ? r.continue() : r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  let link = null; p.on('dialog', async d => { link = d.defaultValue(); await d.dismiss(); });
  await p.goto(url); await p.waitForTimeout(600);
  const bh = await p.locator('#bh').textContent(), box = await p.locator('#duelBox').isVisible() ? await p.locator('#duelBox').textContent() : null;
  await p.locator('#go').tap(); await p.waitForFunction(() => !document.getElementById('share').hidden, null, { timeout: 60000 });
  const msg = await p.locator('#msg').textContent();
  await p.locator('#copy').tap(); await p.waitForTimeout(300);
  if (!link) link = await p.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  if (shot) await p.screenshot({ path: shot, fullPage: true });
  await ctx.close(); return { bh, box, msg, link, errs };
}
const base = 'http://127.0.0.1:8124/example/index.html';
const a = await play(base, 'test/example-1.png');
chk(a.bh === '972,849', 'shows the real block: ' + a.bh);
const s1 = +a.msg.match(/Score (\d+)/)[1]; chk(s1 > 0, 'a run gets a score: ' + a.msg);
chk(a.link && a.link.includes('?duel='), 'makes a duel link: ' + (a.link || '').slice(0, 80));
const b2 = await play(base);
chk(b2.msg === a.msg, 'same block, same run (no input): ' + b2.msg);
const c = await play(a.link.replace(/^https?:\/\/[^/]+/, 'http://127.0.0.1:8124'), 'test/example-duel.png');
chk(/player scored \d+ on this map/.test(c.box || ''), 'friend sees the duel: ' + c.box);
chk(/They win this one|You win/.test(c.msg), 'duel result shown: ' + c.msg);
chk(![a, b2, c].some(x => x.errs.length), 'no page errors ' + JSON.stringify([a, b2, c].flatMap(x => x.errs)));
await b.close(); console.log(fails ? 'FAILED ' + fails : 'ALL PASS');
