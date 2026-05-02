import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Page, Screen, TopBar } from '../components/Layout';
import { useApp } from '../store';
import { CopyButton } from '../components/Copy';

export default function Receive() {
  const { meta } = useApp();
  const active = meta?.publicAccounts.find((a) => a.id === meta?.activeAccountId);
  const [qr, setQr] = useState<string>('');

  useEffect(() => {
    if (!active) return;
    QRCode.toDataURL(active.address, { margin: 1, width: 220, color: { dark: '#f3e9da', light: '#1c130a' } }).then(setQr);
  }, [active?.address]);

  if (!active) return null;
  return (
    <Screen>
      <TopBar title="Receive" />
      <Page className="flex flex-col items-center text-center">
        <div className="card flex flex-col items-center w-full">
          {qr && <img src={qr} alt="address QR" className="rounded-xl" />}
          <div className="font-mono text-xs mt-3 break-all select-all">{active.address}</div>
          <div className="mt-2"><CopyButton text={active.address} label="Copy address" /></div>
        </div>
        <p className="text-xs text-ink-faint mt-4 max-w-[280px]">
          Only send APE and ApeChain (chain id 33139) ERC-20 tokens to this address.
          Sending tokens from another chain will result in lost funds.
        </p>
      </Page>
    </Screen>
  );
}
