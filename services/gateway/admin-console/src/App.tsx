import { Routes, Route } from 'react-router-dom';
import { RequireAuth } from './context/SessionContext';
import { LoginPage } from './routes/LoginPage';
import { AppShell } from './routes/AppShell';
import { OverviewPage } from './routes/OverviewPage';
import { ApiKeysPage } from './routes/ApiKeysPage';
import { UsagePage } from './routes/UsagePage';
import { SandboxPage } from './routes/SandboxPage';
import { CompliancePoliciesPage } from './routes/CompliancePoliciesPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<OverviewPage />} />
        <Route path="api-keys" element={<ApiKeysPage />} />
        <Route path="usage" element={<UsagePage />} />
        <Route path="sandbox" element={<SandboxPage />} />
        <Route path="compliance-policies" element={<CompliancePoliciesPage />} />
      </Route>
    </Routes>
  );
}
