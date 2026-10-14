# Finance Summary API

The Finance Portal exposes a read-only server-to-server summary endpoint:

`GET /api/v1/finance/summary?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`

Add `branch_id=<branch UUID>` to request one branch. Dates are inclusive and a request may cover at most 366 days.

## Configure credentials

Set `FINANCE_API_KEYS` as a private server environment variable in Vercel. Its value is a JSON array. Each key has an identifier for logs, a random bearer token, and an explicit branch scope:

```json
[
  {
    "id": "internal-summary-app",
    "token": "GENERATE_A_RANDOM_SECRET_AT_LEAST_32_CHARACTERS",
    "branch_ids": ["*"]
  },
  {
    "id": "papar-reporting-app",
    "token": "USE_A_DIFFERENT_RANDOM_SECRET_AT_LEAST_32_CHARACTERS",
    "branch_ids": ["PAPAR_BRANCH_UUID"]
  }
]
```

Use `branch_ids: ["*"]` only for an integration that is authorized to see all branches. A branch-scoped key can omit `branch_id` to get its permitted branches, or request one of them explicitly. A request for an out-of-scope branch is rejected with `403`.

Generate each token locally, for example with `openssl rand -hex 32`. Store the token only in Vercel's `FINANCE_API_KEYS` and the consuming app's server-side environment. Never use a `NEXT_PUBLIC_` variable, put the token in browser code, or send the Supabase service-role key to another app. The endpoint uses the service key internally on the server and returns aggregate data only.

## Request

```sh
curl --get 'https://finance.klinikafifi.com.my/api/v1/finance/summary' \
  --data-urlencode 'start_date=2026-08-01' \
  --data-urlencode 'end_date=2026-08-31' \
  --data-urlencode 'branch_id=PAPAR_BRANCH_UUID' \
  --header "Authorization: Bearer $FINANCE_PORTAL_API_TOKEN"
```

Example from another server-side app:

```ts
const response = await fetch(
  `${process.env.FINANCE_PORTAL_API_URL}/api/v1/finance/summary?start_date=2026-08-01&end_date=2026-08-31`,
  { headers: { Authorization: `Bearer ${process.env.FINANCE_PORTAL_API_TOKEN}` }, cache: "no-store" }
);

if (!response.ok) throw new Error(`Finance API returned ${response.status}`);
const summary = await response.json();
```

## Summary contents and accounting dates

The response includes period totals and per-branch aggregates for daily sales, operating expenses by category, supplier purchases and payments, panel claims and linked panel payments, normal Cash Bank-In, unassigned cash-month bank-ins, cash position, and petty cash balances/transactions. Each branch also includes a `daily_sales_update` indicator for the requested period: whether an active Daily Sales record exists, its sale date, its last saved timestamp, and the display name associated with `entered_by`. That name identifies who entered the record, not necessarily its last editor. A missing record means no active Daily Sales record was found for that branch in the requested period; it does not prove that the branch was expected to report on every date.

For a month-to-date briefing, request the first of the current month through today in `Asia/Kuching`. `supplier.outstanding_as_of_end_date` is the unpaid balance on all active supplier purchase entries through `end_date`, less active payments linked to those entries through that date. `supplier.outstanding_by_invoice_month` groups those unpaid balances by valid `invoice_date` month (falling back to `purchase_date` when the invoice date is absent or invalid); if both dates are invalid, the month is `unknown`. `supplier.invalid_invoice_date_count` flags records needing correction. Branch-specific legacy supplier opening balances are included in the total as `opening_balance_without_invoice_month`; they are not assigned to an invoice month. Unlinked supplier payments are not guessed against invoices. `daily_sales_update.completed_days_without_closing` counts completed calendar days since the most recent active sale date through the day before `end_date`, so a current day still in progress does not trigger a late-closing warning.

- Only non-void rows are included.
- Daily Sales uses `sale_date`; expenses use `expense_date`; supplier purchases use `purchase_date`; supplier payments and panel payments use `payment_date`; panel claims use `claim_month`.
- Cash Bank-In exposes two separate totals: `cash_month_attributed` for operational cash-period reporting and `bank_movement_by_bank_in_date` for actual deposit-date reporting. A missing `cash_month` is never inferred from the bank date.
- Cash position follows the portal's calculation: opening cash + active cash sales - active Cash Bank-Ins attributed by `cash_month` - active locum doctor expenses paid in cash.
- Petty cash uses the portal's opening-balance carry-forward plus active issued, spent, returned, and adjustment transactions in the requested date range.
- Panel payments are reported separately, not as new income. `direct_sales_excluding_panel` excludes the panel amount recorded in Daily Sales; panel claims issued are a separate receivable measure.
- `claims_outstanding_as_of_end_date` is linked active panel claims less linked active panel payments through the end date. It does not include legacy opening-balance adjustments.
- Salary/rental expense amounts are present in aggregate category totals. Protect these credentials as finance-sensitive and only issue them to trusted server-side integrations.

Responses set `Cache-Control: no-store`. Missing API configuration returns `503`; invalid credentials return `401`; invalid date parameters return `400`; unauthorized branch scope returns `403`. No write endpoint is provided.
