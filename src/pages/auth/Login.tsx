import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { LogIn } from 'lucide-react';
import { Box, Card, CardContent, Typography, TextField, Button, Stack } from '@mui/material';
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
    <Box sx={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default', p: 3 }}>
      <Box sx={{ width: '100%', maxWidth: 380 }}>
        <Box sx={{ textAlign: 'center', mb: 2.5 }}>
          <Typography sx={{ fontSize: '1.25rem', fontWeight: 700 }}>MGC-Asia · Loan Module</Typography>
          <Typography variant="body2" color="text.secondary">เข้าสู่ระบบด้วยบัญชีองค์กร (Active Directory)</Typography>
        </Box>
        <Card>
          <CardContent>
            <Stack spacing={2}>
              <TextField
                label="Email / Username"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@mgc-asia.com"
                autoComplete="username"
                onKeyDown={(e) => e.key === 'Enter' && signIn()}
              />
              <TextField
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                onKeyDown={(e) => e.key === 'Enter' && signIn()}
              />
              <Button variant="contained" startIcon={<LogIn size={16} />} disabled={busy} onClick={signIn} size="medium" sx={{ py: 1 }}>
                {busy ? 'กำลังตรวจสอบกับ AD...' : 'เข้าสู่ระบบ'}
              </Button>
            </Stack>
          </CardContent>
        </Card>
        <Typography sx={{ fontSize: 11, color: 'text.secondary', textAlign: 'center', mt: 1.5 }}>
          รหัสผ่านจะถูกตรวจสอบกับ Active Directory ขององค์กร — ไม่มีการสมัครเอง · สิทธิ์การใช้งานกำหนดที่เมนู Users โดยผู้ดูแล
        </Typography>
      </Box>
    </Box>
  );
}
