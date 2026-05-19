import { type ReactNode, useState } from 'react';
import { Card, CardContent } from '@/components/ui';
import { cn } from '@/lib/cn';

export interface TabDef {
  key: string;
  label: string;
  render: () => ReactNode;
}

export function Tabs({ tabs, defaultTab }: { tabs: TabDef[]; defaultTab?: string }) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.key);
  const cur = tabs.find((t) => t.key === active) ?? tabs[0];
  return (
    <div>
      <div className="flex border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition',
              active === t.key ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Card className="rounded-t-none">
        <CardContent>{cur?.render()}</CardContent>
      </Card>
    </div>
  );
}
