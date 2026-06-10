import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bell, FileText, Shield, KeyRound, TrendingDown } from 'lucide-react';
import {
  Box, Stack, Typography, Card, CardContent, Chip, Link as MuiLink,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
} from '@mui/material';
import { fmtDate } from '@/lib/format';
import { getAllNotifications, type NotiItem, type NotiSeverity, type NotiCategory } from '@/lib/notifications';

type Color = 'error' | 'warning' | 'primary';
const SEV: Record<NotiSeverity, { label: string; color: Color; note: (d: number) => string }> = {
  overdue: { label: 'เกินกำหนด', color: 'error', note: (d) => `เกินกำหนด ${Math.abs(d)} วัน` },
  soon: { label: 'ใกล้ครบ', color: 'warning', note: (d) => `อีก ${d} วัน` },
  upcoming: { label: 'กำลังจะถึง', color: 'primary', note: (d) => `อีก ${d} วัน` },
};

// Category sections — mirrors BRD §2.13.4 grouping (3 categories, 5 notification types)
const CATEGORIES: Array<{
  key: NotiCategory;
  title: string;
  subtitle: string;
  icon: typeof Bell;
  ntfIds: string;
}> = [
  {
    key: 'maturity',
    title: 'สัญญา/วงเงิน ใกล้ครบกำหนด',
    subtitle: 'NTF-004: TX ใกล้ครบกำหนด (8 modules) · NTF-005: Master Agreement ใกล้สิ้นสุด',
    icon: FileText,
    ntfIds: 'NTF-004 · NTF-005',
  },
  {
    key: 'collateral',
    title: 'หลักประกัน',
    subtitle: 'NTF-001: ถึงรอบประเมินใหม่ · NTF-002: มูลค่าลดลง > 10%',
    icon: Shield,
    ntfIds: 'NTF-001 · NTF-002',
  },
  {
    key: 'release',
    title: 'ปลดหลักประกัน',
    subtitle: 'NTF-003: ชำระครบ/ปิดสัญญา + มี Chassis → แจ้ง Finance ดำเนินการ (P/N · FP · Loan)',
    icon: KeyRound,
    ntfIds: 'NTF-003',
  },
  {
    key: 'curtailment',
    title: 'Curtailment ครบกำหนด',
    subtitle: 'NTF-006: Floor Plan Curtailment milestone ใกล้ครบกำหนด — แจ้งล่วงหน้า 30/15/7 วัน · เกินกำหนด',
    icon: TrendingDown,
    ntfIds: 'NTF-006',
  },
];

export function Notifications() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => getAllNotifications(30),
  });

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
      <Stack direction="row" alignItems="flex-start" spacing={1} sx={{ mb: 3 }}>
        <Bell size={24} color="#0a5dc2" style={{ marginTop: 4 }} />
        <Box>
          <Typography sx={{ fontSize: '1.5rem', fontWeight: 700 }}>Notifications</Typography>
          <Typography variant="body2" color="text.secondary">
            ระบบแจ้งเตือนแบ่งตามหมวด 4 กลุ่ม — รวม 6 ประเภท (NTF-001 ถึง NTF-006)
          </Typography>
        </Box>
      </Stack>

      {isLoading ? (
        <Box sx={{ p: 3, color: 'text.secondary' }}>กำลังโหลด...</Box>
      ) : (
        <Stack spacing={3}>
          {CATEGORIES.map((cat) => {
            const items = data.filter((i) => i.category === cat.key).sort((a, b) => a.days - b.days);
            const Icon = cat.icon;
            const overdueCount = items.filter((i) => i.severity === 'overdue').length;
            return (
              <Box key={cat.key}>
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1 }}>
                  <Icon size={20} color="#0a5dc2" />
                  <Box sx={{ flex: 1 }}>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <Typography sx={{ fontWeight: 700, fontSize: '1rem' }}>{cat.title}</Typography>
                      <Chip size="small" label={`${items.length} รายการ`} variant="outlined" />
                      {overdueCount > 0 && (
                        <Chip size="small" label={`เกินกำหนด ${overdueCount}`} color="error" />
                      )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">{cat.subtitle}</Typography>
                  </Box>
                </Stack>

                {items.length === 0 ? (
                  <Card variant="outlined">
                    <CardContent sx={{ p: 2.5, color: 'text.secondary', textAlign: 'center' }}>
                      <Typography variant="body2">✓ ไม่มีรายการใน 30 วันข้างหน้า</Typography>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ width: 90 }}>ความเร่งด่วน</TableCell>
                            <TableCell>ประเภท</TableCell>
                            <TableCell>สัญญา / รหัส</TableCell>
                            <TableCell>วันครบกำหนด</TableCell>
                            <TableCell align="right">คงเหลือ</TableCell>
                            <TableCell sx={{ width: 80 }} />
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {items.map((i: NotiItem) => (
                            <TableRow key={i.key} hover>
                              <TableCell>
                                <Chip size="small" label={SEV[i.severity].label} color={SEV[i.severity].color} />
                              </TableCell>
                              <TableCell><Chip size="small" label={i.kind} variant="outlined" /></TableCell>
                              <TableCell sx={{ fontWeight: 500 }}>{i.ref}</TableCell>
                              <TableCell>{fmtDate(i.dueDate)}</TableCell>
                              <TableCell
                                align="right"
                                sx={{
                                  fontVariantNumeric: 'tabular-nums',
                                  color: i.severity === 'overdue' ? 'error.main' : undefined,
                                  fontWeight: i.severity === 'overdue' ? 600 : undefined,
                                }}
                              >
                                {i.note ?? SEV[i.severity].note(i.days)}
                              </TableCell>
                              <TableCell align="right">
                                <MuiLink component={Link} to={i.route} underline="hover" sx={{ fontSize: 12 }}>
                                  เปิด →
                                </MuiLink>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Card>
                )}
              </Box>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
