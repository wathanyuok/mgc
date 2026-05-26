import { type ReactNode, useState } from 'react';
import { Card, CardContent, Tabs as MuiTabs, Tab, Box } from '@mui/material';

export interface TabDef {
  key: string;
  label: string;
  render: () => ReactNode;
  unmountOnHide?: boolean;
}

export function Tabs({ tabs, defaultTab }: { tabs: TabDef[]; defaultTab?: string }) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.key);
  return (
    <Box>
      <MuiTabs
        value={active}
        onChange={(_, v) => setActive(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        {tabs.map((t) => (
          <Tab key={t.key} value={t.key} label={t.label} />
        ))}
      </MuiTabs>
      <Card sx={{ borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTop: 0 }}>
        <CardContent>
          {tabs.map((t) => {
            const isActive = t.key === active;
            if (t.unmountOnHide && !isActive) return null;
            return (
              <div key={t.key} style={{ display: isActive ? 'block' : 'none' }}>
                {t.render()}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </Box>
  );
}
