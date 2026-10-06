/**
 * Bisnisku — calculator.js
 * Pure math engine: no DOM, no Firebase. Every function is deterministic.
 * (A few tiny formatting helpers live at the bottom because they are also pure.)
 */

/** Spec: daily target is monthly target divided by a fixed 30 days. */
export const DAYS_FOR_TARGET = 30;

const EPS = 1e-9;

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/** Coerce anything (string / null / NaN) to a finite number. */
export function num(v) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/* ------------------------------------------------------------------ */
/* 1. Cost frequency normalization                                     */
/* ------------------------------------------------------------------ */

/** Convert a recurring cost into its monthly equivalent. */
export function toMonthly(amount, frequency) {
  const a = num(amount);
  switch (frequency) {
    case "daily":
      return a * 30; // Daily × 30
    case "yearly":
      return a / 12; // Yearly / 12
    case "monthly":
    default:
      return a;
  }
}

/** Sum a list of [{ amount, frequency }] into a monthly Opex. */
export function totalMonthlyOpex(items = []) {
  return items.reduce((sum, it) => sum + toMonthly(it.amount, it.frequency), 0);
}

/* ------------------------------------------------------------------ */
/* 2. Capital burden & loan installment (Flat method)                  */
/* ------------------------------------------------------------------ */

/**
 * Flat-rate loan:
 *   principal = Capital / Tenor
 *   interest  = Capital × (AnnualRate/100) / 12
 */
export function loanBreakdown({ capital, tenorMonths, annualInterestRatePct }) {
  const c = num(capital);
  const tenor = Math.max(1, Math.round(num(tenorMonths)) || 1);
  const principal = c / tenor;
  const interest = (c * (num(annualInterestRatePct) / 100)) / 12;
  return { principal, interest, installment: principal + interest };
}

/** Monthly burden coming only from the capital (installment or payback share). */
export function capitalMonthlyBurden({
  capitalType,
  initialCapital,
  loanDetails,
  ownCapitalDetails,
}) {
  const capital = num(initialCapital);
  if (capitalType === "loan") {
    return loanBreakdown({
      capital,
      tenorMonths: loanDetails?.tenorMonths,
      annualInterestRatePct: loanDetails?.annualInterestRatePct,
    }).installment;
  }
  const payback = Math.max(1, num(ownCapitalDetails?.targetPaybackMonths) || 1);
  return capital / payback;
}

/** Monthly Burden = Monthly Fixed Opex + capital burden. */
export function monthlyBurden(monthlyOpex, capitalInfo) {
  return num(monthlyOpex) + capitalMonthlyBurden(capitalInfo);
}

/* ------------------------------------------------------------------ */
/* 3. Margins, WACMR & price recommendation                            */
/* ------------------------------------------------------------------ */

/** Contribution Margin Ratio of a single product: (Price − COGS) / Price. */
export function cmr(price, cogs) {
  const p = num(price);
  return p > 0 ? (p - num(cogs)) / p : 0;
}

/** Actual margin in percent (0-100) for a price/COGS pair. */
export function marginPct(price, cogs) {
  return cmr(price, cogs) * 100;
}

/** WACMR = Σ ( CMR_i × SalesShare_i / 100 ). */
export function wacmr(products = []) {
  return products.reduce(
    (sum, p) => sum + cmr(p.price, p.cogs) * (num(p.salesSharePct) / 100),
    0
  );
}

/** Calculate sales-share-weighted average price across products. */
export function weightedAvgPrice(products = []) {
  if (!products.length) return 0;
  let totalShare = 0;
  let weightedSum = 0;
  for (const p of products) {
    const share = num(p.salesSharePct);
    const price = num(p.price);
    weightedSum += price * (share / 100);
    totalShare += share;
  }
  if (totalShare > 0) {
    return weightedSum / (totalShare / 100);
  }
  const sumPrice = products.reduce((acc, p) => acc + num(p.price), 0);
  return sumPrice / products.length;
}

/** Suggested Price = ceil( COGS / (1 − TargetMargin/100) / 500 ) × 500. */
export function suggestPrice(cogs, targetMarginPct) {
  const c = num(cogs);
  if (c <= 0) return 0;
  const m = clamp(num(targetMarginPct), 0, 95) / 100;
  return Math.ceil(c / (1 - m) / 500 - EPS) * 500;
}

/* ------------------------------------------------------------------ */
/* 4. Break-even (target cashier revenue)                              */
/* ------------------------------------------------------------------ */

/**
 * @param {number} burden   monthly burden (Opex + capital)
 * @param {Array}  products [{ productId?, name, price, cogs, salesSharePct }]
 * @returns {{valid:boolean, wacmr:number, monthlyTarget:number, dailyTarget:number, perProduct:Array}}
 */
export function breakEven({ burden, products = [] }) {
  const w = wacmr(products);
  const b = num(burden);
  if (w <= 0 || products.length === 0) {
    return {
      valid: false,
      wacmr: w,
      monthlyTarget: 0,
      dailyTarget: 0,
      perProduct: products.map((p) => ({
        id: p.id ?? p.productId ?? null,
        productId: p.productId ?? p.id ?? null,
        name: p.name,
        price: num(p.price),
        salesSharePct: num(p.salesSharePct),
        targetRevenue: 0,
        targetQty: 0,
      })),
    };
  }
  const monthlyTarget = b / w;
  const dailyTarget = monthlyTarget / DAYS_FOR_TARGET;
  const perProduct = products.map((p) => {
    const share = num(p.salesSharePct);
    const targetRevenue = dailyTarget * (share / 100);
    const price = num(p.price);
    return {
      id: p.id ?? p.productId ?? null,
      productId: p.productId ?? p.id ?? null,
      name: p.name,
      price,
      salesSharePct: share,
      targetRevenue,
      targetQty: price > 0 ? Math.ceil(targetRevenue / price - EPS) : 0,
    };
  });
  return { valid: true, wacmr: w, monthlyTarget, dailyTarget, perProduct };
}

/* ------------------------------------------------------------------ */
/* 5. Monthly performance run-rate                                     */
/* ------------------------------------------------------------------ */

export function daysInMonth(year, monthIndex0) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

/**
 * @param {Array}  sales  daily_sales docs of the selected month
 * @param {number} burden monthly burden
 * @param {number} days   days in the selected month
 * @param {number} unrecoveredCapital
 * @param {number} dailyTarget BEP revenue target per day
 */
export function runRate({
  sales = [],
  burden,
  days,
  unrecoveredCapital,
  dailyTarget = 0,
}) {
  const recorded = sales.length;
  let totalRevenue = 0;
  let totalCogs = 0;
  let totalGross = 0;
  let daysReachedBep = 0;
  for (const s of sales) {
    totalRevenue += num(s.totalRevenue);
    totalCogs += num(s.totalCogs);
    totalGross += num(s.grossProfit);
    if (dailyTarget > 0 && num(s.totalRevenue) + EPS >= dailyTarget) {
      daysReachedBep++;
    }
  }
  const b = num(burden);
  const avgDailyRevenue = recorded ? totalRevenue / recorded : 0;
  const avgDailyGross = recorded ? totalGross / recorded : 0; // ∑Gross / Days Recorded
  const projectedNet = recorded ? avgDailyGross * days - b : null; // (Avg × Days in month) − Burden
  const paybackMonths =
    projectedNet !== null && projectedNet > 0
      ? num(unrecoveredCapital) / projectedNet
      : null;
  return {
    recorded,
    totalRevenue,
    totalCogs,
    totalGross,
    avgDailyRevenue,
    avgDailyGross,
    projectedNet,
    paybackMonths,
    coveragePct: b > 0 ? (totalGross / b) * 100 : 0,
    daysReachedBep,
  };
}

/* ------------------------------------------------------------------ */
/* 5b. Monthly net profit calculation with incidental expenses         */
/* ------------------------------------------------------------------ */

/**
 * Menghitung Laba Bersih & Arus Kas dengan beban rutin proporsional/prorata hari berjalan
 */
export function calculateNetWithIncidentals({
  realizedGrossProfit,
  monthlyFixedBurden,
  totalIncidentalOpex = 0,
  unrecoveredCapital = 0,
  totalIncidentalCapex = 0,
  daysInMonth = 30,
  daysElapsed = 30
}) {
  const gross = num(realizedGrossProfit);
  const burden = num(monthlyFixedBurden);
  const opex = num(totalIncidentalOpex);
  const unrec = num(unrecoveredCapital);
  const capex = num(totalIncidentalCapex);
  const totalDays = Math.max(1, num(daysInMonth) || 30);
  const elapsed = clamp(num(daysElapsed) || totalDays, 1, totalDays);

  // Beban rutin harian
  const dailyBurden = burden / totalDays;
  // Beban rutin proporsional/prorata sesuai jumlah hari yang sudah berjalan
  const proratedBurden = Math.round(dailyBurden * elapsed);

  // Beban operasional sebulan penuh (rutin penuh + opex)
  const totalOperatingBurden = burden + opex;
  // Beban operasional prorata hari berjalan (rutin prorata + opex)
  const proratedOperatingBurden = proratedBurden + opex;

  // Laba bersih operasional riil berjalan (Laba kotor - Beban rutin prorata - Opex)
  const operatingNetProfit = gross - proratedOperatingBurden;

  // Total uang kas keluar prorata (Beban prorata + opex + capex)
  const proratedCashOutflow = proratedOperatingBurden + capex;
  // Sisa kas riil berjalan setelah belanja modal/aset
  const netCashRemaining = gross - proratedCashOutflow;

  // Catatan: unrecoveredCapital dari database sudah ter-update secara persisten
  // saat transaksi Capex dicatat. Maka di sini tidak ditambah capex lagi untuk mencegah double-counting.
  const adjustedUnrecoveredCapital = Math.max(0, unrec);

  let projectedMonthsToPayback = null;
  if (adjustedUnrecoveredCapital > 0 && operatingNetProfit > 0) {
    projectedMonthsToPayback = Number((adjustedUnrecoveredCapital / operatingNetProfit).toFixed(1));
  }

  return {
    dailyBurden,
    proratedBurden,
    daysElapsed: elapsed,
    daysInMonth: totalDays,
    totalOperatingBurden,
    proratedOperatingBurden,
    totalCashOutflow: proratedCashOutflow,
    operatingNetProfit,
    netProfitMonthToDate: operatingNetProfit,
    netCashRemaining,
    adjustedUnrecoveredCapital,
    projectedMonthsToPayback,
    isProfitable: operatingNetProfit > 0
  };
}

/* ------------------------------------------------------------------ */
/* 6. Post-BEP profit allocation                                       */
/* ------------------------------------------------------------------ */

/**
 * Calculate post-BEP net surplus allocation across reserve buckets.
 *
 * @param {number} realizedGrossProfit Cumulative gross profit for the active month to date
 * @param {number} monthlyFixedBurden  Total fixed monthly obligations (Opex + debt/capex)
 * @param {number} [unrecoveredCapital=0] Remaining unpaid initial capital
 * @param {object} [ratios={ emergency: 0.4, reinvest: 0.3, dividend: 0.3 }]
 * @param {number} [investorSharePct=0] Percentage of net surplus allocated to dynamic investor profit share
 * @param {number} [totalIncidentalCapex=0] One-off capital expenditures (cash outflows)
 * @returns {{ isSurplus: boolean, netSurplus: number, investorSharePct: number, investorPayout: number, emergencyFund: number, reinvestment: number, dividend: number, unrecoveredCapital: number }}
 */
export function calculateProfitAllocation(
  realizedGrossProfit,
  monthlyFixedBurden,
  unrecoveredCapital = 0,
  ratios = { emergency: 0.4, reinvest: 0.3, dividend: 0.3 },
  investorSharePct = 0,
  totalIncidentalCapex = 0
) {
  const gross = num(realizedGrossProfit);
  const burden = num(monthlyFixedBurden);
  const unrec = num(unrecoveredCapital);
  const capex = num(totalIncidentalCapex);
  const netSurplus = gross - (burden + capex);

  if (netSurplus <= 0) {
    return {
      isSurplus: false,
      netSurplus: 0,
      investorSharePct: 0,
      investorPayout: 0,
      emergencyFund: 0,
      reinvestment: 0,
      dividend: 0,
      unrecoveredCapital: unrec,
    };
  }

  const invPct = clamp(num(investorSharePct), 0, 100);
  const investorPayout = Math.round(netSurplus * (invPct / 100));
  const remainingForBusiness = Math.max(0, netSurplus - investorPayout);

  const effectiveRatios = {
    emergency: ratios?.emergency ?? 0.4,
    reinvest: ratios?.reinvest ?? 0.3,
    dividend: ratios?.dividend ?? 0.3,
  };

  const emergencyFund = Math.round(remainingForBusiness * effectiveRatios.emergency);
  const reinvestment = Math.round(remainingForBusiness * effectiveRatios.reinvest);
  const dividend = Math.round(remainingForBusiness * effectiveRatios.dividend);

  return {
    isSurplus: true,
    netSurplus,
    investorSharePct: invPct,
    investorPayout,
    emergencyFund,
    reinvestment,
    dividend,
    unrecoveredCapital: unrec,
  };
}

/**
 * Calculate the monthly fixed burden contribution from a capital addition.
 *
 * @param {object} params
 * @param {number} params.amount
 * @param {"invest" | "own" | "loan"} params.type
 * @param {"fixed" | "dynamic"} [params.returnType]
 * @param {number} [params.fixedReturnPct] % return per month
 * @param {number} [params.tenorMonths]
 * @param {number} [params.paybackMonths]
 * @param {number} [params.annualInterestRatePct]
 * @returns {number}
 */
export function calculateAdditionMonthlyBurden({
  amount,
  type,
  returnType = "dynamic",
  fixedReturnPct = 0,
  tenorMonths = 0,
  paybackMonths = 0,
  annualInterestRatePct = 0,
}) {
  const amt = Math.max(0, num(amount));
  if (amt <= 0) return 0;

  if (type === "invest") {
    if (returnType === "fixed") {
      const retRate = Math.max(0, num(fixedReturnPct)) / 100;
      const monthlyReturn = amt * retRate;
      const tenor = Math.round(num(tenorMonths));
      const principalInstallment = tenor > 0 ? amt / tenor : 0;
      return Math.round(monthlyReturn + principalInstallment);
    } else {
      // Dynamic: return is paid from post-BEP surplus, only principal installment is fixed if tenor > 0
      const tenor = Math.round(num(tenorMonths));
      return tenor > 0 ? Math.round(amt / tenor) : 0;
    }
  } else if (type === "loan") {
    const tenor = Math.max(1, Math.round(num(tenorMonths)) || 1);
    const rate = num(annualInterestRatePct);
    const loan = loanBreakdown({ capital: amt, tenorMonths: tenor, annualInterestRatePct: rate });
    return Math.round(loan.installment);
  } else {
    // Own capital
    const payback = Math.round(num(paybackMonths));
    return payback > 0 ? Math.round(amt / payback) : 0;
  }
}

/* ------------------------------------------------------------------ */
/* 7. What-If expense increase simulation                              */
/* ------------------------------------------------------------------ */

/**
 * Simulate the operational and revenue impact of an expense hike.
 *
 * @param {object} params
 * @param {number} params.currentMonthlyBurden
 * @param {number} params.expenseIncreaseAmount
 * @param {number} params.wacmrRatio
 * @param {number} params.avgProductPrice
 * @param {number} [params.operatingDays=30]
 * @returns {{ newMonthlyBurden: number, newMonthlyRevenueTarget: number, monthlyRevenueDelta: number, newDailyRevenueTarget: number, dailyRevenueDelta: number, extraDailyUnits: number }}
 */
export function simulateExpenseIncrease({
  currentMonthlyBurden,
  expenseIncreaseAmount,
  wacmrRatio,
  avgProductPrice,
  operatingDays = 30,
}) {
  const currentBurden = num(currentMonthlyBurden);
  const inc = num(expenseIncreaseAmount);
  const w = num(wacmrRatio);
  const avgPrice = num(avgProductPrice);
  const days = Math.max(1, Math.round(num(operatingDays)) || 30);

  const newMonthlyBurden = currentBurden + inc;

  if (w <= 0) {
    return {
      newMonthlyBurden,
      newMonthlyRevenueTarget: 0,
      monthlyRevenueDelta: 0,
      newDailyRevenueTarget: 0,
      dailyRevenueDelta: 0,
      extraDailyUnits: 0,
    };
  }

  const currentMonthlyRev = Math.ceil(currentBurden / w);
  const newMonthlyRev = Math.ceil(newMonthlyBurden / w);
  const monthlyRevenueDelta = newMonthlyRev - currentMonthlyRev;

  const currentDailyRev = Math.ceil(currentMonthlyRev / days);
  const newDailyRev = Math.ceil(newMonthlyRev / days);
  const dailyRevenueDelta = newDailyRev - currentDailyRev;

  const extraDailyUnits = avgPrice > 0 ? Math.ceil(dailyRevenueDelta / avgPrice) : 0;

  return {
    newMonthlyBurden,
    newMonthlyRevenueTarget: newMonthlyRev,
    monthlyRevenueDelta,
    newDailyRevenueTarget: newDailyRev,
    dailyRevenueDelta,
    extraDailyUnits,
  };
}

/* ------------------------------------------------------------------ */
/* 8. Daily totals (used by the logger modal)                          */
/* ------------------------------------------------------------------ */

export function dailyTotals(items = []) {
  let totalRevenue = 0;
  let totalCogs = 0;
  for (const it of items) {
    totalRevenue += num(it.qty) * num(it.price);
    totalCogs += num(it.qty) * num(it.cogs);
  }
  return { totalRevenue, totalCogs, grossProfit: totalRevenue - totalCogs };
}

/* ------------------------------------------------------------------ */
/* 9. Pure helpers: formatting & dates                                 */
/* ------------------------------------------------------------------ */

const rpFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

export function formatRp(n) {
  const v = Math.round(num(n));
  return (v < 0 ? "-Rp " : "Rp ") + rpFmt.format(Math.abs(v));
}

export function formatNumber(n) {
  return rpFmt.format(Math.round(num(n)));
}

/** Short axis label: 1.500.000 → "1,5jt", 25.000 → "25rb". */
export function formatCompact(n) {
  const v = Math.abs(num(n));
  const trim = (x) => String(+x.toFixed(1)).replace(".", ",");
  if (v >= 1e9) return trim(v / 1e9) + "M";
  if (v >= 1e6) return trim(v / 1e6) + "jt";
  if (v >= 1e3) return trim(v / 1e3) + "rb";
  return String(Math.round(v));
}

export const pad2 = (n) => String(n).padStart(2, "0");

/** Local-time YYYY-MM-DD. */
export function toYmd(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** YYYY-MM for a year + 0-based month. */
export function toYm(year, monthIndex0) {
  return `${year}-${pad2(monthIndex0 + 1)}`;
}

export const MONTHS_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
