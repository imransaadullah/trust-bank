import { Routes, Route } from 'react-router-dom';
import { RequireAuth, RequireRole } from './context/SessionContext';
import { LoginFlow } from './routes/LoginFlow';
import { AppShell } from './routes/AppShell';
import { BranchesPage } from './routes/BranchesPage';
import { OpenAccountPage } from './routes/OpenAccountPage';
import { OriginateLoanPage } from './routes/OriginateLoanPage';
import { ApprovalsListPage } from './routes/approvals/ApprovalsListPage';
import { ApprovalDetailPage } from './routes/approvals/ApprovalDetailPage';
import { NewApprovalRequestPage } from './routes/approvals/NewApprovalRequestPage';
import { ComplianceCasesPage } from './routes/ComplianceCasesPage';
import { SettingsPage } from './routes/SettingsPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginFlow />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<ApprovalsListPage />} />
        <Route path="approvals/new" element={<NewApprovalRequestPage />} />
        <Route path="approvals/:id" element={<ApprovalDetailPage />} />
        <Route path="branches" element={<BranchesPage />} />
        <Route
          path="accounts/open"
          element={
            <RequireRole roles={['teller', 'branch_manager', 'ops_admin']}>
              <OpenAccountPage />
            </RequireRole>
          }
        />
        <Route
          path="loans/originate"
          element={
            <RequireRole roles={['loan_officer', 'credit_manager']}>
              <OriginateLoanPage />
            </RequireRole>
          }
        />
        <Route path="compliance-cases" element={<ComplianceCasesPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
