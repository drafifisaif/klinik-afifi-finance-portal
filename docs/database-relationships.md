# Database Relationship Design

The V1 database keeps the finance workflow simple: branch activity flows into sales, expenses, supplier purchases, supplier payments, panel claims, and reporting views. It intentionally does not include inventory stock movement, dispensing, patient records, payroll, journals, or bank reconciliation.

## Core Tables

| Table | Purpose | Key Relationships |
| --- | --- | --- |
| `branches` | Klinik Afifi branch master data | Parent for sales, expenses, purchases, panel claims |
| `profiles` | App user profile linked to Supabase Auth | `profiles.id` references `auth.users.id`; optional `branch_id` |
| `daily_sales` | One daily sales record per branch | `branch_id -> branches.id`, `entered_by -> profiles.id` |
| `expenses` | Operating expenses by branch and category | `branch_id -> branches.id`, `entered_by -> profiles.id` |
| `suppliers` | Supplier master list | Parent for purchases and payments |
| `supplier_purchases` | Supplier invoices/purchase costs | `supplier_id -> suppliers.id`, `branch_id -> branches.id` |
| `supplier_purchase_items` | Optional line items for purchase detail | `purchase_id -> supplier_purchases.id` |
| `supplier_payments` | Payments made to suppliers | `supplier_id -> suppliers.id`, optional `purchase_id` |
| `panel_companies` | Panel customer/company list | Parent for panel claims |
| `panel_claims` | Panel outstanding claims | `panel_company_id -> panel_companies.id`, `branch_id -> branches.id` |
| `panel_payments` | Payments received for panel claims | `panel_claim_id -> panel_claims.id` |

## Reporting Views

| View | Use |
| --- | --- |
| `v_monthly_branch_finance` | Branch-level monthly sales, panel sales, expenses, and purchase cost |
| `v_supplier_outstanding` | Supplier invoice outstanding status and payable balance |
| `v_panel_outstanding` | Panel claim outstanding status and aging bucket |
| `v_profit_loss_monthly` | Revenue minus operating expenses and supplier purchase cost |

## Access Model

| Role | Intended Access |
| --- | --- |
| Owner | Full visibility and management |
| Admin | Full operational management |
| Finance | Finance records, reports, suppliers, panels |
| Branch PIC | Own branch records and updates |
| Staff | Own branch entry and read access |

RLS is branch-scoped for transactional data. Owner, Admin, and Finance are treated as management roles and can view all branches.

## Finance Scope Decisions

Supplier purchases record the money spent on medicine and consumables, but they do not create stock balances. This keeps V1 focused on finance reporting and leaves medicine inventory, batch, expiry, dispensing, and low-stock management for a future Clinic Operations System.
