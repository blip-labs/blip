// Fair Play Kit: scoreboard fingerprint.
// Turns a week's top scores into one 32-byte fingerprint (SHA-256). The fingerprint goes into the Clarity contract;
// the full list stays on your own board. Anyone can recompute the fingerprint from the list and compare it with the contract.
// Change one score, one name or the order, and the fingerprint no longer matches.

// entries: [{ name, score }]. Sorted the same way everywhere: score high to low, then name A to Z.
export function canonical(entries) {
  return [...entries]
    .map(e => ({ name: String(e.name).trim().slice(0, 24), score: Math.floor(Number(e.score)) }))
    .sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((e, i) => `${i + 1}|${e.name}|${e.score}`)
    .join('\n');
}

// Returns the fingerprint as 64 hex characters (what the contract stores as a 32-byte buffer).
export async function fingerprint(entries, week) {
  const text = `Fair Play board v1\nweek: ${week}\n` + canonical(entries);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Week number used by the contract: whole weeks since Monday 2026-01-05 00:00 UTC.
export function weekOf(when = Date.now()) { return Math.floor((new Date(when).getTime() - Date.UTC(2026, 0, 5)) / 6048e5); }
