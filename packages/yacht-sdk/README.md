# @yacht/sdk

Tiny TypeScript helper for detecting and integrating with the Yacht ApeChain
browser-extension wallet from a dApp.

Yacht implements the standard EIP-1193 (`request({ method, params })`) and
EIP-6963 (multi-wallet discovery) surfaces, so it works out-of-the-box with
ethers, viem, web3.js, and wagmi. This SDK adds a small race-tolerant detection
helper for "is Yacht installed".

## Install

```sh
npm install @yacht/sdk
```

## Usage

```ts
import { getYacht, connect } from '@yacht/sdk';

const yacht = await getYacht();
if (!yacht) {
  alert('Install Yacht');
  return;
}
const [address] = await yacht.request<string[]>({ method: 'eth_requestAccounts' });
const chainId = await yacht.request<string>({ method: 'eth_chainId' });
```

## API

- `getYacht(timeoutMs?: number)` — returns the provider if installed, else `null`.
- `connect()` — convenience wrapper that throws if not installed.
- `getAddress()` — returns `{ address, chainId, network }` for the active account.
- `listEvmProviders()` — enumerates every EIP-6963 provider on the page.
