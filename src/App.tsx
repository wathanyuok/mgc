import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { runAutoExpire } from '@/lib/auto-expire';
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
import { Notifications } from '@/pages/Notifications';
import { AuditTrail } from '@/pages/AuditTrail';
import { Dashboard } from '@/pages/reports/Dashboard';
import { Reports } from '@/pages/reports/Reports';
import { PermissionGroupList } from '@/pages/admin/PermissionGroupList';
import { PermissionGroupDetail } from '@/pages/admin/PermissionGroupDetail';
import { UserList } from '@/pages/admin/UserList';
import { UserDetail } from '@/pages/admin/UserDetail';
import { ImportMigration } from '@/pages/admin/ImportMigration';
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

/**
 * ด่านตรวจสิทธิ์ระดับหน้า — ซ่อนเมนูอย่างเดียวไม่พอ
 *
 * เดิมระบบตรวจแค่ว่าเข้าสู่ระบบแล้วหรือยัง ผู้ใช้ที่ไม่มีสิทธิ์ดูเมนูหนึ่ง
 * จึงพิมพ์ลิงก์เข้าหน้านั้นตรงๆ ได้ และเห็นข้อมูลครบ
 */
function RequirePerm({ menuKey, children }: { menuKey: string; children: React.ReactNode }) {
  const { can } = useAuth();
  if (!can(menuKey, 'view')) {
    return (
      <div className="max-w-lg mx-auto mt-16 rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
        <p className="text-sm font-semibold text-amber-900">คุณไม่มีสิทธิ์เข้าหน้านี้</p>
        <p className="mt-1 text-xs text-amber-800">
          ถ้าต้องใช้งาน ให้ติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

/**
 * หน้าแรกหลังเข้าระบบ — พาไปเมนูแรกที่ผู้ใช้เปิดได้จริง
 *
 * เดิมพาไป Dashboard เสมอ ผู้ใช้ที่ไม่มีสิทธิ์ Dashboard จึงเข้ามาเจอหน้าไม่มีสิทธิ์
 * ทันทีที่ล็อกอิน ทั้งที่มีเมนูอื่นให้ใช้อยู่
 */
function LandingRedirect() {
  const { can } = useAuth();
  const first = LANDING_ORDER.find((m) => can(m.key, 'view'));
  return <Navigate to={first?.to ?? '/no-access'} replace />;
}

// ลำดับเดียวกับเมนูซ้าย — ตัวไหนเปิดได้ก่อนก็ไปตัวนั้น
const LANDING_ORDER = [
  { key: 'dashboard', to: '/dashboard' },
  { key: 'notifications', to: '/notifications' },
  { key: 'ma', to: '/ma' },
  { key: 'ca', to: '/ca' },
  { key: 'pn', to: '/tx/pn' },
  { key: 'loan', to: '/tx/loan' },
  { key: 'repayment', to: '/tx/repayment' },
  { key: 'je', to: '/je' },
  { key: 'reports', to: '/reports' },
  { key: 'user_mgmt', to: '/admin/users' },
];

function NoAccess() {
  return (
    <div className="max-w-lg mx-auto mt-16 rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
      <p className="text-sm font-semibold text-amber-900">ยังไม่ได้รับสิทธิ์ใช้งานเมนูใดเลย</p>
      <p className="mt-1 text-xs text-amber-800">ให้ติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์</p>
    </div>
  );
}

export default function App() {
  // Auto-Expire: MA/CA ที่เลย END DATE → Expired (รันครั้งเดียวตอนเปิดแอป)
  useEffect(() => { runAutoExpire(); }, []);
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedLayout />}>
        {/* หน้าแรก — พาไปเมนูแรกที่ผู้ใช้มีสิทธิ์ ไม่ใช่ Dashboard เสมอ */}
        <Route path="/" element={<LandingRedirect />} />
        <Route path="/dashboard" element={<RequirePerm menuKey="dashboard"><Dashboard /></RequirePerm>} />
        <Route path="/reports" element={<RequirePerm menuKey="reports"><Reports /></RequirePerm>} />
        <Route path="/reports/:key" element={<RequirePerm menuKey="reports"><Reports /></RequirePerm>} />

        {/* User Management (RBAC) */}
        <Route path="/admin/groups" element={<RequirePerm menuKey="user_mgmt"><PermissionGroupList /></RequirePerm>} />
        <Route path="/admin/groups/new" element={<RequirePerm menuKey="user_mgmt"><PermissionGroupDetail mode="new" /></RequirePerm>} />
        <Route path="/admin/groups/:id" element={<RequirePerm menuKey="user_mgmt"><PermissionGroupDetail mode="edit" /></RequirePerm>} />
        <Route path="/admin/users" element={<RequirePerm menuKey="user_mgmt"><UserList /></RequirePerm>} />
        <Route path="/admin/users/new" element={<RequirePerm menuKey="user_mgmt"><UserDetail mode="new" /></RequirePerm>} />
        <Route path="/admin/users/:id" element={<RequirePerm menuKey="user_mgmt"><UserDetail mode="edit" /></RequirePerm>} />
        <Route path="/admin/import-migration" element={<RequirePerm menuKey="user_mgmt"><ImportMigration /></RequirePerm>} />

        {/* LOAN MANAGEMENT */}
        <Route path="/ma" element={<RequirePerm menuKey="ma"><MAList /></RequirePerm>} />
        <Route path="/ma/new" element={<RequirePerm menuKey="ma"><MADetail mode="new" /></RequirePerm>} />
        <Route path="/ma/:id" element={<RequirePerm menuKey="ma"><MADetail mode="edit" /></RequirePerm>} />

        <Route path="/ca" element={<RequirePerm menuKey="ca"><CAList /></RequirePerm>} />
        <Route path="/ca/new" element={<RequirePerm menuKey="ca"><CADetail mode="new" /></RequirePerm>} />
        <Route path="/ca/:id" element={<RequirePerm menuKey="ca"><CADetail mode="edit" /></RequirePerm>} />

        {/* TRANSACTIONS */}
        <Route path="/tx/pn" element={<RequirePerm menuKey="pn"><PNList /></RequirePerm>} />
        <Route path="/tx/pn/new" element={<RequirePerm menuKey="pn"><PNDetail mode="new" /></RequirePerm>} />
        <Route path="/tx/pn/:id" element={<RequirePerm menuKey="pn"><PNDetail mode="edit" /></RequirePerm>} />

        <Route path="/tx/lg" element={<RequirePerm menuKey="lg"><LGList /></RequirePerm>} />
        <Route path="/tx/lg/new" element={<RequirePerm menuKey="lg"><LGDetail mode="new" /></RequirePerm>} />
        <Route path="/tx/lg/:id" element={<RequirePerm menuKey="lg"><LGDetail mode="edit" /></RequirePerm>} />

        <Route path="/tx/fp" element={<RequirePerm menuKey="fp"><FPList /></RequirePerm>} />
        <Route path="/tx/fp/new" element={<RequirePerm menuKey="fp"><FPDetail mode="new" /></RequirePerm>} />
        <Route path="/tx/fp/:id" element={<RequirePerm menuKey="fp"><FPDetail mode="edit" /></RequirePerm>} />

        <Route path="/tx/od" element={<RequirePerm menuKey="od"><ODList /></RequirePerm>} />
        <Route path="/tx/od/new" element={<RequirePerm menuKey="od"><ODDetail mode="new" /></RequirePerm>} />
        <Route path="/tx/od/:id" element={<RequirePerm menuKey="od"><ODDetail mode="edit" /></RequirePerm>} />

        <Route path="/tx/lc" element={<RequirePerm menuKey="lc"><LCList /></RequirePerm>} />
        <Route path="/tx/lc/new" element={<RequirePerm menuKey="lc"><LCDetail mode="new" /></RequirePerm>} />
        <Route path="/tx/lc/:id" element={<RequirePerm menuKey="lc"><LCDetail mode="edit" /></RequirePerm>} />
        <Route path="/tx/tr" element={<RequirePerm menuKey="tr"><TRList /></RequirePerm>} />
        <Route path="/tx/tr/new" element={<RequirePerm menuKey="tr"><TRDetail mode="new" /></RequirePerm>} />
        <Route path="/tx/tr/:id" element={<RequirePerm menuKey="tr"><TRDetail mode="edit" /></RequirePerm>} />

        <Route path="/tx/fxf" element={<RequirePerm menuKey="fxf"><FXFList /></RequirePerm>} />
        <Route path="/tx/fxf/new" element={<RequirePerm menuKey="fxf"><FXFDetail mode="new" /></RequirePerm>} />
        <Route path="/tx/fxf/:id" element={<RequirePerm menuKey="fxf"><FXFDetail mode="edit" /></RequirePerm>} />

        <Route path="/tx/loan" element={<RequirePerm menuKey="loan"><LoanList /></RequirePerm>} />
        <Route path="/tx/loan/new" element={<RequirePerm menuKey="loan"><LoanDetail mode="new" /></RequirePerm>} />
        <Route path="/tx/loan/:id" element={<RequirePerm menuKey="loan"><LoanDetail mode="edit" /></RequirePerm>} />

        <Route path="/tx/repayment" element={<RequirePerm menuKey="repayment"><RepaymentList /></RequirePerm>} />
        <Route path="/tx/repayment/new" element={<RequirePerm menuKey="repayment"><RepaymentDetail mode="new" /></RequirePerm>} />
        <Route path="/tx/repayment/:id" element={<RequirePerm menuKey="repayment"><RepaymentDetail mode="edit" /></RequirePerm>} />

        {/* Feature B8 — AR-AP Netting moved to FPDetail Tab (under /tx/fp/:id) */}

        {/* Journal Entries (Phase 2) */}
        <Route path="/je" element={<RequirePerm menuKey="je"><JEList /></RequirePerm>} />
        <Route path="/je/:id" element={<RequirePerm menuKey="je"><JEDetail /></RequirePerm>} />

        {/* Notifications */}
        <Route path="/notifications" element={<RequirePerm menuKey="notifications"><Notifications /></RequirePerm>} />
        <Route path="/audit-trail" element={<RequirePerm menuKey="audit_trail"><AuditTrail /></RequirePerm>} />

        {/* สัญญาเช่า 3 ชนิด — เมนูอยู่ใต้ Transactions */}
        <Route path="/lease/hp" element={<RequirePerm menuKey="lease_hp"><LeaseList mode="hp" /></RequirePerm>} />
        <Route path="/lease/hp/new" element={<RequirePerm menuKey="lease_hp"><LeaseDetail mode="new" leaseMode="hp" /></RequirePerm>} />
        <Route path="/lease/hp/:id" element={<RequirePerm menuKey="lease_hp"><LeaseDetail mode="edit" leaseMode="hp" /></RequirePerm>} />
        <Route path="/lease/leasing" element={<RequirePerm menuKey="lease_leasing"><LeaseList mode="lease" /></RequirePerm>} />
        <Route path="/lease/leasing/new" element={<RequirePerm menuKey="lease_leasing"><LeaseDetail mode="new" leaseMode="lease" /></RequirePerm>} />
        <Route path="/lease/leasing/:id" element={<RequirePerm menuKey="lease_leasing"><LeaseDetail mode="edit" leaseMode="lease" /></RequirePerm>} />
        <Route path="/lease/other" element={<RequirePerm menuKey="lease_other"><LeaseList mode="other" /></RequirePerm>} />
        <Route path="/lease/other/new" element={<RequirePerm menuKey="lease_other"><LeaseDetail mode="new" leaseMode="other" /></RequirePerm>} />
        <Route path="/lease/other/:id" element={<RequirePerm menuKey="lease_other"><LeaseDetail mode="edit" leaseMode="other" /></RequirePerm>} />

        {/* MASTER */}
        <Route path="/master/interest-rate" element={<RequirePerm menuKey="master_interest"><InterestRateList /></RequirePerm>} />
        <Route path="/master/interest-rate/new" element={<RequirePerm menuKey="master_interest"><InterestRateDetail mode="new" /></RequirePerm>} />
        <Route path="/master/interest-rate/:id" element={<RequirePerm menuKey="master_interest"><InterestRateDetail mode="edit" /></RequirePerm>} />
        <Route path="/master/curtailment" element={<RequirePerm menuKey="master_curtailment"><CurtailmentList /></RequirePerm>} />
        <Route path="/master/curtailment/new" element={<RequirePerm menuKey="master_curtailment"><CurtailmentDetail mode="new" /></RequirePerm>} />
        <Route path="/master/curtailment/:id" element={<RequirePerm menuKey="master_curtailment"><CurtailmentDetail mode="edit" /></RequirePerm>} />
        <Route path="/master/bank-statement" element={<RequirePerm menuKey="master_bank"><BankStatementList /></RequirePerm>} />
        <Route path="/master/bank-statement/new" element={<RequirePerm menuKey="master_bank"><BankStatementDetail mode="new" /></RequirePerm>} />
        <Route path="/master/bank-statement/:id" element={<RequirePerm menuKey="master_bank"><BankStatementDetail mode="edit" /></RequirePerm>} />
        {/* COA master (Chart of Accounts) — in sidebar under Master group */}
        <Route path="/master/coa" element={<RequirePerm menuKey="master_coa"><CoaList /></RequirePerm>} />
        <Route path="/master/coa/new" element={<RequirePerm menuKey="master_coa"><CoaDetail mode="new" /></RequirePerm>} />
        <Route path="/master/coa/:id" element={<RequirePerm menuKey="master_coa"><CoaDetail mode="edit" /></RequirePerm>} />

        {/* legacy redirects */}
        <Route path="/lease" element={<Navigate to="/lease/hp" replace />} />
        <Route path="/no-access" element={<NoAccess />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
