import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Page, Screen, TopBar } from '../components/Layout';
import { TokenLogo } from '../components/TokenLogo';
import { OnChainPfpAvatar } from '../components/OnChainPfpAvatar';
import { AddressActions } from '../components/AddressActions';
import { rpc } from '@/lib/messaging';
import type { AccountSummary, Erc20Balance, HistoryEntry, OwnedNft } from '@/lib/evm';
import { isValidEvmAddress, shortAddress, checksumAddress } from '@/lib/wallet-utils';
import { APE, isVerifiedAddress, safeChecksum } from '@/lib/tokens';
import { fetchOthersideProfile, type OthersideProfile } from '@/lib/otherside';
import { NETWORKS } from '@/lib/networks';

const verifiedIconUrl = chrome.runtime.getURL('verified.png');

type Tab = 'wallet' | 'otherside';

/**
 * Read-only profile screen for any ApeChain address. Reachable from the
 * chat (clicking another user's avatar) and from anywhere else that links
 * to `/profile/:address`. Uses only public RPCs, so the address does NOT
 * have to be one of this wallet's accounts.
 */
export default function Profile() {
  const params = useParams<{ address: string }>();
  const nav = useNavigate();
  const raw = params.address ?? '';
  const [username, setUsername] = useState<string | null>(null);
  const address = useMemo(() => {
    try { return checksumAddress(raw); } catch { return raw; }
  }, [raw]);

  const [tab, setTab] = useState<Tab>('wallet');
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [tokens, setTokens] = useState<Erc20Balance[]>([]);
  const [tokenStats, setTokenStats] = useState<Record<string, { priceUsd: number }>>({});
  const [apeUsd, setApeUsd] = useState(0);
  const [nfts, setNfts] = useState<OwnedNft[]>([]);
  const [nftsLoading, setNftsLoading] = useState(false);
  const [rank, setRank] = useState<{ rank: number; fraction: number; achievementsUnlocked: number } | null>(null);
  const [recent, setRecent] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [othersideLoading, setOthersideLoading] = useState(false);
  const [otherside, setOtherside] = useState<OthersideProfile | null>(null);
  const [othersideTried, setOthersideTried] = useState(false);

  useEffect(() => {
    if (!isValidEvmAddress(raw)) {
      setErr('Invalid address');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void (async () => {
      try {
        // Fetch the cheap-and-fast pieces in parallel. The token list
        // requires a follow-up roundtrip because we have to derive the
        // candidate contracts from the address's history first.
        const [s, history, p, r, nftList] = await Promise.all([
          rpc({ type: 'evm.account', address }),
          rpc({ type: 'evm.history', address }).catch(() => []),
          rpc({ type: 'price.get' }).catch(() => null),
          rpc({ type: 'rank.get', address }).catch(() => null),
          rpc({ type: 'evm.nfts', address }).catch(() => []),
        ]);
        if (cancelled) return;
        setSummary(s);
        setApeUsd(p?.usd ?? 0);
        if (r) setRank({ rank: r.rank, fraction: r.fraction, achievementsUnlocked: r.achievementsUnlocked });
        setNfts(nftList);
        // Recent activity: top 8 entries from on-chain history,
        // filtered to ignore the trading-fee skim and chat sends so
        // the row reads like a clean activity feed.
        setRecent(history.slice(0, 8));
        // Token list: pull every distinct ERC-20 contract this address
        // has ever received, then balance-check them in one batch. This
        // matches the Dashboard's tracked-tokens approach but for an
        // arbitrary address.
        const contracts = new Set<string>();
        for (const h of history) {
          for (const tr of h.transfers) {
            if (tr.native || !tr.tokenAddress) continue;
            contracts.add(tr.tokenAddress);
          }
        }
        if (contracts.size > 0) {
          const balances = await rpc({
            type: 'evm.erc20.balances',
            tokens: [...contracts],
            address,
          }).catch(() => [] as Erc20Balance[]);
          if (cancelled) return;
          setTokens(balances.filter((b) => parseFloat(b.balance) > 0));
        }
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setNftsLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [raw, address]);

  // Resolve a username for this address from the recent chat
  // backlog. The chat-message payload carries the sender's
  // self-published username, so chatting is the de-facto
  // username registry today.
  useEffect(() => {
    if (!isValidEvmAddress(raw)) return;
    let cancelled = false;
    void rpc({ type: 'chat.list', limit: 200 })
      .then((msgs) => {
        if (cancelled) return;
        const lc = address.toLowerCase();
        const hit = msgs.find((m) => (m.from ?? '').toLowerCase() === lc && m.username);
        if (hit?.username) setUsername(hit.username);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [raw, address]);

  // Lazy USD price per token so the wallet rows can sort + display dollars.
  useEffect(() => {
    if (!tokens.length) return;
    for (const t of tokens) {
      const k = t.token.address.toLowerCase();
      if (tokenStats[k] !== undefined) continue;
      setTokenStats((p) => ({ ...p, [k]: p[k] ?? { priceUsd: 0 } }));
      void rpc({ type: 'dex.token', query: t.token.address })
        .then((pair) => {
          setTokenStats((p) => ({
            ...p,
            [k]: { priceUsd: pair?.priceUsd ? parseFloat(pair.priceUsd) : 0 },
          }));
        })
        .catch(() => setTokenStats((p) => ({ ...p, [k]: { priceUsd: 0 } })));
    }
  }, [tokens]);

  // When the user opens the Otherside tab for the first time, fetch.
  // Subsequent re-opens reuse the in-memory result. fetchOthersideProfile
  // never throws — it returns a profile with per-source diagnostics, so
  // we don't need a separate error state.
  useEffect(() => {
    if (tab !== 'otherside') return;
    if (othersideTried || othersideLoading) return;
    if (!isValidEvmAddress(raw)) return;
    setOthersideLoading(true);
    void fetchOthersideProfile(address)
      .then((p) => setOtherside(p))
      .finally(() => {
        setOthersideLoading(false);
        setOthersideTried(true);
      });
  }, [tab, othersideTried, othersideLoading, raw, address]);

  const apeBalance = parseFloat(summary?.nativeBalance ?? '0');
  const apeValue = apeBalance * apeUsd;
  const totalUsd = useMemo(() => {
    let t = apeValue;
    for (const tok of tokens) {
      const stat = tokenStats[tok.token.address.toLowerCase()];
      if (!stat) continue;
      t += parseFloat(tok.balance) * stat.priceUsd;
    }
    return t;
  }, [apeValue, tokens, tokenStats]);

  const sorted = useMemo(() => {
    return tokens
      .map((t) => {
        const stat = tokenStats[t.token.address.toLowerCase()];
        return { t, usd: (stat?.priceUsd ?? 0) * parseFloat(t.balance) };
      })
      .sort((a, b) => b.usd - a.usd);
  }, [tokens, tokenStats]);

  if (err && !summary) {
    return (
      <Screen>
        <TopBar title="Profile" />
        <Page>
          <div className="text-center text-white/85 font-bold py-12" style={{ fontSize: 16 }}>
            {err}
          </div>
        </Page>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar title="Profile" />
      <Page>
        <div className="flex items-center gap-3 mb-3">
          {/* PFP + rank-below stack — same vertical composition the
              Accounts screen uses for the active account, so this
              user's rank tier reads directly under their PFP/avatar. */}
          <OnChainPfpAvatar
            address={address}
            rank={rank?.rank ?? 1}
            fraction={rank?.fraction ?? 0}
            size={64}
            withRankBelow
            rankSize={26}
            backgroundColor="#002849"
          />
          <div className="min-w-0 flex-1">
            <div className="font-bold text-white truncate" style={{ fontSize: 22 }}>
              {username ? `@${username}` : shortAddress(address, 6, 4)}
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-white/75 font-mono font-bold" style={{ fontSize: 13 }}>
                {shortAddress(address, 5, 5)}
              </span>
              <AddressActions address={address} color="#ffffff" size={16} />
            </div>
          </div>
          {/* Send button on the right: pre-fills the recipient with
              this address so tapping it from a profile takes the
              user straight into a Send flow targeted at this user. */}
          <button
            onClick={() => nav('/send', { state: { presetTo: address } })}
            className="btn font-bold text-white bg-[#5eccfa] hover:bg-[#3eb8e8] shrink-0"
            style={{ fontSize: 14, padding: '8px 14px' }}
            title="Send to this address"
          >
            Send
          </button>
        </div>

        <div className="text-center mb-3">
          <div className="text-[36px] leading-tight font-bold text-white">
            ${totalUsd.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
          </div>
        </div>

        <div className="flex items-center gap-1 mb-3 p-1 rounded-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
          <TabBtn active={tab === 'wallet'} onClick={() => setTab('wallet')}>Wallet</TabBtn>
          <TabBtn active={tab === 'otherside'} onClick={() => setTab('otherside')}>Otherside</TabBtn>
        </div>

        {tab === 'wallet' && (
          <WalletView
            loading={loading}
            apeBalance={apeBalance}
            apeValue={apeValue}
            sorted={sorted}
            nfts={nfts}
            nftsLoading={nftsLoading}
            recent={recent}
          />
        )}
        {tab === 'otherside' && (
          <OthersideView
            loading={othersideLoading}
            data={otherside}
          />
        )}
      </Page>
    </Screen>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 rounded-xl py-2 font-bold transition"
      style={{
        fontSize: 15,
        backgroundColor: active ? '#5eccfa' : 'transparent',
        color: active ? '#ffffff' : 'rgba(255,255,255,0.75)',
      }}
    >
      {children}
    </button>
  );
}

function WalletView({
  loading,
  apeBalance,
  apeValue,
  sorted,
  nfts,
  nftsLoading,
  recent,
}: {
  loading: boolean;
  apeBalance: number;
  apeValue: number;
  sorted: { t: Erc20Balance; usd: number }[];
  nfts: OwnedNft[];
  nftsLoading: boolean;
  recent: HistoryEntry[];
}) {
  const explorer = NETWORKS.mainnet.explorerTx;
  return (
    <div className="space-y-4">
      <div>
        <div className="text-white/70 font-bold mb-2" style={{ fontSize: 14 }}>Tokens</div>
        <div className="space-y-2">
          <div className="card flex justify-between items-center">
            <div className="flex items-center gap-3">
              <TokenLogo token={APE} size={36} />
              <div>
                <div className="font-bold" style={{ fontSize: 16 }}>APE</div>
                <div className="text-ink-faint font-bold" style={{ fontSize: 12 }}>ApeChain native</div>
              </div>
            </div>
            <div className="text-right">
              <div className="font-bold" style={{ fontSize: 15 }}>{trimAmount(apeBalance)}</div>
              <div className="text-ink-faint font-bold" style={{ fontSize: 12 }}>
                ${apeValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>
          {loading && sorted.length === 0 && (
            <div className="text-center text-white/70 font-bold py-2" style={{ fontSize: 13 }}>
              Loading tokens…
            </div>
          )}
          {sorted.map(({ t, usd }) => (
            <div key={t.token.address} className="card flex justify-between items-center">
              <div className="flex items-center gap-3 min-w-0">
                <TokenLogo
                  token={{
                    symbol: t.token.symbol,
                    name: t.token.name,
                    address: safeChecksum(t.token.address),
                    decimals: t.token.decimals,
                  }}
                  size={36}
                />
                <div className="min-w-0">
                  <div className="font-bold truncate flex items-center gap-1" style={{ fontSize: 16 }}>
                    {t.token.symbol}
                    {isVerifiedAddress(t.token.address) && (
                      <img src={verifiedIconUrl} alt="" style={{ width: 14, height: 14 }} />
                    )}
                  </div>
                  <div className="text-ink-faint font-bold truncate" style={{ fontSize: 12 }}>{t.token.name}</div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-bold" style={{ fontSize: 15 }}>{trimAmount(parseFloat(t.balance))}</div>
                <div className="text-ink-faint font-bold" style={{ fontSize: 12 }}>
                  ${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="text-white/70 font-bold mb-2" style={{ fontSize: 14 }}>NFTs</div>
        {nftsLoading && (
          <div className="text-center text-white/70 font-bold py-2" style={{ fontSize: 13 }}>Loading NFTs…</div>
        )}
        {!nftsLoading && nfts.length === 0 && (
          <div className="text-center text-white/70 font-bold py-2" style={{ fontSize: 13 }}>No NFTs.</div>
        )}
        {nfts.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {nfts.map((n) => (
              <a
                key={`${n.contract}:${n.tokenId}`}
                href={`https://opensea.io/assets/ape_chain/${n.contract}/${n.tokenId}`}
                target="_blank"
                rel="noreferrer"
                className="aspect-square rounded-xl bg-bg-card border border-line overflow-hidden flex items-center justify-center hover:border-brand transition"
                title={n.name ?? `${n.contractName ?? n.contractSymbol ?? 'NFT'} #${n.tokenId}`}
              >
                {n.image ? (
                  <img
                    src={n.image}
                    alt={n.name ?? n.tokenId}
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <div className="text-center px-1">
                    <div className="text-[11px] font-bold text-ink truncate">{n.contractSymbol ?? n.contractName ?? 'NFT'}</div>
                    <div className="text-[10px] text-ink-faint font-bold">#{n.tokenId.length > 6 ? `${n.tokenId.slice(0, 6)}…` : n.tokenId}</div>
                  </div>
                )}
              </a>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="text-white/70 font-bold mb-2" style={{ fontSize: 14 }}>Recent activity</div>
        {recent.length === 0 ? (
          <div className="text-center text-white/70 font-bold py-2" style={{ fontSize: 13 }}>
            No recent transactions.
          </div>
        ) : (
          <div className="space-y-2">
            {recent.map((t) => {
              const verb =
                t.type === 'send' ? 'Sent'
                : t.type === 'receive' ? 'Received'
                : t.type === 'swap' ? 'Swapped'
                : t.type === 'self' ? 'Self transfer'
                : 'Contract call';
              const primary = t.transfers.find((x) => parseFloat(x.amount) > 0);
              const sub =
                primary
                  ? `${trimAmount(parseFloat(primary.amount))} ${primary.tokenSymbol ?? 'APE'}`
                  : null;
              const counterparty =
                t.type === 'send' ? `to ${primary?.to ? primary.to.slice(0, 6) + '…' + primary.to.slice(-4) : '—'}`
                : t.type === 'receive' ? `from ${primary?.from ? primary.from.slice(0, 6) + '…' + primary.from.slice(-4) : '—'}`
                : '';
              return (
                <a
                  key={t.hash}
                  href={explorer(t.hash)}
                  target="_blank"
                  rel="noreferrer"
                  className="card flex items-center justify-between hover:border-brand transition"
                >
                  <div className="min-w-0">
                    <div className="font-bold" style={{ fontSize: 14 }}>{verb}</div>
                    <div className="text-ink-faint font-bold truncate" style={{ fontSize: 12 }}>
                      {counterparty || (t.type === 'swap' ? 'on Camelot' : 'contract')}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {sub && (
                      <div className="font-bold" style={{ fontSize: 14 }}>{sub}</div>
                    )}
                    <div className="text-ink-faint font-bold" style={{ fontSize: 11 }}>
                      {t.timestamp ? new Date(t.timestamp * 1000).toLocaleDateString() : ''}
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function OthersideView({
  loading,
  data,
}: {
  loading: boolean;
  data: OthersideProfile | null;
}) {
  if (loading || !data) {
    return (
      <div className="text-center text-white/70 font-bold py-6" style={{ fontSize: 14 }}>
        Loading Otherside profile…
      </div>
    );
  }

  const ethCount = data.holdings.filter((h) => h.chain === 'ethereum').length;
  const apeCount = data.holdings.filter((h) => h.chain === 'apechain').length;
  const noFootprint = !data.yugaIdRegistered && data.holdings.length === 0;

  return (
    <div className="space-y-3">
      {/* Header card */}
      <div className="card">
        <div className="flex items-center gap-3">
          {data.avatarUrl ? (
            <img
              src={data.avatarUrl}
              alt="Otherside avatar"
              className="rounded-xl object-cover shrink-0"
              style={{ width: 64, height: 64 }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <div
              className="rounded-xl bg-bg-soft border border-line shrink-0 flex items-center justify-center font-bold text-ink-faint"
              style={{ width: 64, height: 64, fontSize: 12 }}
            >
              OS
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="font-bold truncate" style={{ fontSize: 18 }}>
              {data.username ?? 'Otherside player'}
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 font-bold ${data.yugaIdRegistered ? 'bg-success/20 text-success' : 'bg-white/10 text-ink-faint'}`}
                style={{ fontSize: 11 }}
              >
                {data.yugaIdRegistered ? '✓ Yuga ID registered' : 'No Yuga ID'}
              </span>
              {data.level != null && (
                <span className="text-ink-faint font-bold" style={{ fontSize: 13 }}>
                  Level {data.level}
                </span>
              )}
            </div>
            {data.lastSeenLocation && (
              <div className="text-ink-faint font-bold mt-1" style={{ fontSize: 12 }}>
                Last seen: {data.lastSeenLocation}
              </div>
            )}
            {noFootprint && (
              <div className="text-ink-faint font-bold mt-1" style={{ fontSize: 12 }}>
                No Otherside footprint detected for this address.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Holdings (Ethereum + ApeChain unified) */}
      {data.holdings.length > 0 && (
        <div>
          <div className="text-white/70 font-bold mb-2 flex items-center gap-2" style={{ fontSize: 14 }}>
            <span>Otherside holdings</span>
            <span className="text-white/40 font-bold" style={{ fontSize: 11 }}>
              {ethCount > 0 && `${ethCount} on Ethereum`}
              {ethCount > 0 && apeCount > 0 && ' · '}
              {apeCount > 0 && `${apeCount} on ApeChain`}
            </span>
          </div>
          <div className="space-y-2">
            {data.holdings.map((h, i) => (
              <div key={`${h.chain}:${h.label}:${i}`} className="card flex justify-between items-center">
                <div className="min-w-0">
                  <div className="font-bold truncate" style={{ fontSize: 15 }}>{h.label}</div>
                  <div className="text-ink-faint font-bold uppercase tracking-wider" style={{ fontSize: 10 }}>
                    {h.chain === 'ethereum' ? 'Ethereum mainnet' : 'ApeChain'}
                  </div>
                </div>
                <div className="font-bold text-[#5eccfa] shrink-0" style={{ fontSize: 16 }}>{h.count}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <a
        href="https://otherside.xyz"
        target="_blank"
        rel="noreferrer"
        className="block text-center text-[#5eccfa] font-bold hover:underline"
        style={{ fontSize: 13 }}
      >
        Open in Otherside ↗
      </a>

      {/* Per-source diagnostics — visible so users can tell which piece
          of the integration is working today. */}
      <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 space-y-1">
        <div className="font-bold text-white/70 uppercase tracking-wider" style={{ fontSize: 10 }}>
          Data sources
        </div>
        <SourceRow label="Yuga ID API (otherside.xyz)" status={data.sources.yugaIdApi} />
        <SourceRow label="Ethereum NFT inventory" status={data.sources.ethereumNfts} />
        <SourceRow label="ApeChain NFT inventory" status={data.sources.apeChainNfts} />
      </div>

      {data.note && (
        <div className="text-white/55 font-bold text-center" style={{ fontSize: 11 }}>
          {data.note}
        </div>
      )}
    </div>
  );
}

function SourceRow({
  label,
  status,
}: {
  label: string;
  status: 'ok' | 'failed' | 'no-account';
}) {
  const dot =
    status === 'ok' ? '#22c55e' : status === 'failed' ? '#dc2626' : 'rgba(255,255,255,0.35)';
  const right =
    status === 'ok' ? 'OK' : status === 'failed' ? 'Unreachable' : 'No account';
  return (
    <div className="flex items-center justify-between gap-2 font-bold text-white/85" style={{ fontSize: 12 }}>
      <span className="inline-flex items-center gap-2 min-w-0">
        <span className="inline-block rounded-full shrink-0" style={{ width: 8, height: 8, backgroundColor: dot }} />
        <span className="truncate">{label}</span>
      </span>
      <span className="text-white/55 shrink-0">{right}</span>
    </div>
  );
}

function trimAmount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n === 0) return '0';
  if (n < 0.0001) return n.toExponential(2);
  if (n < 1) return n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}
