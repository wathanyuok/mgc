import { Card, CardContent } from '@/components/ui';

export function Placeholder({ name }: { name: string }) {
  return (
    <div className="max-w-3xl mx-auto">
      <Card>
        <CardContent>
          <div className="text-center py-12">
            <div className="text-3xl mb-2">🚧</div>
            <h2 className="text-xl font-bold">{name}</h2>
            <p className="text-muted mt-2">
              โมดูลนี้กำลังอยู่ระหว่างพัฒนา — schema และ UI โครงสร้างพร้อมแล้วใน{' '}
              <code className="bg-gray-100 px-1 rounded">supabase/migrations/</code>
            </p>
            <p className="text-xs text-muted mt-4">
              Phase 1: MA + Lease (functional) → Phase 2: CA + Loan + LG → Phase 3: PN + FP + OD + FXF
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
