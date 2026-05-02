// Map common ethers / EVM RPC errors to friendlier messages.

const PATTERNS: Array<{ test: RegExp; message: string }> = [
  { test: /insufficient funds/i, message: 'Not enough APE to cover the transaction (amount + gas).' },
  { test: /nonce too low/i, message: 'Nonce too low — try again, the wallet will refresh.' },
  { test: /replacement (transaction )?underpriced/i, message: 'Replacement gas price is too low. Increase gas and retry.' },
  { test: /transaction underpriced/i, message: 'Gas price too low to be accepted by the network. Try again.' },
  { test: /already known/i, message: 'Transaction was already submitted.' },
  { test: /max fee.*lower than/i, message: 'Max fee per gas is lower than required base fee. Retry.' },
  { test: /execution reverted/i, message: 'Transaction reverted. The contract refused the call.' },
  { test: /user rejected/i, message: 'User rejected the request.' },
  { test: /could not detect network/i, message: 'Could not connect to ApeChain RPC.' },
];

export function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? 'Unknown error');
  for (const p of PATTERNS) {
    if (p.test.test(msg)) return p.message;
  }
  return msg;
}
