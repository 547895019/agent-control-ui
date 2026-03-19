import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAppStore } from './stores/useAppStore';
import { LoginPage } from './pages/LoginPage';
import { DashboardLayout } from './components/shared/DashboardLayout';
import { AgentsPage } from './pages/AgentsPage';
import { OrgPage } from './pages/OrgPage';
import { MonitorPage } from './pages/MonitorPage';
import { CronPage } from './pages/CronPage';

function App() {
  const { token, connect, connectionStatus } = useAppStore();

  useEffect(() => {
    if (token && connectionStatus === 'disconnected') {
      connect().catch(() => {});
    }
  }, [token, connect, connectionStatus]);

  if (!token) {
    return <LoginPage />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardLayout />}>
          <Route index element={<Navigate to="/agents" replace />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="org" element={<OrgPage />} />
          <Route path="monitor" element={<MonitorPage />} />
          <Route path="cron" element={<CronPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
