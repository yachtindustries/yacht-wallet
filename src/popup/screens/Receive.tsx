import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Page, Screen, TopBar } from '../components/Layout';
import { useApp } from '../store';

const QR_SIZE = 240;

export default function Receive() {
  const { meta } = useApp();
  const active = meta?.publicAccounts.find((a) => a.id === meta?.activeAccountId);
  const [qr, setQr] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!active) return;
    QRCode.toDataURL(active.address, {
      margin: 1,
      width: QR_SIZE,
      color: { dark: '#ffffff', light: '#002849' },
    }).then(setQr);
  }, [active?.address]);

  async function copy() {
    if (!active) return;
    await navigator.clipboard.writeText(active.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (!active) return null;
  return (
    <Screen>
      <TopBar title="Receive" tone="deck" />
      <Page tone="deck" className="flex flex-col items-center text-center">
        <div className="flex flex-col items-center" style={{ width: QR_SIZE }}>
          {qr && <img src={qr} alt="address QR" />}
          <button
            type="button"
            onClick={copy}
            className="bg-white rounded-xl px-3 py-3 break-all font-bold w-full text-center hover:opacity-90"
            style={{ marginTop: '20%', fontSize: 16, color: '#002849' }}
            aria-label="Copy address"
            title="Click to copy"
          >
            {active.address}
          </button>
          <button
            onClick={copy}
            className="mt-3 px-6 py-2 rounded-xl bg-[#5eccfa] hover:bg-[#3eb8e8] text-white font-bold w-full"
            style={{ fontSize: 15 }}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <p
          className="text-white mt-auto pt-4 font-bold"
          style={{ fontSize: 12 }}
        >
          Only Send ApeChain Tokens to this Address
        </p>
      </Page>
    </Screen>
  );
}
