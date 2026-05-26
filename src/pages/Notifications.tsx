import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import {
  Box, Stack, Typography, Card, CardContent, Chip, Link as MuiLink,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
} from '@mui/material';
import { fmtDate } from '@/lib/format';
import { getAllNotifications, type NotiItem, type NotiSeverity } from '@/lib/notifications';

type Color = 'error' | 'warning' | 'primary';
const SEV: Record<NotiSeverity, { label: string; color: Color; note: (d: number) => string }> = {
  overdue: { label: 'เกินกำหนด', color: 'error', note: (d) => `เกินกำหนด ${Math.abs(d)} วัน` },
  soon: { label: 'ใกล้ครบ (≤7 วัน)', color: 'warning', note: (d) => `อีก ${d} วัน` },
  upcoming: { label: 'กำลังจะถึง (≤30 วัน)', color: 'primary', note: (d) => `อีก ${d} วัน` },
};

export function Notifications() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => getAllNotifications(30),
  });

  const groups: NotiSeverity[] = ['overdue', 'soon', 'upcoming'];

  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto' }}>
      <Stack direction="row" alignItems="flex-start" spacing={1} sx={{ mb: 2 }}>
        <Bell size={24} color="#0a5dc2" style={{ marginTop: 4 }} />
        <Box>
          <Typography sx={{ fontSize: '1.5rem', fontWeight: 700 }}>Notifications</Typography>
          <Typography variant="body2" color="text.secondary">
            (1) ใกล้ครบกำหนด/หมดอายุ ทุกผลิตภัณฑ์ (PN · LG/BG · Floor Plan · O/D · T/R · FX · Loan · Lease) ·
            (2) หลักประกัน: ถึงรอบประเมินใหม่ / มูลค่าลดลง ·
            (3) ปลดหลักประกันรถ เมื่อ P/N ชำระครบ → แจ้ง Finance
          </Typography>
        </Box>
      </Stack>

      {isLoading ? (
        <Box sx={{ p: 3, color: 'text.secondary' }}>กำลังโหลด...</Box>
      ) : data.length === 0 ? (
        <Card>
          <CardContent sx={{ p: 6, textAlign: 'center', color: 'text.secondary' }}>
            <Typography sx={{ fontSize: 32, mb: 1 }}>✅</Typography>
            <Typography variant="body2">ไม่มีรายการใกล้ครบกำหนดภายใน 30 วัน</Typography>
          </CardContent>
        </Card>
      ) : (
        <Stack spacing={2.5}>
          {groups.map((g) => {
            const items = data.filter((i) => i.severity === g);
            if (items.length === 0) return null;
            return (
              <Box key={g}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                  <Chip size="small" label={SEV[g].label} color={SEV[g].color} />
                  <Typography variant="body2" color="text.secondary">{items.length} รายการ</Typography>
                </Stack>
                <Card>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>ประเภท</TableCell>
                          <TableCell>สัญญา</TableCell>
                          <TableCell>วันครบกำหนด</TableCell>
                          <TableCell align="right">คงเหลือ</TableCell>
                          <TableCell sx={{ width: 80 }} />
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {items.map((i: NotiItem) => (
                          <TableRow key={i.key} hover>
                            <TableCell><Chip size="small" label={i.kind} /></TableCell>
                            <TableCell sx={{ fontWeight: 500 }}>{i.ref}</TableCell>
                            <TableCell>{fmtDate(i.dueDate)}</TableCell>
                            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: i.severity === 'overdue' ? 'error.main' : undefined, fontWeight: i.severity === 'overdue' ? 600 : undefined }}>
                              {i.note ?? SEV[i.severity].note(i.days)}
                            </TableCell>
                            <TableCell align="right">
                              <MuiLink component={Link} to={i.route} underline="hover" sx={{ fontSize: 12 }}>เปิด →</MuiLink>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Card>
              </Box>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
