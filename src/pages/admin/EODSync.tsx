// Admin page — End-of-Day NetSuite Sync (Feature B5)
// Lets an admin trigger the EOD batch sync manually + see the result.
// In production a scheduled task can also call runEODSync(today) directly.

import { useState } from 'react';
import {
  Box, Card, CardContent, Typography, Stack, Button, TextField, Chip,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
} from '@mui/material';
import { Play as RunIcon, Calendar as CalIcon } from 'lucide-react';
import { toast } from 'sonner';
import { runEODSync, todayISO, type EODSyncSummary } from '@/lib/eod-sync';

export function EODSync() {
  const [asOfDate, setAsOfDate] = useState<string>(todayISO());
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<EODSyncSummary | null>(null);

  async function handleRun() {
    setRunning(true);
    try {
      const result = await runEODSync(asOfDate);
      setSummary(result);
      const ok = result.failed === 0;
      const msg = `EOD ${asOfDate} · synced ${result.synced} · skipped ${result.skipped} · failed ${result.failed}`;
      ok ? toast.success(msg) : toast.error(msg);
    } catch (e: any) {
      toast.error(e?.message ?? 'EOD sync failed');
    } finally {
      setRunning(false);
    }
  }

  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto', p: 2 }}>
      <Stack sx={{ mb: 2 }}>
        <Typography sx={{ fontSize: '1.5rem', fontWeight: 700 }}>End-of-Day NetSuite Sync</Typography>
        <Typography variant="body2" color="text.secondary">
          ส่ง Posted JE ที่ยังไม่ sync ของวันที่เลือก ไป NetSuite ทีเดียว
          {' · '}กันเคสยกเลิกในวัน + ลด traffic เทียบกับ real-time
        </Typography>
      </Stack>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="end">
            <TextField
              type="date"
              label="As-of Date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ maxWidth: 220 }}
            />
            <Button
              variant="contained"
              startIcon={<RunIcon size={16} />}
              disabled={running || !asOfDate}
              onClick={handleRun}
            >
              {running ? 'กำลังรัน...' : 'Run EOD Sync'}
            </Button>
            <Button
              variant="outlined"
              startIcon={<CalIcon size={16} />}
              onClick={() => setAsOfDate(todayISO())}
            >
              วันนี้
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            หมายเหตุ: same-day reverse pair จะถูก skip อัตโนมัติ (ไม่ส่งทั้งคู่)
          </Typography>
        </CardContent>
      </Card>

      {summary && (
        <Card>
          <CardContent>
            <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }}>
              <Chip label={`Scanned ${summary.scanned}`} />
              <Chip label={`Synced ${summary.synced}`} color="success" />
              <Chip label={`Skipped ${summary.skipped}`} color="warning" />
              <Chip
                label={`Failed ${summary.failed}`}
                color={summary.failed > 0 ? 'error' : 'default'}
              />
              <Chip label={`${summary.durationMs}ms`} variant="outlined" />
            </Stack>

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>JE No.</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>NetSuite JE ID</TableCell>
                    <TableCell>Note</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {summary.results.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} sx={{ textAlign: 'center', color: 'text.secondary', py: 3 }}>
                        ไม่มี Posted JE ที่ค้าง sync ณ วันที่นี้
                      </TableCell>
                    </TableRow>
                  )}
                  {summary.results.map((r) => (
                    <TableRow key={r.je_id}>
                      <TableCell>{r.je_number}</TableCell>
                      <TableCell>
                        {r.status === 'synced' && <Chip size="small" label="synced" color="success" />}
                        {r.status === 'skipped' && <Chip size="small" label="skipped" color="warning" />}
                        {r.status === 'failed' && <Chip size="small" label="failed" color="error" />}
                      </TableCell>
                      <TableCell>{r.netsuite_je_id ?? '—'}</TableCell>
                      <TableCell sx={{ color: r.error ? 'error.main' : 'text.secondary', fontSize: 12 }}>
                        {r.error ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
