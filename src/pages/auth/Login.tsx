import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { LogIn, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

/**
 * รหัสผ่านจำลองสำหรับสาธิตหน้าจอแจ้งรหัสผ่านผิด
 *
 * ตัวต้นแบบยังไม่ได้ต่อ Active Directory จึงยังไม่มีการตรวจรหัสผ่านจริง
 * ผู้ทดสอบเลยไม่มีทางเห็นหน้าจอกรณีรหัสผิดเพื่อเก็บภาพประกอบผลทดสอบ
 * ค่านี้เปิดทางให้กรอก 1111 แล้วเห็นข้อความจริงที่จะใช้ตอนต่อ AD แล้ว
 *
 * ⚠️ ต้องลบทิ้งตอนเชื่อม Active Directory — ของจริงให้ AD เป็นคนตอบว่าผ่านหรือไม่ผ่าน
 */
const DEMO_WRONG_PASSWORD = '1111';

/**
 * ข้อความเดียวสำหรับทั้งอีเมลผิดและรหัสผ่านผิด
 *
 * ห้ามแยกว่าผิดช่องไหน — ถ้าบอกว่า "รหัสผ่านไม่ถูกต้อง" เท่ากับยืนยันว่าอีเมลนั้น
 * มีอยู่จริงในองค์กร คนที่สุ่มลองจะไล่เก็บรายชื่อพนักงานได้ทีละอีเมล
 */
const BAD_CREDENTIALS = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';

export function Login() {
  const navigate = useNavigate();
  const { devSignIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const signIn = async () => {
    const mail = email.trim().toLowerCase();
    setError('');
    if (!mail) { setError('กรอกชื่อผู้ใช้หรืออีเมล'); return; }
    setBusy(true);
    try {
      // ตรวจก่อนทุกอย่าง ให้ลำดับตรงกับของจริง — AD ตอบว่าผ่านหรือไม่ผ่านก่อน
      // แล้วค่อยดูว่าคนนี้มีสิทธิ์ใช้ระบบนี้หรือเปล่า
      if (password === DEMO_WRONG_PASSWORD) {
        throw new Error(BAD_CREDENTIALS);
      }

      // ต้องมีอีเมลนี้ในเมนู Users ก่อน — เดิมรับทุกอีเมลแล้วปล่อยเข้ามาเจอหน้าว่าง
      // ผู้ใช้ไม่รู้ว่าเพราะยังไม่ได้เปิดสิทธิ์ หรือพิมพ์อีเมลผิด
      //
      // ยกเว้นตอนตารางผู้ใช้ยังว่างทั้งตาราง — คนแรกที่เข้ามาจะถูกตั้งเป็นผู้ดูแลระบบ
      // เพื่อให้ติดตั้งระบบครั้งแรกได้
      const [{ data: hit }, { count }] = await Promise.all([
        supabase.from('app_users').select('id, status').eq('email', mail).maybeSingle(),
        supabase.from('app_users').select('id', { count: 'exact', head: true }),
      ]);
      if (!hit && (count ?? 0) > 0) {
        throw new Error(`ไม่พบผู้ใช้ ${mail} ในระบบ — ให้ผู้ดูแลเพิ่มที่เมนู Users ก่อน`);
      }
      if (hit && (hit as any).status !== 'Active') {
        throw new Error(`บัญชี ${mail} ถูกปิดใช้งานอยู่ — ติดต่อผู้ดูแลระบบ`);
      }
      await devSignIn(mail);
      toast.success('เข้าสู่ระบบแล้ว');
      navigate('/', { replace: true });
    } catch (e: any) {
      // แสดงในกรอบบนฟอร์ม ไม่ใช่ข้อความเด้งมุมจอ — ข้อความเด้งหายเองใน 3-4 วินาที
      // ผู้ทดสอบจับภาพไม่ทัน และโปรแกรมอ่านหน้าจอไม่ประกาศให้
      setError(e.message ?? 'เข้าสู่ระบบไม่สำเร็จ');
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
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-[13px] text-red-700"
              >
                <AlertCircle size={16} className="mt-px shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-gray-600">Email / Username</label>
              <input maxLength={200}
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
              <input maxLength={200}
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
                ? <><Loader2 size={16} className="animate-spin" /> กำลังเข้าสู่ระบบ...</>
                : <><LogIn size={16} className="transition-transform group-hover:translate-x-0.5" /> เข้าสู่ระบบ</>}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-[11px] leading-5 text-gray-400">
          รหัสผ่านจะถูกตรวจสอบกับ Active Directory ขององค์กร — ไม่มีการสมัครเอง<br />
          สิทธิ์การใช้งานกำหนดที่เมนู Users โดยผู้ดูแล<br />
          {/* บรรทัดนี้มีไว้ระหว่างเป็นตัวต้นแบบ — ลบพร้อม DEMO_WRONG_PASSWORD ตอนต่อ AD จริง */}
          <span className="text-gray-400/90">
            ตัวต้นแบบ — ยังไม่ได้เชื่อม AD จริง · กรอกรหัสผ่าน <b>1111</b> เพื่อดูหน้าจอกรณีรหัสผ่านไม่ถูกต้อง
          </span>
        </p>
      </div>
    </div>
  );
}
