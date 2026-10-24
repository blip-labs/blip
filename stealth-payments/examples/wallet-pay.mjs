// Wallet integration example (scheme v2): turn a pay-me code into a ready-to-sign contract call
// with deny-mode post-conditions, so the payer's wallet refuses to send a single unit more than shown.
// Works with @stacks/transactions 7. TESTNET ONLY until reviewed.
import { Cl, Pc, PostConditionMode } from '@stacks/transactions';
import { derivePayment } from '../stealth2.js';

/**
 * @param code     pay-me code (tspstx1… / spstx1…)
 * @param payer    the payer's address (needed for post-conditions)
 * @param announcer  'ADDR.stealth-announcer-v2'
 * @param amount   micro-STX, or token base units if `token` is set
 * @param token    optional { contract: 'ADDR.name', asset: 'asset-name' } for a SIP-010 token such as sBTC
 * @param gas      micro-STX sent along for the receiver's future fees (token payments only)
 * Returns { network, addr, txOptions } to hand to a wallet (e.g. @stacks/connect `stx_callContract`).
 */
export function buildStealthPayment({ code, payer, announcer, amount, token, gas = 0 }) {
  const { addr, R, tag, network } = derivePayment(code);
  const [contractAddress, contractName] = announcer.split('.');
  const postConditions = [];
  let functionName, functionArgs;
  if (!token) {
    functionName = 'stealth-pay';
    functionArgs = [Cl.uint(amount), Cl.principal(addr), Cl.bufferFromHex(R), Cl.bufferFromHex(tag)];
    postConditions.push(Pc.principal(payer).willSendEq(amount).ustx());
  } else {
    functionName = 'stealth-pay-ft';
    functionArgs = [Cl.principal(token.contract), Cl.uint(amount), Cl.uint(gas), Cl.principal(addr), Cl.bufferFromHex(R), Cl.bufferFromHex(tag)];
    postConditions.push(Pc.principal(payer).willSendEq(amount).ft(token.contract, token.asset));
    if (gas > 0) postConditions.push(Pc.principal(payer).willSendEq(gas).ustx());
  }
  return { network, addr, txOptions: { contractAddress, contractName, functionName, functionArgs, postConditions, postConditionMode: PostConditionMode.Deny, network } };
}
