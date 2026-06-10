import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { MAList } from '@/pages/ma/MAList';
import { MADetail } from '@/pages/ma/MADetail';
import { CAList } from '@/pages/ca/CAList';
import { CADetail } from '@/pages/ca/CADetail';
import { LeaseList } from '@/pages/lease/LeaseList';
import { LeaseDetail } from '@/pages/lease/LeaseDetail';
import { InterestRateList } from '@/pages/master/InterestRateList';
import { InterestRateDetail } from '@/pages/master/InterestRateDetail';
import { CurtailmentList } from '@/pages/master/CurtailmentList';
import { CurtailmentDetail } from '@/pages/master/CurtailmentDetail';
import { BankStatementList } from '@/pages/master/BankStatementList';
import { BankStatementDetail } from '@/pages/master/BankStatementDetail';
import { CoaList } from '@/pages/master/CoaList';
import { CoaDetail } from '@/pages/master/CoaDetail';
import { PNList } from '@/pages/tx/PNList';
import { PNDetail } from '@/pages/tx/PNDetail';
import { LGList } from '@/pages/tx/LGList';
import { LGDetail } from '@/pages/tx/LGDetail';
import { FPList } from '@/pages/tx/FPList';
import { FPDetail } from '@/pages/tx/FPDetail';
import { ODList } from '@/pages/tx/ODList';
import { ODDetail } from '@/pages/tx/ODDetail';
import { TRList } from '@/pages/tx/TRList';
import { TRDetail } from '@/pages/tx/TRDetail';
import { LCList } from '@/pages/tx/LCList';
import { LCDetail } from '@/pages/tx/LCDetail';
import { FXFList } from '@/pages/tx/FXFList';
import { FXFDetail } from '@/pages/tx/FXFDetail';
import { LoanList } from '@/pages/tx/LoanList';
import { LoanDetail } from '@/pages/tx/LoanDetail';
import { RepaymentList } from '@/pages/tx/RepaymentList';
import { RepaymentDetail } from '@/pages/tx/RepaymentDetail';
import { JEList } from '@/pages/je/JEList';
import { JEDetail } from '@/pages/je/JEDetail';
import { SyncLog } from '@/pages/je/SyncLog';
import { Notifications } from '@/pages/Notifications';
import { AuditTrail } from '@/pages/AuditTrail';
import { Dashboard } from '@/pages/reports/Dashboard';
import { Reports } from '@/pages/reports/Reports';
import { PermissionGroupList } from '@/pages/admin/PermissionGroupList';
import { PermissionGroupDetail } from '@/pages/admin/PermissionGroupDetail';
import { UserList } from '@/pages/admin/UserList';
import { UserDetail } from '@/pages/admin/UserDetail';
import { Placeholder } from '@/pages/Placeholder';
import { Login } from '@/pages/auth/Login';
import { useAuth } from '@/lib/auth';

function ProtectedLayout() {
  const { loading, authed } = useAuth();
  if (loading) {
    return <div className="h-full flex items-center justify-center text-muted text-sm">กำลังโหลด...</div>;
  }
  if (!authed) return <Navigate to="/login" replace />;
  return <AppLayout />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedLayout />}>
        {/* Land on Dashboard */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/reports" element={<Reports />} />

        {/* User Management (RBAC) */}
        <Route path="/admin/groups" element={<PermissionGroupList />} />
        <Route path="/admin/groups/new" element={<PermissionGroupDetail mode="new" />} />
        <Route path="/admin/groups/:id" element={<PermissionGroupDetail mode="edit" />} />
        <Route path="/admin/users" element={<UserList />} />
        <Route path="/admin/users/new" element={<UserDetail mode="new" />} />
        <Route path="/admin/users/:id" element={<UserDetail mode="edit" />} />

        {/* LOAN MANAGEMENT */}
        <Route path="/ma" element={<MAList />} />
        <Route path="/ma/new" element={<MADetail mode="new" />} />
        <Route path="/ma/:id" element={<MADetail mode="edit" />} />

        <Route path="/ca" element={<CAList />} />
        <Route path="/ca/new" element={<CADetail mode="new" />} />
        <Route path="/ca/:id" element={<CADetail mode="edit" />} />

        {/* TRANSACTIONS */}
        <Route path="/tx/pn" element={<PNList />} />
        <Route path="/tx/pn/new" element={<PNDetail mode="new" />} />
        <Route path="/tx/pn/:id" element={<PNDetail mode="edit" />} />

        <Route path="/tx/lg" element={<LGList />} />
        <Route path="/tx/lg/new" element={<LGDetail mode="new" />} />
        <Route path="/tx/lg/:id" element={<LGDetail mode="edit" />} />

        <Route path="/tx/fp" element={<FPList />} />
        <Route path="/tx/fp/new" element={<FPDetail mode="new" />} />
        <Route path="/tx/fp/:id" element={<FPDetail mode="edit" />} />

        <Route path="/tx/od" element={<ODList />} />
        <Route path="/tx/od/new" element={<ODDetail mode="new" />} />
        <Route path="/tx/od/:id" element={<ODDetail mode="edit" />} />

        <Route path="/tx/lc" element={<LCList />} />
        <Route path="/tx/lc/new" element={<LCDetail mode="new" />} />
        <Route path="/tx/lc/:id" element={<LCDetail mode="edit" />} />
        <Route path="/tx/tr" element={<TRList />} />
        <Route path="/tx/tr/new" element={<TRDetail mode="new" />} />
        <Route path="/tx/tr/:id" element={<TRDetail mode="edit" />} />

        <Route path="/tx/fxf" element={<FXFList />} />
        <Route path="/tx/fxf/new" element={<FXFDetail mode="new" />} />
        <Route path="/tx/fxf/:id" element={<FXFDetail mode="edit" />} />

        <Route path="/tx/loan" element={<LoanList />} />
        <Route path="/tx/loan/new" element={<LoanDetail mode="new" />} />
        <Route path="/tx/loan/:id" element={<LoanDetail mode="edit" />} />

        <Route path="/tx/repayment" element={<RepaymentList />} />
        <Route path="/tx/repayment/new" element={<RepaymentDetail mode="new" />} />
        <Route path="/tx/repayment/:id" element={<RepaymentDetail mode="edit" />} />

        {/* Journal Entries (Phase 2) */}
        <Route path="/je" element={<JEList />} />
        <Route path="/je/sync-log" element={<SyncLog />} />
        <Route path="/je/:id" element={<JEDetail />} />

        {/* Notifications */}
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/audit-trail" element={<AuditTrail />} />

        {/* LEASE MANAGEMENT */}
        <Route path="/lease/hp" element={<LeaseList mode="hp" />} />
        <Route path="/lease/hp/new" element={<LeaseDetail mode="new" leaseMode="hp" />} />
        <Route path="/lease/hp/:id" element={<LeaseDetail mode="edit" leaseMode="hp" />} />
        <Route path="/lease/other" element={<LeaseList mode="other" />} />
        <Route path="/lease/other/new" element={<LeaseDetail mode="new" leaseMode="other" />} />
        <Route path="/lease/other/:id" element={<LeaseDetail mode="edit" leaseMode="other" />} />

        {/* MASTER */}
        <Route path="/master/interest-rate" element={<InterestRateList />} />
        <Route path="/master/interest-rate/new" element={<InterestRateDetail mode="new" />} />
        <Route path="/master/interest-rate/:id" element={<InterestRateDetail mode="edit" />} />
        <Route path="/master/curtailment" element={<CurtailmentList />} />
        <Route path="/master/curtailment/new" element={<CurtailmentDetail mode="new" />} />
        <Route path="/master/curtailment/:id" element={<CurtailmentDetail mode="edit" />} />
        <Route path="/master/bank-statement" element={<BankStatementList />} />
        <Route path="/master/bank-statement/new" element={<BankStatementDetail mode="new" />} />
        <Route path="/master/bank-statement/:id" element={<BankStatementDetail mode="edit" />} />
        {/* COA master (Chart of Accounts) — in sidebar under Master group */}
        <Route path="/master/coa" element={<CoaList />} />
        <Route path="/master/coa/new" element={<CoaDetail mode="new" />} />
        <Route path="/master/coa/:id" element={<CoaDetail mode="edit" />} />

        {/* legacy redirects */}
        <Route path="/lease" element={<Navigate to="/lease/hp" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
