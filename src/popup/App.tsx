import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useApp } from './store';
import Welcome from './screens/Welcome';
import CreateWallet from './screens/CreateWallet';
import ImportWallet from './screens/ImportWallet';
import Unlock from './screens/Unlock';
import Dashboard from './screens/Dashboard';
import Send from './screens/Send';
import Receive from './screens/Receive';
import Swap from './screens/Swap';
import SearchScreen from './screens/Search';
import TokenDetail from './screens/TokenDetail';
import History from './screens/History';
import Settings from './screens/Settings';
import Accounts from './screens/Accounts';
import ConnectedSites from './screens/ConnectedSites';
import RequestApproval from './screens/RequestApproval';

export default function App() {
  const { initialized, unlocked, refreshStatus, refreshSettings } = useApp();
  const loc = useLocation();
  const isRequestRoute = loc.pathname.startsWith('/request/');

  useEffect(() => {
    void refreshStatus();
    void refreshSettings();
  }, [refreshStatus, refreshSettings]);

  if (isRequestRoute) {
    return (
      <Routes>
        <Route path="/request/:id" element={<RequestApproval />} />
      </Routes>
    );
  }

  if (!initialized) {
    return (
      <Routes>
        <Route path="/" element={<Welcome />} />
        <Route path="/create" element={<CreateWallet />} />
        <Route path="/import" element={<ImportWallet />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  if (!unlocked) {
    return (
      <Routes>
        <Route path="/" element={<Unlock />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/send" element={<Send />} />
      <Route path="/receive" element={<Receive />} />
      <Route path="/swap" element={<Swap />} />
      <Route path="/search" element={<SearchScreen />} />
      <Route path="/token/:address" element={<TokenDetail />} />
      <Route path="/history" element={<History />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/settings/sites" element={<ConnectedSites />} />
      <Route path="/accounts" element={<Accounts />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
