import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { LogIn } from 'lucide-react';
import { Button, Card, CardContent, Input, FieldLabel } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export function Login() {
  const navigate = useNavigate();
  const { devSignIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  // ⚠️ DEV MODE — AD ยังไม่ได้ต่อ: กรอกรหัสอะไรก็เข้าได้ (เช็คแค่ว่ามีอีเมล)
  // เมื่อต่อ AD จริง ให้สลับไปเรียก Edge Function `ad-login` + verifyOtp
  // (โค้ดเดิมเก็บไว้ที่ supabase/functions/ad-login/index.ts)
  const signIn = async () => {
    if (!email.trim()) { toast.error('กรอกอีเมล'); return; }
    setBusy(true);
    try {
      await devSignIn(email.trim());
      toast.success('เข้าสู่ระบบแล้ว (โหมดทดสอบ — ยังไม่ได้ต่อ AD)');
      navigate('/', { replace: true });
    } catch (e: any) {
      toast.error(e.message ?? 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full flex items-center justify-center bg-soft p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-5">
          <h1 className="text-xl font-bold">MGC-Asia · Loan Module</h1>
          <p className="text-muted text-sm">เข้าสู่ระบบด้วยบัญชีองค์กร (Active Directory)</p>
        </div>
        <Card>
          <CardContent className="space-y-3">
            <div>
              <FieldLabel>EMAIL / USERNAME</FieldLabel>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@mgc-asia.com"
                autoComplete="username"
                onKeyDown={(e) => e.key === 'Enter' && signIn()}
              />
            </div>
            <div>
              <FieldLabel>PASSWORD</FieldLabel>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                onKeyDown={(e) => e.key === 'Enter' && signIn()}
              />
            </div>
            <Button variant="primary" className="w-full justify-center" disabled={busy} onClick={signIn}>
              <LogIn className="w-4 h-4" /> {busy ? 'กำลังตรวจสอบกับ AD...' : 'เข้าสู่ระบบ'}
            </Button>
          </CardContent>
        </Card>
        <p className="text-[11px] text-muted text-center mt-3">
          รหัสผ่านจะถูกตรวจสอบกับ Active Directory ขององค์กร — ไม่มีการสมัครเอง · สิทธิ์การใช้งานกำหนดที่เมนู Users โดยผู้ดูแล
        </p>
      </div>
    </div>
  );
}
