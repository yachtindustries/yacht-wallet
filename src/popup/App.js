import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import Chat from './screens/Chat';
export default function App() {
    const { initialized, unlocked, refreshStatus, refreshSettings } = useApp();
    const loc = useLocation();
    const isRequestRoute = loc.pathname.startsWith('/request/');
    useEffect(() => {
        void refreshStatus();
        void refreshSettings();
    }, [refreshStatus, refreshSettings]);
    if (isRequestRoute) {
        return (_jsx(Routes, { children: _jsx(Route, { path: "/request/:id", element: _jsx(RequestApproval, {}) }) }));
    }
    if (!initialized) {
        return (_jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(Welcome, {}) }), _jsx(Route, { path: "/create", element: _jsx(CreateWallet, {}) }), _jsx(Route, { path: "/import", element: _jsx(ImportWallet, {}) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/", replace: true }) })] }));
    }
    if (!unlocked) {
        return (_jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(Unlock, {}) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/", replace: true }) })] }));
    }
    return (_jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(Dashboard, {}) }), _jsx(Route, { path: "/send", element: _jsx(Send, {}) }), _jsx(Route, { path: "/receive", element: _jsx(Receive, {}) }), _jsx(Route, { path: "/swap", element: _jsx(Swap, {}) }), _jsx(Route, { path: "/search", element: _jsx(SearchScreen, {}) }), _jsx(Route, { path: "/token/:address", element: _jsx(TokenDetail, {}) }), _jsx(Route, { path: "/history", element: _jsx(History, {}) }), _jsx(Route, { path: "/chat", element: _jsx(Chat, {}) }), _jsx(Route, { path: "/settings", element: _jsx(Settings, {}) }), _jsx(Route, { path: "/settings/sites", element: _jsx(ConnectedSites, {}) }), _jsx(Route, { path: "/accounts", element: _jsx(Accounts, {}) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/", replace: true }) })] }));
}
