// Known-contract registry. Resolves an address to a human label so
// approval / sign popups can show "Camelot V2 Router" instead of a raw 0x
// blob. Also lets us flag explicitly-trusted addresses (a green tick) and
// explicitly-bad addresses (e.g. known scam routers).

export type ContractTrust = 'verified' | 'neutral' | 'flagged';

export interface KnownContract {
  address: string;       // checksummed
  name: string;
  trust: ContractTrust;
  category?: 'router' | 'token' | 'nft' | 'bridge' | 'other';
}

const RAW: KnownContract[] = [
  // Camelot
  { address: '0x18E621B64d7808c3C47bccbbD7485d23F257D26f', name: 'Camelot V2 Router', trust: 'verified', category: 'router' },
  { address: '0x7d8c6B58BA2d40FC6E34C25f9A488067Fe0D2dB4', name: 'Camelot V2 Factory', trust: 'verified', category: 'other' },
  { address: '0xC69Dc28924930583024E067b2B3d773018F4EB52', name: 'Camelot V3 SwapRouter', trust: 'verified', category: 'router' },
  { address: '0x60A186019F81bFD04aFc16c9C01804a04E79e68B', name: 'Camelot V3 Quoter', trust: 'verified', category: 'other' },
  { address: '0x10aA510d94E094Bd643677bd2964c3EE085Daffc', name: 'Camelot V3 Factory', trust: 'verified', category: 'other' },
  // Tokens
  { address: '0x48b62137EdfA95a428D35C09E44256a739F6B557', name: 'Wrapped APE (WAPE)', trust: 'verified', category: 'token' },
];

const BY_LOWER = new Map(RAW.map((c) => [c.address.toLowerCase(), c]));

export function lookupContract(address: string | undefined | null): KnownContract | null {
  if (!address) return null;
  return BY_LOWER.get(address.toLowerCase()) ?? null;
}

export function labelFor(address: string | undefined | null): string {
  if (!address) return '—';
  const c = lookupContract(address);
  if (c) return c.name;
  return address;
}
