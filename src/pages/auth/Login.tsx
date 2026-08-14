import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { LogIn, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';

export function Login() {
  const navigate = useNavigate();
  const { devSignIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    if (!email.trim()) { toast.error('กรอกอีเมล'); return; }
    setBusy(true);
    try {
      await devSignIn(email.trim());
      toast.success('เข้าสู่ระบบแล้ว');
      navigate('/', { replace: true });
    } catch (e: any) {
      toast.error(e.message ?? 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-gray-50 p-6">
      {/* soft background accents */}
      <div className="pointer-events-none absolute -top-40 -left-40 h-96 w-96 rounded-full bg-brand/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-brand/5 blur-3xl" />

      <div className="relative w-full max-w-[400px]">
        {/* Brand */}
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/mgc-asia-logo.png" alt="MGC-ASIA" className="mb-4 h-10 w-auto" />
          <h1 className="text-xl font-semibold text-gray-900">Loan &amp; Lease Module</h1>
          <p className="mt-1 text-[13px] text-gray-500">เข้าสู่ระบบด้วยบัญชีองค์กร (Active Directory)</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-xl shadow-gray-200/40">
          {/* ต้องเป็น <form> + submit จริง — Chrome/password manager ถึงจะเสนอบันทึกรหัสผ่าน */}
          <form onSubmit={(e) => { e.preventDefault(); signIn(); }} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-gray-600">Email / Username</label>
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@mgc-asia.com"
                className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3.5 py-2.5 text-sm outline-none transition
                           placeholder:text-gray-400 hover:border-gray-300
                           focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand/10"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-gray-600">Password</label>
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3.5 py-2.5 text-sm outline-none transition
                           placeholder:text-gray-400 hover:border-gray-300
                           focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand/10"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="group flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-2.5 text-sm font-medium text-white
                         shadow-sm transition hover:bg-brand-dark hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy
                ? <><Loader2 size={16} className="animate-spin" /> กำลังตรวจสอบกับ AD...</>
                : <><LogIn size={16} className="transition-transform group-hover:translate-x-0.5" /> เข้าสู่ระบบ</>}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-[11px] leading-5 text-gray-400">
          รหัสผ่านจะถูกตรวจสอบกับ Active Directory ขององค์กร — ไม่มีการสมัครเอง<br />
          สิทธิ์การใช้งานกำหนดที่เมนู Users โดยผู้ดูแล
        </p>
      </div>
    </div>
  );
}
