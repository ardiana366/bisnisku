/**
 * Bisnisku — export.js
 * In-browser CSV generator (UTF-8 BOM so Excel reads Indonesian text correctly)
 * with automatic download. No libraries.
 */
import { MONTHS_ID, toYm, num } from "./calculator.js";

const BOM = "\uFEFF";

function cell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const row = (arr) => arr.map(cell).join(",");

const round = (n) => Math.round(num(n));

function slug(text) {
  return (
    String(text || "usaha")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "usaha"
  );
}

/** Build the CSV text for one month. */
export function buildMonthCsv({ business, products, sales, expenses = [], year, monthIndex0, dailyTarget, burden, summary }) {
  const lines = [];
  lines.push(row(["Bisnisku - Laporan Penjualan & Pengeluaran"]));
  lines.push(row(["Usaha", business.name]));
  lines.push(row(["Periode", `${MONTHS_ID[monthIndex0]} ${year}`]));
  lines.push(row(["Beban Rutin Bulanan (Rp)", round(burden)]));
  lines.push(row(["Target BEP Harian (Rp)", round(dailyTarget)]));
  lines.push("");

  const header = [
    "Tanggal",
    ...products.map((p) => `Qty ${p.name}`),
    "Pendapatan (Rp)",
    "HPP (Rp)",
    "Laba Kotor (Rp)",
    "Target BEP Harian (Rp)",
    "Status BEP",
    "Catatan",
  ];
  lines.push(row(header));

  const sorted = [...sales].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const s of sorted) {
    const qtyByProduct = new Map((s.items || []).map((it) => [it.productId, num(it.qty)]));
    const reached = dailyTarget > 0 && num(s.totalRevenue) >= dailyTarget;
    lines.push(
      row([
        s.date,
        ...products.map((p) => qtyByProduct.get(p.id) || 0),
        round(s.totalRevenue),
        round(s.totalCogs),
        round(s.grossProfit),
        round(dailyTarget),
        dailyTarget > 0 ? (reached ? "Tercapai" : "Di bawah target") : "-",
        s.notes || "",
      ])
    );
  }

  // Incidental Expenses Section
  if (expenses && expenses.length > 0) {
    lines.push("");
    lines.push(row(["PENGELUARAN KAS INSIDENTAL (ONE-OFF OUTFLOWS)"]));
    lines.push(row(["Tanggal", "Keterangan", "Kategori", "Jenis Pengeluaran", "Nominal (Rp)", "Catatan"]));
    const sortedExp = [...expenses].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (const exp of sortedExp) {
      lines.push(
        row([
          exp.date,
          exp.title || "",
          exp.category || "-",
          exp.expenseType === "capex" ? "Capex (Beli Aset)" : "Opex (Operasional)",
          round(exp.amount),
          exp.notes || "",
        ])
      );
    }
  }

  lines.push("");
  lines.push(row(["RINGKASAN"]));
  lines.push(row(["Hari Tercatat", summary.recorded]));
  lines.push(row(["Total Pendapatan (Rp)", round(summary.totalRevenue)]));
  lines.push(row(["Total HPP (Rp)", round(summary.totalCogs)]));
  lines.push(row(["Total Laba Kotor (Rp)", round(summary.totalGross)]));
  lines.push(row(["Rata-rata Pendapatan Harian (Rp)", round(summary.avgDailyRevenue)]));
  lines.push(row(["Hari Mencapai BEP", summary.daysReachedBep]));

  if (summary.proratedBurden !== undefined) {
    lines.push(row([`Beban Rutin Prorata (${summary.daysElapsed || summary.recorded || 0} Hari) (Rp)`, round(summary.proratedBurden)]));
  }
  if (summary.totalIncidentalOpex !== undefined) {
    lines.push(row(["Total Pengeluaran Insidental Opex (Rp)", round(summary.totalIncidentalOpex)]));
  }
  if (summary.totalIncidentalCapex !== undefined) {
    lines.push(row(["Total Pengeluaran Insidental Capex (Rp)", round(summary.totalIncidentalCapex)]));
  }
  if (summary.operatingNetProfit !== undefined) {
    lines.push(row([`Laba Bersih Berjalan (${summary.daysElapsed || summary.recorded || 0} Hari) (Rp)`, round(summary.operatingNetProfit)]));
  }
  if (summary.netCashRemaining !== undefined && summary.totalIncidentalCapex > 0) {
    lines.push(row(["Sisa Kas Riil Berjalan (Rp)", round(summary.netCashRemaining)]));
  }

  lines.push(
    row([
      "Proyeksi Laba Bersih Akhir Bulan (Rp)",
      summary.projectedNet === null ? "-" : round(summary.projectedNet),
    ])
  );
  lines.push(
    row([
      "Estimasi Balik Modal (bulan)",
      summary.paybackMonths === null ? "-" : +summary.paybackMonths.toFixed(1),
    ])
  );

  return BOM + lines.join("\r\n");
}

/** Build the CSV text for incidental expenses only. */
export function buildExpensesCsv({ business, expenses = [], year, monthIndex0 }) {
  const lines = [];
  lines.push(row(["Bisnisku - Laporan Pengeluaran Kas Insidental"]));
  lines.push(row(["Usaha", business?.name || "Usaha"]));
  lines.push(row(["Periode", `${MONTHS_ID[monthIndex0]} ${year}`]));
  lines.push("");

  const header = ["Tanggal", "Keterangan", "Kategori", "Jenis Pengeluaran", "Nominal (Rp)", "Catatan"];
  lines.push(row(header));

  let totalOpex = 0;
  let totalCapex = 0;
  const sorted = [...expenses].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const exp of sorted) {
    const amt = num(exp.amount);
    if (exp.expenseType === "capex") {
      totalCapex += amt;
    } else {
      totalOpex += amt;
    }
    lines.push(
      row([
        exp.date,
        exp.title || "",
        exp.category || "-",
        exp.expenseType === "capex" ? "Capex (Beli Aset / Tambah Modal)" : "Opex (Operasional Lepas)",
        round(amt),
        exp.notes || "",
      ])
    );
  }

  lines.push("");
  lines.push(row(["RINGKASAN PENGELUARAN"]));
  lines.push(row(["Total Transaksi Pengeluaran", sorted.length]));
  lines.push(row(["Total Pengeluaran Opex Lepas (Rp)", round(totalOpex)]));
  lines.push(row(["Total Pengeluaran Capex Aset (Rp)", round(totalCapex)]));
  lines.push(row(["Total Seluruh Uang Kas Keluar (Rp)", round(totalOpex + totalCapex)]));

  return BOM + lines.join("\r\n");
}

/** Build + trigger the browser download for full monthly report. */
export function exportMonthCsv(ctx) {
  const csv = buildMonthCsv(ctx);
  const filename = `bisnisku-${slug(ctx.business?.name)}-${toYm(ctx.year, ctx.monthIndex0)}.csv`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return filename;
}

/** Build + trigger the browser download for incidental expenses. */
export function exportExpensesCsv(ctx) {
  const csv = buildExpensesCsv(ctx);
  const filename = `bisnisku-pengeluaran-${slug(ctx.business?.name)}-${toYm(ctx.year, ctx.monthIndex0)}.csv`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return filename;
}
