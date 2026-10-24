#!/usr/bin/env node
// Fair Play Kit starter: one command makes a new game folder with the kit's code, the scoreboard contract, their tests and the tiny example game.
//   node starter/create-fair-game.mjs my-game
// It only copies files. It installs nothing, asks for no wallet and reads no keys. Then: cd my-game && npm install && npm test && npm start
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2];
if (!name || !/^[a-z][a-z0-9-]{1,40}$/.test(name)) { console.error('Usage: node create-fair-game.mjs my-game   (lowercase letters, numbers and dashes)'); process.exit(1); }
const out = resolve(process.cwd(), name);
if (existsSync(out) && readdirSync(out).length) { console.error(`${name}/ already exists and isn't empty. Pick another name.`); process.exit(1); }

const read = p => readFileSync(join(KIT, p), 'utf8');
const files = {};
// the kit's code goes in lib/, with imports pointing at each other there
for (const [from, to] of [['seed/fairseed.js', 'lib/fairseed.js'], ['seed/server.mjs', 'lib/server.mjs'], ['duel/duel.js', 'lib/duel.js'], ['board/fingerprint.js', 'lib/fingerprint.js'], ['names/btcname.mjs', 'lib/btcname.mjs']]) files[to] = read(from);
files['lib/routes.mjs'] = read('server/routes.mjs').replace(/'\.\.\/seed\//g, "'./");
files['tests/kit.test.mjs'] = read('test/kit.test.mjs').replace(/'\.\.\/(seed|duel|board|names)\//g, "'../lib/");
files['tests/routes.test.mjs'] = read('test/routes.test.mjs').replace("'../server/routes.mjs'", "'../lib/routes.mjs'");
// the contract and its simulator test, laid out the way Clarinet expects
files['contracts/fairplay-board.clar'] = read('contract/fairplay-board.clar');
files['tests/board.test.mjs'] = read('contract/test/board.test.mjs');
files['Clarinet.toml'] = `[project]\nname = "${name}"\nrequirements = []\n[contracts.fairplay-board]\npath = "contracts/fairplay-board.clar"\nclarity_version = 3\nepoch = "3.1"\n`;
// Clarinet's own public test accounts (the same ones every new Clarinet project gets). They only work in the simulator. Never send real coins to them.
files['settings/Devnet.toml'] = `# Clarinet's public test accounts, for the simulator only. Never fund these and never put a real seed phrase here.
[network]
name = "devnet"
[accounts.deployer]
mnemonic = "twice kind fence tip hidden tilt action fragile skin nothing glory cousin green tomorrow spring wrist shed math olympic multiply hip blue scout claw"
balance = 100_000_000_000_000
[accounts.wallet_1]
mnemonic = "sell invite acquire kitten bamboo drastic jelly vivid peace spawn twice guilt pave pen trash pretty park cube fragile unaware remain midnight betray rebuild"
balance = 100_000_000_000_000
`;
// the example game, now reading today's block from your own server first
files['game/index.html'] = read('example/index.html')
  .replace(/'\.\.\/(seed|duel)\//g, "'../lib/")
  .replace("// In a real game, fetch this from your own server (see seed/server.mjs). Here it's a saved real block.\nconst A = await (await fetch('anchor.json')).json();",
    "// Today's block comes from your own server (serve.mjs). If it isn't there or today's block isn't mined yet, a saved real block is used.\nconst load = async u => { try { const r = await fetch(u); const j = r.ok ? await r.json() : null; return j && j.hash ? j : null; } catch { return null; } };\nconst A = (await load('/api/anchor')) || (await load('anchor.json'));");
files['game/anchor.json'] = read('example/anchor.json');
files['serve.mjs'] = `// A tiny local server: serves the game plus /api/anchor (today's Bitcoin block) and /api/seal (the latest sealed week, once you set CONTRACT).
// Players' phones only ever talk to this server. lib/routes.mjs drops into a Cloudflare Worker the same way.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fairplayRoutes } from './lib/routes.mjs';
const PORT = +process.env.PORT || 8124, ROOT = new URL('.', import.meta.url).pathname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const route = fairplayRoutes({ contract: process.env.CONTRACT || '', chain: 'testnet' });
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), api = await route(url.pathname);
  if (api) { res.writeHead(api.status, Object.fromEntries(api.headers)); return res.end(await api.text()); }
  const path = normalize(url.pathname === '/' ? '/game/index.html' : url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname);
  if (path.includes('..') || !/^\\/(game|lib)\\//.test(path)) { res.writeHead(404); return res.end('not found'); }
  try { const body = await readFile(join(ROOT, path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('not found'); }
}).listen(PORT, '127.0.0.1', () => console.log('Your fair game: http://localhost:' + PORT + '/'));
`;
files['package.json'] = JSON.stringify({ name, private: true, type: 'module', scripts: { test: 'node --test tests/kit.test.mjs tests/routes.test.mjs && node tests/board.test.mjs', start: 'node serve.mjs' }, devDependencies: { '@hirosystems/clarinet-sdk': '^3.8.1', '@stacks/transactions': '^7.6.0' } }, null, 2) + '\n';
files['.gitignore'] = 'node_modules/\n.cache/\ndeployments/\n';
files['README.md'] = `# ${name}

Made with the Fair Play Kit starter. Everything a provably fair Stacks game needs, ready to change.

\`\`\`
npm install     # the Clarinet simulator, for the contract checks only
npm test        # kit checks + contract checks
npm start       # then open http://localhost:8124/
\`\`\`

| Folder | What's in it |
|---|---|
| \`game/\` | Block Dodge, a tiny example. Swap in your own game. Make every random choice from \`rng(seed)\` and step at a fixed rate. |
| \`lib/\` | The kit: block seed, duel links, board fingerprint, .btc names, and the server-side anchor reader. |
| \`contracts/\` | \`fairplay-board.clar\`: seals each week's board fingerprint once, forever. |
| \`tests/\` | Checks for all of the above. |
| \`serve.mjs\` | A local server with \`/api/anchor\`, so players' phones only talk to you. |

House rules: no wallet needed to play, no token, no money prizes, never ask anyone for keys. Signing is optional.

Deploy the contract to testnet first, from your own computer. Get an outside security review before mainnet.
`;
for (const [p, body] of Object.entries(files)) { mkdirSync(dirname(join(out, p)), { recursive: true }); writeFileSync(join(out, p), body); }
console.log(`Made ${name}/ with ${Object.keys(files).length} files.\nNext:\n  cd ${name}\n  npm install\n  npm test\n  npm start`);
