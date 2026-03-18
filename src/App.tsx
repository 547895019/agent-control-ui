import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAppStore } from './stores/useAppStore';
import { LoginPage } from './pages/LoginPage';
import { DashboardLayout } from './components/shared/DashboardLayout';
import { AgentsPage } from './pages/AgentsPage';
import { OrgPage } from './pages/OrgPage';
import { EditorPage } from './pages/EditorPage';
import { MonitorPage } from './pages/MonitorPage';

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
          <Route path="editor" element={<EditorPage />} />
          <Route path="monitor" element={<MonitorPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
