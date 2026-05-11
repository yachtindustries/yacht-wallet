// Per-account chat usernames. Each account in the wallet has its own
// `@username` displayed wherever the chat would otherwise show the raw EOA
// address. Usernames are local-only (we don't broadcast them as a separate
// claim), but every chat message we send is prefixed with `@{username}\n`
// so other Yacht clients can render the same name. Tipping/explorer
// linking always resolves through the on-chain address — usernames are
// vanity, not authentication.
//
// Validation rules:
//  • lowercase ASCII alphanumerics + underscore
//  • length 3..20
//  • generated default is `{word}yacht{5-digit-number}` (e.g. "saltyyacht04829")

const STORAGE_KEY = 'yacht.usernames.v1';

const WORDS = [
  'blue', 'sail', 'wave', 'ship', 'crew', 'dock', 'port', 'helm', 'rope',
  'gold', 'bay', 'sea', 'sun', 'reef', 'tide', 'star', 'wind', 'salty',
  'plank', 'knot', 'sailor', 'breeze', 'harbor', 'cove', 'crest', 'ahoy',
  'mate', 'anchor', 'jolly', 'swab', 'rigging', 'calm', 'navy', 'compass',
  'helm', 'pearl', 'coral', 'lagoon', 'mermaid', 'kraken', 'siren', 'shore',
];

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const USERNAME_REGEX = /^[a-z0-9_]+$/;

export interface UsernameStore { [accountId: string]: string; }

async function readStore(): Promise<UsernameStore> {
  try {
    const r = await chrome.storage.local.get(STORAGE_KEY);
    const v = r[STORAGE_KEY];
    return v && typeof v === 'object' ? (v as UsernameStore) : {};
  } catch {
    return {};
  }
}

async function writeStore(s: UsernameStore): Promise<void> {
  try { await chrome.storage.local.set({ [STORAGE_KEY]: s }); } catch { /* best effort */ }
}

export function generateUsername(): string {
  const word = WORDS[Math.floor(Math.random() * WORDS.length)];
  const num = String(Math.floor(Math.random() * 100_000)).padStart(5, '0');
  return `${word}yacht${num}`.toLowerCase().slice(0, USERNAME_MAX);
}

export function validateUsername(u: string): { ok: boolean; reason?: string } {
  const trimmed = u.trim().toLowerCase();
  if (trimmed.length < USERNAME_MIN) return { ok: false, reason: `Min ${USERNAME_MIN} characters` };
  if (trimmed.length > USERNAME_MAX) return { ok: false, reason: `Max ${USERNAME_MAX} characters` };
  if (!USERNAME_REGEX.test(trimmed)) return { ok: false, reason: 'Letters, numbers, underscores only' };
  return { ok: true };
}

/**
 * Read the username for an account, generating + persisting one on first
 * call so a freshly-created account never appears with a blank handle.
 */
export async function getOrCreateUsername(accountId: string): Promise<string> {
  const store = await readStore();
  const existing = store[accountId];
  if (existing && validateUsername(existing).ok) return existing;
  const fresh = generateUsername();
  store[accountId] = fresh;
  await writeStore(store);
  return fresh;
}

export async function setUsername(accountId: string, name: string): Promise<string> {
  const v = validateUsername(name);
  if (!v.ok) throw new Error(v.reason ?? 'Invalid username');
  const norm = name.trim().toLowerCase();
  const store = await readStore();
  store[accountId] = norm;
  await writeStore(store);
  return norm;
}

export async function readAllUsernames(): Promise<UsernameStore> {
  return readStore();
}
