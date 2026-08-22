import { Routes, Route } from 'react-router-dom';
import { RequireAuth } from './context/SessionContext';
import { LoginPage } from './routes/LoginPage';
import { AppShell } from './routes/AppShell';
import { OverviewPage } from './routes/OverviewPage';
import { CheckoutSessionsPage } from './routes/CheckoutSessionsPage';
import { WebhookDeliveriesPage } from './routes/WebhookDeliveriesPage';
import { SettingsPage } from './routes/SettingsPage';

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
        <Route path="sessions" element={<CheckoutSessionsPage />} />
        <Route path="deliveries" element={<WebhookDeliveriesPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
