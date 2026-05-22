"use client";

import { useMemo, useState } from "react";
import { createSupplierPurchase } from "@/app/actions";
import { purchaseCategories } from "@/lib/constants";
import type { Branch, Supplier } from "@/lib/types";

type Props = {
  branches: Branch[];
  suppliers: Supplier[];
};

function addDays(dateString: string, days: number) {
  if (!dateString) return "";
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function SupplierPurchaseForm({ branches, suppliers }: Props) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [termMode, setTermMode] = useState("default");
  const [termDays, setTermDays] = useState<number>(30);
  const selectedSupplier = suppliers.find((supplier) => supplier.id === supplierId);
  const supplierDefaultTerm = selectedSupplier?.default_credit_term_days ?? selectedSupplier?.payment_terms_days ?? 30;
  const effectiveTerm = termMode === "default" ? supplierDefaultTerm : termDays;
  const dueDate = useMemo(() => addDays(invoiceDate, Math.max(0, Number(effectiveTerm) || 0)), [effectiveTerm, invoiceDate]);

  return (
    <form action={createSupplierPurchase} className="form-card">
      <h2>Record purchase</h2>
      <label>
        Supplier
        <select name="supplier_id" required value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Supplier default term
        <input value={`${supplierDefaultTerm} days`} disabled />
      </label>
      <label>
        Branch
        <select name="branch_id" required>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Invoice no.
        <input name="invoice_no" placeholder="Supplier invoice" />
      </label>
      <label>
        Invoice date
        <input name="invoice_date" type="date" required value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} />
      </label>
      <label>
        Credit term
        <select value={termMode} onChange={(event) => setTermMode(event.target.value)}>
          <option value="default">Default ({supplierDefaultTerm} days)</option>
          <option value="0">Cash / 0 days</option>
          <option value="30">30 days</option>
          <option value="60">60 days</option>
          <option value="90">90 days</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      {termMode === "custom" ? (
        <label>
          Custom term days
          <input
            min="0"
            name="credit_term_days"
            type="number"
            required
            value={termDays}
            onChange={(event) => setTermDays(Number(event.target.value) || 0)}
          />
        </label>
      ) : (
        <input name="credit_term_days" type="hidden" value={termMode === "default" ? supplierDefaultTerm : termMode} />
      )}
      <label>
        Due date (calculated)
        <input name="due_date" type="date" value={dueDate} readOnly />
      </label>
      <label>
        Category
        <select name="category" required>
          {purchaseCategories.map((category) => (
            <option key={category.value} value={category.value}>
              {category.label}
            </option>
          ))}
        </select>
      </label>
      <div className="form-grid">
        <label>
          Medicine cost
          <input min="0" name="medicine_cost" step="0.01" type="number" />
        </label>
        <label>
          Consumables cost
          <input min="0" name="consumables_cost" step="0.01" type="number" />
        </label>
        <label className="full-span">
          Other cost
          <input min="0" name="other_cost" step="0.01" type="number" />
        </label>
      </div>
      <label>
        Notes
        <textarea name="notes" />
      </label>
      <button className="primary-button" type="submit">
        Save purchase
      </button>
    </form>
  );
}
