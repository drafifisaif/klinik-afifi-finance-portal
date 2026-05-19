# Implementation Guide

## Environment Variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase browser/server anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | Admin scripts only. Do not expose in browser code. |
| `NEXT_PUBLIC_APP_URL` | Yes | Local or production app URL |

## Supabase Setup

1. Create a Supabase project.
2. Open the SQL editor.
3. Run [schema.sql](/Users/drafifisaif/Documents/Codex/2026-05-20/create-klinik-afifi-finance-portal-v1/supabase/schema.sql).
4. In Authentication, enable Email/Password sign-in.
5. Create the first owner user in Supabase Auth.
6. Update that user's `profiles.role` to `owner` in the table editor or SQL editor.
7. Create `.env.local` from `.env.example`.

Example owner role update:

```sql
update public.profiles
set role = 'owner', full_name = 'Klinik Afifi Owner'
where id = 'AUTH_USER_UUID_HERE';
```

## Local Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Vercel Deployment

See [Deployment Readiness](/Users/drafifisaif/Documents/Codex/2026-05-20/create-klinik-afifi-finance-portal-v1/docs/deployment.md) for Supabase Auth URLs, environment variables, and Vercel build settings.

## Module Flow

1. Branch setup: maintain Putatan, Papar, Ranau, and Kinabatangan.
2. Daily Sales: enter one sales summary per branch per day by payment type.
3. Expenses: record operating expenses by branch and category.
4. Supplier Purchases: record medicine, consumable, and other supplier purchase costs.
5. Supplier Payments: track payments against suppliers or specific purchases.
6. Panel Outstanding: track panel companies, claims, payment status, and aging.
7. Reports: summarize profit/loss and cashflow without full accounting ledgers.

## V1 Boundaries

Included:

- Supabase Auth-ready login
- Branch-scoped finance modules
- Daily sales by payment type
- Expense categorization
- Supplier purchases and payments
- Panel outstanding tracking
- Profit and loss summary
- Cashflow summary

Excluded:

- Full accounting ledger
- e-Invoice
- Bank reconciliation
- Payroll
- Approval workflow
- Patient medical records
- Consultation system
- Pharmacy dispensing
- Inventory stock in/out, stock balance, batch, expiry, or low-stock alerts
