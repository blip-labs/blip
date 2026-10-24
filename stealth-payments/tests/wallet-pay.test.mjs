// Checks the wallet example builds a real, signable transaction with deny-mode post-conditions.
import { makeContractCall, PostConditionMode, randomPrivateKey, getAddressFromPrivateKey, Cl } from '@stacks/transactions';
import { readFileSync } from 'node:fs';
import { buildStealthPayment } from '../examples/wallet-pay.mjs';
const V = JSON.parse(readFileSync(new URL('../vectors2.json', import.meta.url), 'utf8')).valid;
let fails = 0, passes = 0;
const chk = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); c ? passes++ : fails++; };
const sk = randomPrivateKey(), payer = getAddressFromPrivateKey(sk, 'testnet');
const ANN = 'ST2D8D06STMR3F2HF6PSYR40Q0YK15FF2KF5HD1TV.stealth-announcer-v2';
const SBTC = { contract: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token', asset: 'sbtc-token' };
for (const [label, opts] of [['STX', { amount: 5_000_000 }], ['sBTC + gas', { amount: 2500, token: SBTC, gas: 100_000 }]]) {
  const b = buildStealthPayment({ code: V[0].code, payer, announcer: ANN, ...opts });
  chk(b.network === 'testnet' && b.addr.startsWith('ST'), `${label}: network and fresh address come from the code`);
  chk(b.txOptions.postConditionMode === PostConditionMode.Deny, `${label}: deny mode`);
  chk(b.txOptions.postConditions.length === (opts.gas ? 2 : 1) && b.txOptions.postConditions.every(p => p.condition === 'eq'), `${label}: exact-amount post-conditions: ${JSON.stringify(b.txOptions.postConditions.map(p => [p.type, p.amount]))}`);
  const tx = await makeContractCall({ ...b.txOptions, senderKey: sk, fee: 1000, nonce: 0 });
  chk(tx.postConditionMode === PostConditionMode.Deny && tx.postConditions.values.length === b.txOptions.postConditions.length, `${label}: signs into a real transaction that keeps the post-conditions`);
}
let threw = false; try { buildStealthPayment({ code: V[0].code.slice(0, -1) + 'q', payer, announcer: ANN, amount: 1 }); } catch { threw = true; }
chk(threw, 'a mistyped code never builds a transaction');
console.log(`\n${passes} checks passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
