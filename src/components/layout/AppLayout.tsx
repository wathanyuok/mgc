import { Outlet, Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Sidebar } from './Sidebar';
import { Bell, LogOut, Eye } from 'lucide-react';
import {
  Box, AppBar, Toolbar, Typography, IconButton, Badge, Avatar, Stack, Alert,
} from '@mui/material';
import { getAllNotifications } from '@/lib/notifications';
import { useAuth } from '@/lib/auth';
import { ReadOnlyContext } from '@/lib/readonly';

export function AppLayout() {
  const { user, group, session, isAdmin, signOut } = useAuth();
  const [searchParams] = useSearchParams();
  const viewMode = searchParams.get('view') === '1';
  const displayName = user?.name || session?.user?.email || 'User';
  const roleLabel = isAdmin ? 'Admin' : group?.name ?? (user ? 'ยังไม่กำหนดกลุ่ม' : 'ยังไม่ provision');
  const initial = (displayName[0] ?? 'U').toUpperCase();

  const { data: notis = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => getAllNotifications(30),
    refetchInterval: 5 * 60 * 1000,
  });
  const count = notis.length;
  const urgent = notis.filter((n) => n.severity === 'overdue').length;

  return (
    <Box sx={{ display: 'flex', height: '100%' }}>
      <Sidebar />
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <AppBar position="static">
          <Toolbar sx={{ minHeight: '56px !important', px: 3 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary', flexGrow: 1 }}>
              YIP Consulting × MGC-Asia
            </Typography>
            <Stack direction="row" alignItems="center" spacing={2}>
              <IconButton
                component={Link}
                to="/notifications"
                size="small"
                aria-label="Notifications"
                title={`${count} แจ้งเตือน${urgent ? ` · ${urgent} เกินกำหนด` : ''}`}
                sx={{ color: 'text.secondary' }}
              >
                <Badge badgeContent={count > 99 ? '99+' : count} color={urgent > 0 ? 'error' : 'primary'} invisible={count === 0}>
                  <Bell size={18} />
                </Badge>
              </IconButton>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Avatar sx={{ bgcolor: 'primary.main', width: 32, height: 32, fontSize: 14, fontWeight: 600 }}>
                  {initial}
                </Avatar>
                <Box sx={{ lineHeight: 1.2 }}>
                  <Typography sx={{ fontSize: 14, fontWeight: 500 }}>{displayName}</Typography>
                  <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{roleLabel}</Typography>
                </Box>
                <IconButton onClick={() => signOut()} size="small" title="ออกจากระบบ" aria-label="Logout" sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}>
                  <LogOut size={16} />
                </IconButton>
              </Stack>
            </Stack>
          </Toolbar>
        </AppBar>
        <Box component="main" sx={{ flex: 1, overflowY: 'auto', p: 3 }}>
          {viewMode && (
            <Alert icon={<Eye size={16} />} severity="warning" sx={{ maxWidth: 1400, mx: 'auto', mb: 1.5 }}>
              โหมดดูอย่างเดียว (View) — แก้ไขไม่ได้
            </Alert>
          )}
          <ReadOnlyContext.Provider value={viewMode}>
            <Outlet />
          </ReadOnlyContext.Provider>
        </Box>
      </Box>
    </Box>
  );
}
