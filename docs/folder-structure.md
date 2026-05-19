# Next.js Folder Structure

```text
app/
  auth/
    callback/route.ts
  (auth)/
    login/
      page.tsx
  (portal)/
    layout.tsx
    dashboard/page.tsx
    branches/page.tsx
    sales/page.tsx
    expenses/page.tsx
    purchases/page.tsx
    suppliers/payments/page.tsx
    panels/page.tsx
    reports/
      profit-loss/page.tsx
      cashflow/page.tsx
  actions.ts
  globals.css
  layout.tsx
  page.tsx
components/
  app-shell.tsx
  branch-card.tsx
  data-table.tsx
  metric-card.tsx
  module-header.tsx
lib/
  constants.ts
  data.ts
  format.ts
  supabase-client.ts
  supabase-server.ts
  types.ts
supabase/
  schema.sql
docs/
  database-relationships.md
  folder-structure.md
  implementation.md
```

## Architecture Notes

- `app/(portal)` contains authenticated product modules with shared navigation.
- `lib/data.ts` centralizes data loading. It uses Supabase when environment variables are configured and falls back to demo data for local UI review.
- `app/actions.ts` contains server actions for MVP inserts.
- `supabase/schema.sql` is the source of truth for database setup, RLS, storage buckets, and reporting views.
