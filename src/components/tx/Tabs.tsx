import { type ReactNode, useState } from 'react';
import { Card, CardContent } from '@/components/ui';
import { cn } from '@/lib/cn';

export interface TabDef {
  key: string;
  label: string;
  render: () => ReactNode;
  /** If true, the tab is unmounted when inactive (default: false — keep state alive). */
  unmountOnHide?: boolean;
}

/**
 * Tabs that preserve internal state of every panel by keeping all of them
 * mounted simultaneously and toggling visibility via CSS.
 * This avoids losing form values when the user switches tabs.
 *
 * Pass `unmountOnHide: true` per tab if you specifically want to unmount.
 */
export function Tabs({ tabs, defaultTab }: { tabs: TabDef[]; defaultTab?: string }) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.key);
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
        <CardContent>
          {tabs.map((t) => {
            const isActive = t.key === active;
            // For tabs marked unmountOnHide, only render when active
            if (t.unmountOnHide && !isActive) return null;
            return (
              <div key={t.key} style={{ display: isActive ? 'block' : 'none' }}>
                {t.render()}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
