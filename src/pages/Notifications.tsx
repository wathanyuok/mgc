import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Bell, FileText, Shield, KeyRound, TrendingDown, CheckSquare, BookOpen, Car, RefreshCw, Undo2 } from 'lucide-react';
import {
  Box, Stack, Typography, Card, CardContent, Chip, Link as MuiLink, Alert, Button, TextField,
  MenuItem, Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
} from '@mui/material';
import { fmtDate } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import {
  getAllNotifications, NOTI_MENU_KEYS,
  type NotiItem, type NotiSeverity, type NotiCategory,
} from '@/lib/notifications';

type Color = 'error' | 'warning' | 'primary';
const SEV: Record<NotiSeverity, { label: string; color: Color; note: (d: number) => string }> = {
  overdue: { label: 'เกินกำหนด', color: 'error', note: (d) => `เกินกำหนด ${Math.abs(d)} วัน` },
  soon: { label: 'ใกล้ครบ', color: 'warning', note: (d) => (d === 0 ? 'วันนี้' : `อีก ${d} วัน`) },
  upcoming: { label: 'กำลังจะถึง', color: 'primary', note: (d) => `อีก ${d} วัน` },
};

interface CatDef {
  key: NotiCategory;
  title: string;
  subtitle: string;
  icon: typeof Bell;
  /** หัวคอลัมน์วันที่ของหมวดนี้ — บางหมวดไม่ใช่ "วันครบกำหนด" */
  dateLabel: string;
  /** 'recent' = เรียงเรื่องที่เพิ่งเกิดไว้บนสุด (ค่าปกติคือเรื่องที่ด่วนที่สุดขึ้นก่อน) */
  sort?: 'recent';
}

// เรียงให้เรื่องที่ต้องลงมือทำอยู่บนสุด แล้วค่อยเป็นเรื่องที่ต้องเฝ้าระวัง
const CATEGORIES: CatDef[] = [
  {
    key: 'sent_back',
    title: 'ถูกส่งกลับให้แก้ไข',
    subtitle: 'รายการที่ผู้อนุมัติส่งกลับมาพร้อมเหตุผล — แก้แล้วส่งขออนุมัติใหม่ได้เลย',
    icon: Undo2,
    dateLabel: 'วันที่แจ้ง',
  },
  {
    key: 'approval',
    title: 'รอการอนุมัติ',
    subtitle: 'รายการที่ผู้จัดทำส่งมาแล้ว รอผู้มีอำนาจกดอนุมัติหรือส่งกลับแก้ไข',
    icon: CheckSquare,
    dateLabel: 'วันที่แจ้ง',
  },
  {
    key: 'periodic_je',
    title: 'รอลงบัญชี',
    subtitle: 'งวดที่ถึงกำหนดแล้วแต่ยังไม่มีใบสำคัญ — เงินกู้ยืม · ตั๋วสัญญาใช้เงิน · สินเชื่อสต๊อกรถ · ทรัสต์รีซีท · สัญญาเช่า',
    icon: BookOpen,
    dateLabel: 'วันครบกำหนดงวด',
  },
  {
    key: 'curtailment',
    title: 'ถึงรอบชำระคืนบางส่วน',
    subtitle: 'สินเชื่อสต๊อกรถที่ถึงกำหนดทยอยคืนเงินต้นตามขั้น — แจ้งล่วงหน้าและเมื่อเลยกำหนด',
    icon: TrendingDown,
    dateLabel: 'วันครบกำหนด',
  },
  {
    key: 'chassis_sold',
    title: 'รถขายแล้วแต่ยังไม่ปิดสัญญา',
    subtitle: 'รถในสินเชื่อสต๊อกรถถูกขายออกไปแล้ว ต้องปิดสัญญาและจ่ายเงินคืนธนาคาร',
    icon: Car,
    dateLabel: 'วันที่ขายล่าสุด',
    sort: 'recent',
  },
  {
    key: 'release',
    title: 'ปลดหลักประกัน',
    subtitle: 'สัญญาชำระครบหรือปิดแล้ว แต่ยังผูกรถไว้เป็นหลักประกัน — แจ้งฝ่ายการเงินให้ดำเนินการปลด',
    icon: KeyRound,
    dateLabel: 'วันที่แจ้ง',
  },
  {
    key: 'maturity',
    title: 'สัญญาและวงเงินใกล้ครบกำหนด',
    subtitle: 'สัญญาทุกประเภทที่ใกล้ครบกำหนด รวมถึงสัญญาหลักและวงเงินที่ใกล้สิ้นสุดอายุ',
    icon: FileText,
    dateLabel: 'วันครบกำหนด',
  },
  {
    key: 'collateral',
    title: 'หลักประกัน',
    subtitle: 'ถึงรอบประเมินราคาใหม่ และรายการที่มูลค่าตามบัญชีต่ำกว่าราคาประเมินเกิน 10%',
    icon: Shield,
    dateLabel: 'วันที่อ้างอิง',
  },
];

const AHEAD_OPTIONS = [7, 30, 60, 90];
const BACK_OPTIONS = [
  { value: 0, label: 'ย้อนหลังทั้งหมด' },
  { value: 30, label: 'ย้อนหลัง 30 วัน' },
  { value: 90, label: 'ย้อนหลัง 90 วัน' },
];
const PAGE_SIZE = 10;

export function Notifications() {
  const { can, group, isAdmin } = useAuth();
  // ผู้ใช้ต้องไม่เห็นการแจ้งเตือนของโมดูลที่ตัวเองไม่มีสิทธิ์ดู
  const allowedMenus = useMemo(
    () => NOTI_MENU_KEYS.filter((k) => can(k)),
    [can, group, isAdmin],
  );

  const [aheadDays, setAheadDays] = useState(30);
  const [backDays, setBackDays] = useState(0);
  const [catFilter, setCatFilter] = useState<'all' | NotiCategory>('all');
  const [shown, setShown] = useState<Partial<Record<NotiCategory, number>>>({});

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ['notifications', aheadDays, allowedMenus.join(',')],
    queryFn: () => getAllNotifications({ windowDays: aheadDays, allowedMenus }),
  });

  const all = data?.items ?? [];
  const loadErrors = data?.errors ?? [];
  const truncated = data?.truncated ?? 0;

  // ตัวกรองช่วงย้อนหลัง — 0 = ไม่จำกัด
  const filtered = useMemo(
    () => (backDays > 0 ? all.filter((i) => i.days >= -backDays) : all),
    [all, backDays],
  );

  const visibleCats = CATEGORIES.filter((c) => catFilter === 'all' || c.key === catFilter);

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
      <Stack direction="row" alignItems="flex-start" spacing={1} sx={{ mb: 2 }}>
        <Bell size={24} color="#0a5dc2" style={{ marginTop: 4 }} />
        <Box>
          <Typography sx={{ fontSize: '1.5rem', fontWeight: 700 }}>การแจ้งเตือน</Typography>
          <Typography variant="body2" color="text.secondary">
            รวมเรื่องที่ต้องลงมือทำและเรื่องที่ต้องเฝ้าระวัง แบ่งเป็น {CATEGORIES.length} หมวด
          </Typography>
        </Box>
      </Stack>

      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
        <TextField
          select size="small" label="หมวด" value={catFilter}
          onChange={(e) => setCatFilter(e.target.value as 'all' | NotiCategory)}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="all">ทุกหมวด</MenuItem>
          {CATEGORIES.map((c) => (
            <MenuItem key={c.key} value={c.key}>{c.title}</MenuItem>
          ))}
        </TextField>
        <TextField
          select size="small" label="ช่วงล่วงหน้า" value={aheadDays}
          onChange={(e) => setAheadDays(Number(e.target.value))}
          sx={{ minWidth: 160 }}
        >
          {AHEAD_OPTIONS.map((d) => (
            <MenuItem key={d} value={d}>{`ล่วงหน้า ${d} วัน`}</MenuItem>
          ))}
        </TextField>
        <TextField
          select size="small" label="ช่วงย้อนหลัง" value={backDays}
          onChange={(e) => setBackDays(Number(e.target.value))}
          sx={{ minWidth: 180 }}
        >
          {BACK_OPTIONS.map((o) => (
            <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
          ))}
        </TextField>
        <Button
          size="small" variant="outlined" startIcon={<RefreshCw size={14} />}
          onClick={() => refetch()} disabled={isFetching}
        >
          {isFetching ? 'กำลังโหลด...' : 'รีเฟรช'}
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          โหลดการแจ้งเตือนไม่สำเร็จ — {(error as Error).message}
        </Alert>
      )}
      {loadErrors.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          ข้อมูลบางส่วนโหลดไม่สำเร็จ รายการที่เห็นจึงอาจไม่ครบ
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {loadErrors.map((e) => <li key={e}>{e}</li>)}
          </Box>
        </Alert>
      )}
      {truncated > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          หมวดรอลงบัญชีมีรายการมากเกินกว่าจะแสดงทั้งหมด — ซ่อนไว้อีก {truncated} รายการ
          (จัดการรายการที่ค้างนานที่สุดก่อน แล้วรีเฟรชเพื่อดูรายการถัดไป)
        </Alert>
      )}

      {isLoading ? (
        <Box sx={{ p: 3, color: 'text.secondary' }}>กำลังโหลด...</Box>
      ) : (
        <Stack spacing={3}>
          {visibleCats.map((cat) => {
            const items = filtered
              .filter((i) => i.category === cat.key)
              .sort((a, b) => (cat.sort === 'recent' ? b.days - a.days : a.days - b.days));
            const Icon = cat.icon;
            const overdueCount = items.filter((i) => i.severity === 'overdue').length;
            const limit = shown[cat.key] ?? PAGE_SIZE;
            const page = items.slice(0, limit);
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
                      <Typography variant="body2">
                        ✓ ไม่มีรายการในช่วงล่วงหน้า {aheadDays} วัน
                        {backDays > 0 ? ` และย้อนหลัง ${backDays} วัน` : ' (รวมรายการที่เกินกำหนดทั้งหมด)'}
                      </Typography>
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
                            <TableCell>{cat.dateLabel}</TableCell>
                            <TableCell align="right">รายละเอียด</TableCell>
                            <TableCell sx={{ width: 80 }} />
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {page.map((i: NotiItem) => (
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
                    {items.length > page.length && (
                      <Box sx={{ p: 1, textAlign: 'center' }}>
                        <Button
                          size="small"
                          onClick={() => setShown((s) => ({ ...s, [cat.key]: limit + PAGE_SIZE }))}
                        >
                          แสดงเพิ่ม (เหลืออีก {items.length - page.length} รายการ)
                        </Button>
                      </Box>
                    )}
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
