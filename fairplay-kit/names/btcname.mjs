// Fair Play Kit: .btc names, server side and read-only.
// A player who chooses to sign in with a Stacks wallet can show their .btc name (BNS) on the board instead of a typed nickname.
// It only READS a public name. It never asks for keys and never sends a transaction. Players without a wallet keep their nickname.
// Run it on your own server, so players' phones only talk to you.

const API = 'https://api.hiro.so/v1/addresses/stacks/';
const ADDR = /^S[PMTN][0-9A-HJKMNP-TV-Z]{38,40}$/; // mainnet SP/SM, testnet ST/SN

// Returns the address's .btc name (like "satoshi.btc") or null.
export async function btcName(address, { fetchImpl = fetch } = {}) {
  if (!ADDR.test(String(address))) throw new Error('not a Stacks address');
  const r = await fetchImpl(API + address);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('name API ' + r.status);
  const j = await r.json();
  const n = (j.names || []).find(x => /^[a-z0-9-_]{1,48}\.btc$/.test(x));
  return n || null;
}

// What the board shows: the .btc name when there is one, else the player's own nickname.
export function displayName(nickname, name) { return name || String(nickname || 'player').slice(0, 24); }
