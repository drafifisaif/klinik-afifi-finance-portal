import { formatCurrency } from "@/lib/format";

type BranchCardProps = {
  name: string;
  sales: number;
  expenses: number;
  purchases: number;
  panelOutstanding: number;
};

export function BranchCard({ name, sales, expenses, purchases, panelOutstanding }: BranchCardProps) {
  const profit = sales - expenses - purchases;

  return (
    <article className="branch-card">
      <div>
        <span>Branch</span>
        <h3>{name}</h3>
      </div>
      <dl>
        <div>
          <dt>Sales</dt>
          <dd>{formatCurrency(sales)}</dd>
        </div>
        <div>
          <dt>Cost</dt>
          <dd>{formatCurrency(expenses + purchases)}</dd>
        </div>
        <div>
          <dt>Profit</dt>
          <dd className={profit >= 0 ? "positive" : "negative"}>{formatCurrency(profit)}</dd>
        </div>
        <div>
          <dt>Panel</dt>
          <dd>{formatCurrency(panelOutstanding)}</dd>
        </div>
      </dl>
    </article>
  );
}
