# MGC-Asia ERP — Lease Module (React + Supabase)

Production-grade rewrite of `master_agreement_v30.html` as a real React app with Supabase persistence.

**Stack:** React 18 · TypeScript · Vite · Tailwind · TanStack Query · React Hook Form · Zod · Supabase · React Router · Sonner

---

## Quick start

```bash
# 1. Install deps
npm install

# 2. Configure Supabase
cp .env.example .env
# Edit .env: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY

# 3. Run the schema migration in Supabase
#    (Supabase Dashboard → SQL Editor → paste the contents of:)
#    supabase/migrations/0001_init.sql

# 4. Start dev server
npm run dev
# → http://localhost:5173
```

---

## What works today (Phase 1)

| Module                     | List | Detail | CRUD | Supabase | Notes                                   |
| -------------------------- | :--: | :----: | :--: | :------: | --------------------------------------- |
| Master Agreement (MA)      |  ✅  |   ✅   |  ✅  |    ✅    | Full CRUD, search, validation           |
| Credit Agreement (CA)      |  ✅  |   ⚠   |  R   |    ✅    | List works; detail form in Phase 2      |
| Lease (HP + IFRS 16)       |  ✅  |   ✅   |  ✅  |    ✅    | Live amortization, balloon, schedule    |
| Loan / LG / PN / FP / OD   |  -   |   -    |  -   |    -     | Placeholder pages, schema TODO          |

### Lease module highlights

- **Mode switcher**: HP Motor ↔ Lease (TFRS 16). Form fields adapt automatically.
- **Bank Loan toggle** (Lease only): controls CA visibility and repayment channel indicator.
- **Auto-compute**: Net Vehicle Cost = Vehicle Price − Down Payment → Principal (HP).
- **Live Amortization Schedule**: PMT formula, monthly rate, balloon, grace/prepaid periods.
- **Save** writes both `leases` row and `lease_schedules` rows (replaces previous schedule on edit).
- **EIR helper** in `lib/lease-calc.ts` (Newton iteration over cashflows).

---

## Project layout

```
developer/mgc/
├── public/
├── src/
│   ├── components/
│   │   ├── layout/       AppLayout, Sidebar
│   │   └── ui/           Button, Input, Card, Badge, Modal
│   ├── lib/
│   │   ├── supabase.ts   Supabase client
│   │   ├── queryClient.ts TanStack Query config
│   │   ├── lease-calc.ts PMT, PV, schedule, EIR
│   │   ├── format.ts     fmtMoney / fmtPercent / fmtDate
│   │   └── cn.ts         tailwind-merge helper
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   ├── Placeholder.tsx
│   │   ├── ma/           MAList, MADetail
│   │   ├── ca/           CAList
│   │   ├── lease/        LeaseList, LeaseDetail
│   │   └── ...           loan/lg/pn/fp/od (TODO)
│   ├── types/
│   │   └── database.ts   Supabase DB types
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── supabase/
│   └── migrations/
│       └── 0001_init.sql   Schema for MA, CA, Lease, Schedule
├── .env.example
├── tailwind.config.js
├── tsconfig.json
├── vite.config.ts
└── package.json
```

---

## Roadmap

| Phase | Scope                                                            | Status |
| ----- | ---------------------------------------------------------------- | :----: |
| 1     | Project skeleton, MA + Lease functional, Supabase wired          | ✅     |
| 2     | CA full CRUD, Loan module, Letter of Guarantee                   | ⏳     |
| 3     | Promissory Note, Floor Plan, Overdraft, FX Forward, Trust Receipt | ⏳     |
| 4     | Modify/Close-Early modals, Re-measurement, Asset Transfer        | ⏳     |
| 5     | Reports (Movement Lease Liability, ROU Asset, age-bucket)         | ⏳     |
| 6     | Auth (Supabase Auth), RLS tightening, NetSuite API bridge        | ⏳     |

---

## Sources

- `MGC_Lease_Module_Summary.md` — feature catalogue (Phases 1–4)
- `master_agreement_v30.html` — HTML prototype (~12,800 lines) — source of truth for UI behavior
- MOM Day 4 (14/05/2026) — Hire Purchase + IFRS 16 Workshop

---

## License

Internal — MGC-Asia × YIP Consulting.
