import { type ReactNode, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, Collapse, Box } from '@mui/material';

export function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card sx={{ mb: 2 }}>
      <Box
        component="button"
        type="button"
        onClick={() => setOpen((o) => !o)}
        sx={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 1,
          px: 2.5, py: 1.25, textAlign: 'left',
          fontSize: 14, fontWeight: 600, letterSpacing: '0.025em',
          bgcolor: 'background.default', border: 0, borderBottom: 1, borderColor: 'divider',
          cursor: 'pointer', color: 'text.primary',
          '&:hover': { bgcolor: 'grey.100' },
        }}
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        {title}
      </Box>
      <Collapse in={open} unmountOnExit>
        <CardContent>{children}</CardContent>
      </Collapse>
    </Card>
  );
}
