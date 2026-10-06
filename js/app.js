/**
 * Bisnisku — app.js
 * State manager, Canvas chart renderer, month navigator, daily logger, event wiring.
 */
import {
  num,
  clamp,
  breakEven,
  runRate,
  calculateProfitAllocation,
  calculateNetWithIncidentals,
  simulateExpenseIncrease,
  marginPct,
  suggestPrice,
  weightedAvgPrice,
  DAYS_FOR_TARGET,
  toMonthly,
  capitalMonthlyBurden,
  calculateAdditionMonthlyBurden,
  dailyTotals,
  daysInMonth,
  formatRp,
  formatNumber,
  formatCompact,
  toYmd,
  toYm,
  MONTHS_ID,
  escapeHtml as esc,
} from "./calculator.js";
import { isConfigPlaceholder } from "./firebase-config.js";
import {
  getDeviceId,
  subscribeBusinesses,
  subscribeProducts,
  subscribeDailySales,
  subscribeMonthlySales,
  subscribeMonthlyExpenses,
  addIncidentalExpense,
  deleteIncidentalExpense,
  addProduct,
  deleteProduct,
  updateCapitalAddition,
  getDailySale,
  saveDailySale,
  deleteDailySale,
  applyCostIncrease,
  addCostToBusiness,
  removeCostFromBusiness,
  deleteBusiness,
  updateMonthlyBurden,
  updateProductPrice,
  updateProduct,
  updateCostItem,
  updateCapitalDetails,
  addCapitalAddition,
  removeCapitalAddition,
} from "./db.js";
import { createWizard } from "./wizard.js";
import { exportMonthCsv, exportExpensesCsv } from "./export.js";

/* ================================================================== */
/* State                                                               */
/* ================================================================== */

const LAST_BIZ_KEY = "bisnisku_current_business";
const OLD_LAST_BIZ_KEY = "bizmetric_current_business";
const now = new Date();

const state = {
  deviceId: getDeviceId(),
  businesses: [],
  currentId: null,
  pendingSelect: null,
  products: [],
  sales: [],
  expenses: [],
  period: { year: now.getFullYear(), month: now.getMonth() }, // month: 0-based
  hoverDay: null,
  unsubProducts: null,
  unsubSales: null,
  unsubExpenses: null,
  salesToken: 0,
  expensesToken: 0,
};

const $ = (id) => document.getElementById(id);
const els = {
  splash: $("splash"),
  topbar: $("topbar"),
  dash: $("dashboard-view"),
  fab: $("fab-log"),
  bizSelect: $("biz-select"),
  btnAddBiz: $("btn-add-biz"),
  btnDeleteBiz: $("btn-delete-biz"),
  netPill: $("net-pill"),
  banner: $("config-banner"),
  prevMonth: $("prev-month"),
  nextMonth: $("next-month"),
  monthLabel: $("month-label"),
  monthInput: $("month-input"),
  chart: $("sales-chart"),
  chartWrap: $("chart-wrap"),
  chartTip: $("chart-tip"),
  kpiRevenue: $("kpi-revenue"),
  kpiMeter: $("kpi-meter"),
  kpiRevenueSub: $("kpi-revenue-sub"),
  kpiAvg: $("kpi-avg"),
  kpiAvgSub: $("kpi-avg-sub"),
  kpiNet: $("kpi-net"),
  kpiNetSub: $("kpi-net-sub"),
  kpiNetBreakdown: $("kpi-net-breakdown"),
  bepStats: $("bep-stats"),
  bepBody: document.querySelector("#bep-table tbody"),
  records: $("records"),
  recordsEmpty: $("records-empty"),
  toasts: $("toasts"),
  // Quick Actions & Incidental Expenses
  btnOpenDailySales: $("btn-open-daily-sales"),
  btnOpenExpenseModal: $("btn-open-expense-modal"),
  expenseModal: $("incidental-expense-modal"),
  btnCloseExpenseModal: $("btn-close-expense-modal"),
  formExpense: $("form-incidental-expense"),
  expDate: $("exp-date"),
  expTitle: $("exp-title"),
  expAmount: $("exp-amount"),
  expNotes: $("exp-notes"),
  btnSaveExpense: $("btn-save-expense"),
  expenseRecords: $("expense-records"),
  expensesEmpty: $("expenses-empty"),
  btnExportExpenses: $("btn-export-expenses"),
  btnExportMonth: $("btn-export-month"),
  btnAddExpSec: $("btn-add-exp-sec"),
  // FAB Speed Dial
  fabContainer: $("fab-container"),
  fabMain: $("fab-main"),
  fabMenu: $("fab-menu"),
  fabOptSale: $("fab-opt-sale"),
  fabOptExpense: $("fab-opt-expense"),
  // profit allocation
  profitCard: $("profit-allocation-card"),
  bepReachedDate: $("bep-reached-date"),
  surplusNetAmount: $("surplus-net-amount"),
  allocEmergencyVal: $("alloc-emergency-val"),
  allocReinvestVal: $("alloc-reinvest-val"),
  allocDividendVal: $("alloc-dividend-val"),
  allocInvestorCard: $("alloc-investor-card"),
  allocInvestorTitle: $("alloc-investor-title"),
  allocInvestorVal: $("alloc-investor-val"),
  allocInvestorDesc: $("alloc-investor-desc"),
  capexPaybackBanner: $("capex-payback-banner"),
  remainingCapexVal: $("remaining-capex-val"),
  // burden & capital management
  btnViewBurden: $("btn-view-burden"),
  btnAddBurden: $("btn-add-burden"),
  btnAddCapital: $("btn-add-capital"),
  btnAddProduct: $("btn-add-product"),
  btnListModal: $("btn-list-modal"),
  // List Capital Modal (CRUD List Modal)
  listCapitalModal: $("list-capital-modal"),
  btnCloseListCapital: $("btn-close-list-capital"),
  btnLcmClose: $("btn-lcm-close"),
  btnLcmEditInitial: $("btn-lcm-edit-initial"),
  btnLcmAddCapital: $("btn-lcm-add-capital"),
  lcmTotalCapital: $("lcm-total-capital"),
  lcmUnrecoveredCapital: $("lcm-unrecovered-capital"),
  lcmMonthlyBurden: $("lcm-monthly-burden"),
  lcmInitialCapitalCard: $("lcm-initial-capital-card"),
  lcmAdditionsList: $("lcm-additions-list"),
  lcmAdditionsEmpty: $("lcm-additions-empty"),
  // Edit Capital Addition Modal
  editCapitalAdditionModal: $("edit-capital-addition-modal"),
  btnCloseEditCapAdd: $("btn-close-edit-cap-add"),
  btnCancelEditCapAdd: $("btn-cancel-edit-cap-add"),
  formEditCapitalAddition: $("form-edit-capital-addition"),
  ecaName: $("eca-name"),
  ecaAmount: $("eca-amount"),
  ecaTypeBadge: $("eca-type-badge"),
  ecaInvestFields: $("eca-invest-fields"),
  ecaDynamicBox: $("eca-dynamic-box"),
  ecaFixedBox: $("eca-fixed-box"),
  ecaDynamicPct: $("eca-dynamic-pct"),
  ecaFixedPct: $("eca-fixed-pct"),
  ecaTenor: $("eca-tenor"),
  ecaOwnFields: $("eca-own-fields"),
  ecaPayback: $("eca-payback"),
  ecaLoanFields: $("eca-loan-fields"),
  ecaLoanTenor: $("eca-loan-tenor"),
  ecaLoanInterest: $("eca-loan-interest"),
  btnSaveEditCapAdd: $("btn-save-edit-cap-add"),
  burdenViewModal: $("burden-view-modal"),
  btnCloseBurdenView: $("btn-close-burden-view"),
  btnBvClose: $("btn-bv-close"),
  btnBvAddCost: $("btn-bv-add-cost"),
  btnBvAddCapital: $("btn-bv-add-capital"),
  btnBvEditCapital: $("btn-bv-edit-capital"),
  btnBvDeleteBiz: $("btn-bv-delete-biz"),
  bvTotalMonthly: $("bv-total-monthly"),
  bvTotalDaily: $("bv-total-daily"),
  bvOpexTotal: $("bv-opex-total"),
  bvOpexList: $("bv-opex-list"),
  bvCapitalMonthly: $("bv-capital-monthly"),
  bvCapitalCard: $("bv-capital-card"),
  // add capital modal
  addCapitalModal: $("add-capital-modal"),
  btnCloseAddCapital: $("btn-close-add-capital"),
  btnCancelAddCapital: $("btn-cancel-add-capital"),
  btnCapTypeInvest: $("btn-cap-type-invest"),
  btnCapTypeOwn: $("btn-cap-type-own"),
  btnCapTypeLoan: $("btn-cap-type-loan"),
  addCapName: $("add-cap-name"),
  addCapAmount: $("add-cap-amount"),
  addCapInvestFields: $("add-cap-invest-fields"),
  schemeDynamic: $("scheme-dynamic"),
  schemeFixed: $("scheme-fixed"),
  labelSchemeDynamic: $("label-scheme-dynamic"),
  labelSchemeFixed: $("label-scheme-fixed"),
  investDynamicBox: $("invest-dynamic-box"),
  investFixedBox: $("invest-fixed-box"),
  addCapDynamicPct: $("add-cap-dynamic-pct"),
  addCapDynamicTenor: $("add-cap-dynamic-tenor"),
  addCapFixedPct: $("add-cap-fixed-pct"),
  addCapFixedTenor: $("add-cap-fixed-tenor"),
  addCapOwnFields: $("add-cap-own-fields"),
  addCapOwnPayback: $("add-cap-own-payback"),
  addCapLoanFields: $("add-cap-loan-fields"),
  addCapLoanTenor: $("add-cap-loan-tenor"),
  addCapLoanInterest: $("add-cap-loan-interest"),
  addCapPreview: $("add-cap-preview"),
  acPreviewAmount: $("ac-preview-amount"),
  acPreviewScheme: $("ac-preview-scheme"),
  acPreviewMonthly: $("ac-preview-monthly"),
  acPreviewDaily: $("ac-preview-daily"),
  acPreviewTotal: $("ac-preview-total"),
  btnSaveAddCapital: $("btn-save-add-capital"),
  addBurdenModal: $("add-burden-modal"),
  btnCloseAddBurden: $("btn-close-add-burden"),
  addBurdenName: $("add-burden-name"),
  addBurdenAmount: $("add-burden-amount"),
  addBurdenFreq: $("add-burden-freq"),
  addBurdenPreview: $("add-burden-preview"),
  abPreviewMonthly: $("ab-preview-monthly"),
  abPreviewDaily: $("ab-preview-daily"),
  abPreviewTotal: $("ab-preview-total"),
  btnSaveNewBurden: $("btn-save-new-burden"),
  // edit single cost item
  editCostModal: $("edit-cost-modal"),
  btnCloseEditCost: $("btn-close-edit-cost"),
  btnCancelEditCost: $("btn-cancel-edit-cost"),
  editCostName: $("edit-cost-name"),
  editCostAmount: $("edit-cost-amount"),
  editCostFreq: $("edit-cost-freq"),
  editCostPreview: $("edit-cost-preview"),
  ecPreviewItemMonthly: $("ec-preview-item-monthly"),
  ecPreviewDelta: $("ec-preview-delta"),
  ecPreviewTotalMonthly: $("ec-preview-total-monthly"),
  ecPreviewNewDaily: $("ec-preview-new-daily"),
  btnSaveEditCost: $("btn-save-edit-cost"),
  // edit capital burden
  editCapitalModal: $("edit-capital-modal"),
  btnCloseEditCapital: $("btn-close-edit-capital"),
  btnCancelEditCapital: $("btn-cancel-edit-capital"),
  editCapDesc: $("edit-cap-desc"),
  editCapLoanFields: $("edit-cap-loan-fields"),
  editCapLoanCapital: $("edit-cap-loan-capital"),
  editCapLoanTenor: $("edit-cap-loan-tenor"),
  editCapLoanInterest: $("edit-cap-loan-interest"),
  editCapOwnFields: $("edit-cap-own-fields"),
  editCapOwnCapital: $("edit-cap-own-capital"),
  editCapOwnPayback: $("edit-cap-own-payback"),
  ecapPreviewMonthly: $("ecap-preview-monthly"),
  ecapPreviewTotal: $("ecap-preview-total"),
  btnSaveEditCapital: $("btn-save-edit-capital"),
  // edit product (name, cogs, margin, price, portion)
  editProductModal: $("edit-product-modal"),
  btnCloseEditProduct: $("btn-close-edit-product"),
  btnCancelEditProduct: $("btn-cancel-edit-product"),
  epModalTitle: $("ep-modal-title"),
  epModalDesc: $("ep-modal-desc"),
  epCurrentBanner: $("ep-current-banner"),
  epCurrentCogs: $("ep-current-cogs"),
  epCurrentPrice: $("ep-current-price"),
  epCurrentShare: $("ep-current-share"),
  epCurrentMargin: $("ep-current-margin"),
  editProductName: $("edit-product-name"),
  editProductCogs: $("edit-product-cogs"),
  editProductMarginRange: $("edit-product-margin-range"),
  editProductMarginVal: $("edit-product-margin-val"),
  btnApplySuggestedPrice: $("btn-apply-suggested-price"),
  editProductNewPrice: $("edit-product-new-price"),
  epPriceHint: $("ep-price-hint"),
  editProductNewShare: $("edit-product-new-share"),
  editProductPreview: $("edit-product-preview"),
  epNewMargin: $("ep-new-margin"),
  epProfitPerUnit: $("ep-profit-per-unit"),
  epPriceDelta: $("ep-price-delta"),
  epCogsDelta: $("ep-cogs-delta"),
  epShareDelta: $("ep-share-delta"),
  epTotalSharePreview: $("ep-total-share-preview"),
  epMarginWarning: $("ep-margin-warning"),
  btnSaveProductPrice: $("btn-save-product-price"),
  // delete business
  deleteBizModal: $("delete-biz-modal"),
  btnCloseDeleteBiz: $("btn-close-delete-biz"),
  btnCancelDeleteBiz: $("btn-cancel-delete-biz"),
  delBizName: $("del-biz-name"),
  delBizMatchName: $("del-biz-match-name"),
  delBizConfirmInput: $("del-biz-confirm-input"),
  btnConfirmDeleteBiz: $("btn-confirm-delete-biz"),
  // logger
  modal: $("logger-modal"),
  lgDate: $("logger-date"),
  lgProducts: $("logger-products"),
  lgRevenue: $("lg-revenue"),
  lgCogs: $("lg-cogs"),
  lgGross: $("lg-gross"),
  lgBep: $("logger-bep"),
  lgBepText: $("lg-bep-text"),
  lgBepPct: $("lg-bep-pct"),
  lgBepMeter: $("lg-bep-meter"),
  lgNotes: $("logger-notes"),
  lgSave: $("lg-save"),
  lgDelete: $("lg-delete"),
};

const wizard = createWizard({
  onComplete: handleWizardComplete,
  onCancel: handleWizardCancel,
  onSaveError: () =>
    toast("Data tersimpan di perangkat, tetapi belum bisa dikirim ke cloud.", "warn"),
});

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

function toast(message, type = "info", ms = 3200) {
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.textContent = message;
  els.toasts.appendChild(el);
  requestAnimationFrame(() => el.classList.add("is-in"));
  setTimeout(() => {
    el.classList.remove("is-in");
    setTimeout(() => el.remove(), 300);
  }, ms);
}

const currentBiz = () => state.businesses.find((b) => b.id === state.currentId) || null;

function getMonthlyIncidentals() {
  let totalIncidentalOpex = 0;
  let totalIncidentalCapex = 0;
  for (const exp of state.expenses || []) {
    const amt = num(exp.amount);
    if (exp.expenseType === "capex") {
      totalIncidentalCapex += amt;
    } else {
      totalIncidentalOpex += amt;
    }
  }
  return { totalIncidentalOpex, totalIncidentalCapex };
}

function derive() {
  const biz = currentBiz();
  if (!biz) return null;
  const { year, month } = state.period;
  const burden = num(biz.monthlyFixedBurden);
  const be = breakEven({ burden, products: state.products });
  const days = daysInMonth(year, month);
  const rr = runRate({
    sales: state.sales,
    burden,
    days,
    unrecoveredCapital: biz.unrecoveredCapital,
    dailyTarget: be.dailyTarget,
  });

  const now = new Date();
  const isCurrentMonth = (year === now.getFullYear() && month === now.getMonth());
  const isPastMonth = (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth()));

  let daysElapsed = days;
  if (isPastMonth) {
    daysElapsed = days;
  } else if (rr.recorded > 0) {
    daysElapsed = Math.min(rr.recorded, days);
  } else if (isCurrentMonth) {
    daysElapsed = Math.min(now.getDate(), days);
  }

  const { totalIncidentalOpex, totalIncidentalCapex } = getMonthlyIncidentals();
  const incCalc = calculateNetWithIncidentals({
    realizedGrossProfit: rr.totalGross,
    monthlyFixedBurden: burden,
    totalIncidentalOpex,
    unrecoveredCapital: biz.unrecoveredCapital,
    totalIncidentalCapex,
    daysInMonth: days,
    daysElapsed,
  });

  return { biz, burden, be, days, daysElapsed, rr, totalIncidentalOpex, totalIncidentalCapex, incCalc };
}

function periodRange() {
  const { year, month } = state.period;
  const ym = toYm(year, month);
  return { start: `${ym}-01`, end: `${ym}-${String(daysInMonth(year, month)).padStart(2, "0")}` };
}

function formatPayback(months) {
  if (months === null) return null;
  if (months < 1) return "< 1 bulan";
  if (months > 120) return "> 10 tahun";
  return `${months.toFixed(1).replace(".", ",")} bulan`;
}

function prettyDate(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatDdMmYyyy(ymd) {
  if (!ymd) return "-";
  const parts = String(ymd).split("-");
  if (parts.length === 3) {
    const [y, m, d] = parts;
    return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`;
  }
  return ymd;
}

function setChrome(showDashboard) {
  els.topbar.hidden = !showDashboard;
  els.dash.hidden = !showDashboard;
  if (els.fab) els.fab.hidden = !showDashboard;
  if (els.fabContainer) els.fabContainer.hidden = !showDashboard;
}

function hideSplash() {
  if (els.splash.classList.contains("is-hidden")) return;
  els.splash.classList.add("is-hidden");
  setTimeout(() => (els.splash.hidden = true), 400);
}

/* ================================================================== */
/* Businesses & subscriptions                                          */
/* ================================================================== */

function openWizard(canCancel) {
  setChrome(false);
  wizard.open({ canCancel });
}

function handleBusinessesChanged(list) {
  state.businesses = list;
  hideSplash();

  if (list.length === 0) {
    state.currentId = null;
    clearSubs();
    if (!wizard.isOpen() && !state.pendingSelect) openWizard(false);
    return;
  }

  if (state.pendingSelect && list.some((b) => b.id === state.pendingSelect)) {
    const id = state.pendingSelect;
    state.pendingSelect = null;
    if (wizard.isOpen()) wizard.close();
    setChrome(true);
    selectBusiness(id);
    return;
  }

  if (wizard.isOpen()) {
    renderHeader();
    return;
  }

  setChrome(true);
  if (!state.currentId || !list.some((b) => b.id === state.currentId)) {
    let saved = null;
    try {
      saved = localStorage.getItem(LAST_BIZ_KEY) || localStorage.getItem(OLD_LAST_BIZ_KEY);
    } catch (_) {}
    selectBusiness(list.some((b) => b.id === saved) ? saved : list[0].id);
  } else {
    renderAll();
  }
}

function clearSubs() {
  state.unsubProducts?.();
  state.unsubSales?.();
  state.unsubExpenses?.();
  state.unsubProducts = state.unsubSales = state.unsubExpenses = null;
  state.products = [];
  state.sales = [];
  state.expenses = [];
}

function selectBusiness(id) {
  if (state.currentId === id) return;
  state.currentId = id;
  try {
    localStorage.setItem(LAST_BIZ_KEY, id);
  } catch (_) {}

  state.unsubProducts?.();
  state.products = [];
  state.unsubProducts = subscribeProducts(
    id,
    (list) => {
      state.products = list;
      renderAll();
    },
    () => toast("Gagal membaca produk.", "error")
  );
  loadDataForActivePeriod();
  renderAll();
}

function subscribeSalesForPeriod() {
  state.unsubSales?.();
  state.sales = [];
  if (!state.currentId) return;
  const token = ++state.salesToken;
  const { start, end } = periodRange();
  state.unsubSales = subscribeDailySales(
    state.currentId,
    start,
    end,
    (list) => {
      if (token !== state.salesToken) return;
      state.sales = list;
      renderAll();
    },
    () => toast("Gagal membaca catatan penjualan.", "error")
  );
}

function subscribeExpensesForPeriod() {
  state.unsubExpenses?.();
  state.expenses = [];
  if (!state.currentId) return;
  const token = ++state.expensesToken;
  const { year, month } = state.period;
  state.unsubExpenses = subscribeMonthlyExpenses(
    state.currentId,
    year,
    month + 1,
    (list) => {
      if (token !== state.expensesToken) return;
      state.expenses = list;
      renderAll();
    },
    () => toast("Gagal membaca catatan pengeluaran.", "error")
  );
}

function loadDataForActivePeriod() {
  subscribeSalesForPeriod();
  subscribeExpensesForPeriod();
}

function handleWizardComplete(id) {
  state.pendingSelect = id;
  const exists = state.businesses.some((b) => b.id === id);
  if (exists) handleBusinessesChanged(state.businesses);
  toast("Usaha berhasil dibuat 🎉", "success");
}

function handleWizardCancel() {
  setChrome(true);
  renderAll();
}

/* ================================================================== */
/* Rendering                                                           */
/* ================================================================== */

function renderAll() {
  renderHeader();
  renderPeriod();
  renderKpis();
  renderProfitAllocation();
  renderBep();
  renderRecords();
  renderExpenses();
  drawChart();
}

function renderHeader() {
  els.bizSelect.innerHTML = state.businesses
    .map(
      (b) =>
        `<option value="${esc(b.id)}" ${b.id === state.currentId ? "selected" : ""}>${esc(b.name)}</option>`
    )
    .join("");
  els.banner.hidden = !isConfigPlaceholder;
  if (els.btnDeleteBiz) els.btnDeleteBiz.hidden = state.businesses.length === 0;
}

function renderPeriod() {
  const { year, month } = state.period;
  els.monthLabel.textContent = `${MONTHS_ID[month]} ${year}`;
  els.monthInput.value = toYm(year, month);
}

function renderKpis() {
  const d = derive();
  if (!d) return;
  const { rr, burden, biz, totalIncidentalOpex, totalIncidentalCapex, incCalc, days } = d;

  els.kpiRevenue.textContent = formatRp(rr.totalRevenue);
  const cov = incCalc.proratedOperatingBurden > 0
    ? (rr.totalGross / incCalc.proratedOperatingBurden) * 100
    : (burden > 0 ? (rr.totalGross / burden) * 100 : 0);
  els.kpiMeter.style.width = clamp(cov, 0, 100) + "%";
  els.kpiMeter.className = cov >= 100 ? "is-ok" : "";
  els.kpiRevenueSub.textContent = `${cov.toFixed(0)}% beban berjalan tertutup (laba kotor ${formatRp(rr.totalGross)} dari beban prorata ${formatRp(incCalc.proratedOperatingBurden)})`;

  els.kpiAvg.textContent = formatRp(rr.avgDailyRevenue);
  els.kpiAvgSub.textContent = `${rr.recorded} hari tercatat · ${rr.daysReachedBep} hari capai BEP`;

  if (rr.recorded === 0 && totalIncidentalOpex === 0 && totalIncidentalCapex === 0) {
    els.kpiNet.textContent = "–";
    els.kpiNet.className = "kpi__value";
    els.kpiNetSub.textContent = "Catat penjualan atau pengeluaran untuk melihat laba";
    if (els.kpiNetBreakdown) els.kpiNetBreakdown.innerHTML = "";
  } else {
    // Laba Bersih Riil Berjalan dengan Beban Rutin Prorata (proporsional hari berjalan):
    const currentNet = incCalc.operatingNetProfit;

    // Proyeksi Laba Bersih Akhir Bulan penuh:
    const projectedNet = rr.recorded > 0
      ? Math.round(rr.avgDailyGross * days - incCalc.totalOperatingBurden)
      : currentNet;

    els.kpiNet.textContent = formatRp(currentNet);
    els.kpiNet.className = "kpi__value " + (currentNet >= 0 ? "is-pos" : "is-neg");

    const effectivePayback = (currentNet > 0 && incCalc.adjustedUnrecoveredCapital > 0)
      ? (incCalc.adjustedUnrecoveredCapital / (currentNet * (days / incCalc.daysElapsed)))
      : incCalc.projectedMonthsToPayback;
    const pb = formatPayback(effectivePayback);

    els.kpiNetSub.textContent = projectedNet !== null
      ? `Proyeksi akhir bulan: ${formatRp(projectedNet)}${pb ? ` · Balik modal ${pb}` : ""}`
      : (pb ? `Estimasi balik modal ${pb}` : "Belum cukup data proyeksi");

    if (els.kpiNetBreakdown) {
      els.kpiNetBreakdown.innerHTML = `
        <span>Laba Kotor (${incCalc.daysElapsed} hr): <strong>${formatRp(rr.totalGross)}</strong></span> · 
        <span>Beban Prorata (${incCalc.daysElapsed} hr): <strong>${formatRp(incCalc.proratedBurden)}</strong></span>
        ${totalIncidentalOpex > 0 ? ` · <span style="color: #fca5a5;">Opex: <strong>${formatRp(totalIncidentalOpex)}</strong></span>` : ""}
        ${totalIncidentalCapex > 0 ? ` · <span style="color: #93c5fd;">Capex: <strong>${formatRp(totalIncidentalCapex)}</strong></span>` : ""}
        <br>
        <span style="color: ${currentNet >= 0 ? '#34d399' : '#f87171'};">
          Laba Bersih Berjalan: <strong>${formatRp(currentNet)}</strong>
        </span>
        ${totalIncidentalCapex > 0 ? ` · <span style="color: ${incCalc.netCashRemaining >= 0 ? '#38bdf8' : '#f87171'};">Sisa Kas Riil: <strong>${formatRp(incCalc.netCashRemaining)}</strong></span>` : ""}
      `;
    }
  }
}

function renderProfitAllocation() {
  if (!els.profitCard) return;
  const d = derive();
  if (!d || !d.biz) {
    els.profitCard.style.display = "none";
    return;
  }

  const { biz, burden, totalIncidentalOpex, totalIncidentalCapex, incCalc } = d;
  // Chronological sort: earliest date to latest date
  const sorted = [...state.sales].sort((a, b) => a.date.localeCompare(a.date));
  let cumulativeGross = 0;
  let bepReachedDate = null;
  // Kewajiban kas total (Beban Rutin + Opex + Capex) yang harus tertutup agar ada surplus kas riil
  const totalOutflowToCover = burden + (totalIncidentalOpex || 0) + (totalIncidentalCapex || 0);

  for (const s of sorted) {
    cumulativeGross += num(s.grossProfit);
    if (!bepReachedDate && (totalOutflowToCover > 0 ? cumulativeGross >= totalOutflowToCover : cumulativeGross > 0)) {
      bepReachedDate = s.date;
    }
  }

  const additions = biz.capitalAdditions || [];
  const dynamicInvestors = additions.filter(
    (a) => a.type === "invest" && a.returnType === "dynamic" && num(a.dynamicProfitPct) > 0
  );
  const totalDynamicInvestorPct = dynamicInvestors.reduce((s, a) => s + num(a.dynamicProfitPct), 0);

  const allocation = calculateProfitAllocation(
    cumulativeGross,
    burden + (totalIncidentalOpex || 0),
    incCalc?.adjustedUnrecoveredCapital ?? biz.unrecoveredCapital,
    undefined,
    totalDynamicInvestorPct,
    totalIncidentalCapex || 0
  );

  if (!allocation.isSurplus) {
    els.profitCard.style.display = "none";
    return;
  }

  els.profitCard.style.display = "block";
  els.bepReachedDate.textContent = formatDdMmYyyy(bepReachedDate);
  els.surplusNetAmount.textContent = formatRp(allocation.netSurplus);
  els.allocEmergencyVal.textContent = formatRp(allocation.emergencyFund);
  els.allocReinvestVal.textContent = formatRp(allocation.reinvestment);
  els.allocDividendVal.textContent = formatRp(allocation.dividend);

  if (els.allocInvestorCard) {
    if (allocation.investorPayout > 0) {
      els.allocInvestorCard.style.display = "flex";
      if (els.allocInvestorTitle) {
        els.allocInvestorTitle.textContent = `🤝 Bagi Hasil Investor (${totalDynamicInvestorPct}%)`;
      }
      if (els.allocInvestorVal) {
        els.allocInvestorVal.textContent = formatRp(allocation.investorPayout);
      }
      if (els.allocInvestorDesc) {
        const names = dynamicInvestors.map((a) => `${a.name} (${a.dynamicProfitPct}%)`).join(", ");
        els.allocInvestorDesc.textContent = `Kewajiban bagi hasil keuntungan: ${names}.`;
      }
    } else {
      els.allocInvestorCard.style.display = "none";
    }
  }

  if (num(allocation.unrecoveredCapital) > 0) {
    els.capexPaybackBanner.style.display = "block";
    els.remainingCapexVal.textContent = formatRp(num(allocation.unrecoveredCapital));
  } else {
    els.capexPaybackBanner.style.display = "none";
  }
}

function renderBep() {
  const d = derive();
  if (!d) return;
  const { be, burden } = d;
  const stat = (label, value) => `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`;
  els.bepStats.innerHTML =
    stat("Beban bulanan", formatRp(burden)) +
    stat("Margin tertimbang", `${(be.wacmr * 100).toFixed(1)}%`) +
    stat("Target BEP bulanan", be.valid ? formatRp(be.monthlyTarget) : "–") +
    stat("Target BEP harian", be.valid ? formatRp(be.dailyTarget) : "–");

  els.bepBody.innerHTML = be.perProduct.length
    ? be.perProduct
        .map((p) => {
          const pId = p.id || p.productId || "";
          return `<tr>
            <td data-label="Produk">${esc(p.name)}</td>
            <td class="num" data-label="Harga">${formatRp(p.price)}</td>
            <td class="num" data-label="Porsi">${+p.salesSharePct.toFixed(1)}%</td>
            <td class="num" data-label="Target/hari"><strong>${formatNumber(p.targetQty)}</strong> unit</td>
            <td class="num" data-label="Aksi" style="white-space: nowrap;">
              <button type="button" class="btn-edit-price" data-id="${esc(pId)}" data-name="${esc(p.name)}" title="Ubah produk ${esc(p.name)}" aria-label="Ubah produk ${esc(p.name)}">✏️</button>
              <button type="button" class="btn-delete-product" data-id="${esc(pId)}" data-name="${esc(p.name)}" title="Hapus produk ${esc(p.name)}" aria-label="Hapus produk ${esc(p.name)}" style="background: none; border: none; cursor: pointer; font-size: 0.95rem; padding: 2px 4px; border-radius: 4px; margin-left: 4px;">🗑️</button>
            </td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="5" class="muted">Memuat produk…</td></tr>`;
}

function renderRecords() {
  const d = derive();
  if (!d) return;
  const sorted = [...state.sales].sort((a, b) => b.date.localeCompare(a.date));
  els.recordsEmpty.hidden = sorted.length > 0;
  els.records.innerHTML = sorted
    .map((s) => {
      const reached = d.be.valid && num(s.totalRevenue) >= d.be.dailyTarget;
      return `<li>
        <button type="button" class="record" data-date="${esc(s.date)}">
          <span class="record__date">${prettyDate(s.date)}</span>
          <span class="record__rev">${formatRp(s.totalRevenue)}</span>
          <span class="record__gp">Laba kotor ${formatRp(s.grossProfit)}</span>
          <span class="badge ${reached ? "badge--ok" : "badge--low"}">${reached ? "BEP ✓" : "Di bawah BEP"}</span>
        </button>
      </li>`;
    })
    .join("");
}

function renderExpenses() {
  if (!els.expenseRecords) return;
  const sorted = [...state.expenses].sort((a, b) => b.date.localeCompare(a.date));
  if (els.expensesEmpty) els.expensesEmpty.hidden = sorted.length > 0;
  els.expenseRecords.innerHTML = sorted
    .map((exp) => {
      const isCapex = exp.expenseType === "capex";
      return `<li>
        <div class="record record--expense" data-id="${esc(exp.id)}">
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="record__date">${prettyDate(exp.date)}</span>
              <span class="badge ${isCapex ? "badge--low" : "badge--warning"}" style="grid-column: unset; grid-row: unset; justify-self: unset;">
                ${isCapex ? "Capex (Aset)" : "Opex"}
              </span>
            </div>
            <strong style="color: #f1f5f9; font-size: 0.95rem;">${esc(exp.title)}</strong>
            ${exp.notes ? `<small style="color: #94a3b8; font-size: 0.8rem;">${esc(exp.notes)}</small>` : ""}
          </div>
          <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 6px;">
            <span class="record__rev" style="color: #fca5a5;">-${formatRp(exp.amount)}</span>
            <button type="button" class="btn-delete-expense" data-id="${esc(exp.id)}" title="Hapus pengeluaran ini" style="background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 0.85rem; padding: 2px 6px; border-radius: 4px;">
              🗑️ Hapus
            </button>
          </div>
        </div>
      </li>`;
    })
    .join("");
}

/* ================================================================== */
/* Canvas chart (zero libraries)                                       */
/* ================================================================== */

const COLORS = {
  green: ["#34d399", "#059669"],
  cyan: ["#22d3ee", "#0e7490"],
  amber: "#f59e0b",
  grid: "rgba(148,163,184,0.14)",
  axis: "#94a3b8",
};

let chartLayout = null;

function niceStep(raw) {
  if (raw <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * pow;
}

function dailyRevenueMap() {
  const map = new Map();
  for (const s of state.sales) map.set(parseInt(s.date.slice(8, 10), 10), s);
  return map;
}

function roundedTopRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

function drawChart() {
  const canvas = els.chart;
  const rect = els.chartWrap.getBoundingClientRect();
  const w = Math.max(240, Math.floor(rect.width));
  const h = Math.max(200, Math.floor(rect.height));
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const d = derive();
  if (!d) return;

  const target = d.be.valid ? d.be.dailyTarget : 0;
  const map = dailyRevenueMap();
  const days = d.days;
  let maxRev = 0;
  map.forEach((s) => (maxRev = Math.max(maxRev, num(s.totalRevenue))));

  const padL = 46, padR = 12, padT = 26, padB = 28;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const step = niceStep((Math.max(target, maxRev, 1) * 1.08) / 4);
  const top = step * 4;
  const y = (v) => padT + plotH * (1 - v / top);
  const baseY = y(0);

  // Grid + Y labels
  ctx.font = "11px system-ui, -apple-system, 'Segoe UI', sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const v = step * i;
    const gy = Math.round(y(v)) + 0.5;
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath();
    ctx.moveTo(padL, gy);
    ctx.lineTo(w - padR, gy);
    ctx.stroke();
    ctx.fillStyle = COLORS.axis;
    ctx.fillText(formatCompact(v), padL - 8, gy);
  }

  // Bars
  const slot = plotW / days;
  const bw = clamp(slot * 0.68, 2, 22);
  const { year, month } = state.period;
  const isThisMonth = year === now.getFullYear() && month === now.getMonth();
  const labelEvery = slot >= 24 ? 1 : slot >= 13 ? 2 : slot >= 9 ? 3 : 5;

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let day = 1; day <= days; day++) {
    const cx = padL + slot * (day - 0.5);
    const x = cx - bw / 2;
    const s = map.get(day);

    if (s && num(s.totalRevenue) > 0) {
      const rev = num(s.totalRevenue);
      const by = y(rev);
      const reached = target > 0 && rev >= target;
      const [c1, c2] = reached ? COLORS.green : COLORS.cyan;
      const g = ctx.createLinearGradient(0, by, 0, baseY);
      g.addColorStop(0, c1);
      g.addColorStop(1, c2);
      ctx.fillStyle = g;
      roundedTopRect(ctx, x, by, bw, baseY - by, 4);
      ctx.fill();
      if (state.hoverDay === day) {
        ctx.strokeStyle = "#f8fafc";
        ctx.lineWidth = 1.5;
        roundedTopRect(ctx, x, by, bw, baseY - by, 4);
        ctx.stroke();
      }
    }

    if ((day - 1) % labelEvery === 0) {
      const isToday = isThisMonth && day === now.getDate();
      ctx.fillStyle = isToday ? "#f8fafc" : COLORS.axis;
      ctx.font = `${isToday ? "700 " : ""}11px system-ui, -apple-system, 'Segoe UI', sans-serif`;
      ctx.fillText(String(day), cx, baseY + 8);
    }
  }

  // BEP dashed line
  if (target > 0) {
    const ty = y(target);
    ctx.save();
    ctx.setLineDash([7, 5]);
    ctx.strokeStyle = COLORS.amber;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padL, ty);
    ctx.lineTo(w - padR, ty);
    ctx.stroke();
    ctx.restore();

    ctx.font = "600 11px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    const label = `BEP ${formatCompact(target)}/hari`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(15,23,42,0.85)";
    ctx.fillRect(w - padR - tw - 8, ty - 19, tw + 8, 16);
    ctx.fillStyle = COLORS.amber;
    ctx.fillText(label, w - padR - 4, ty - 5);
  }

  if (map.size === 0) {
    ctx.fillStyle = COLORS.axis;
    ctx.font = "13px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Belum ada penjualan tercatat bulan ini", padL + plotW / 2, padT + plotH / 2);
  }

  chartLayout = { padL, padR, padT, slot, days, y, w, h, map, target };
}

function dayFromPointer(e) {
  if (!chartLayout) return null;
  const rect = els.chart.getBoundingClientRect();
  const x = e.clientX - rect.left - chartLayout.padL;
  const day = Math.floor(x / chartLayout.slot) + 1;
  return day >= 1 && day <= chartLayout.days ? day : null;
}

function showTip(day) {
  const L = chartLayout;
  const s = L?.map.get(day);
  if (!s) return hideTip();
  const rev = num(s.totalRevenue);
  const reached = L.target > 0 && rev >= L.target;
  els.chartTip.innerHTML = `
    <strong>${prettyDate(s.date)}</strong>
    <span>Pendapatan ${formatRp(rev)}</span>
    <span>Laba kotor ${formatRp(s.grossProfit)}</span>
    <span class="${reached ? "tip-ok" : "tip-low"}">${
      L.target > 0 ? (reached ? "BEP tercapai ✓" : `Kurang ${formatRp(L.target - rev)} dari BEP`) : ""
    }</span>`;
  const cx = L.padL + L.slot * (day - 0.5);
  els.chartTip.style.left = clamp(cx, 80, L.w - 80) + "px";
  els.chartTip.style.top = Math.max(2, L.y(rev) - 84) + "px";
  els.chartTip.hidden = false;
  if (state.hoverDay !== day) {
    state.hoverDay = day;
    drawChart();
  }
}

function hideTip() {
  els.chartTip.hidden = true;
  if (state.hoverDay !== null) {
    state.hoverDay = null;
    drawChart();
  }
}

els.chart.addEventListener("pointermove", (e) => {
  const day = dayFromPointer(e);
  day ? showTip(day) : hideTip();
});
els.chart.addEventListener("pointerdown", (e) => {
  const day = dayFromPointer(e);
  day && state.hoverDay !== day ? showTip(day) : hideTip();
});
els.chart.addEventListener("pointerleave", (e) => {
  if (e.pointerType === "mouse") hideTip();
});

if ("ResizeObserver" in window) {
  new ResizeObserver(() => {
    if (!els.dash.hidden) drawChart();
  }).observe(els.chartWrap);
} else {
  window.addEventListener("resize", drawChart);
}

/* ================================================================== */
/* Month navigator                                                     */
/* ================================================================== */

function changePeriod(year, month) {
  while (month < 0) {
    month += 12;
    year--;
  }
  while (month > 11) {
    month -= 12;
    year++;
  }
  state.period = { year, month };
  state.hoverDay = null;
  els.chartTip.hidden = true;
  loadDataForActivePeriod();
  renderAll();
}

els.prevMonth.addEventListener("click", () => changePeriod(state.period.year, state.period.month - 1));
els.nextMonth.addEventListener("click", () => changePeriod(state.period.year, state.period.month + 1));

els.monthLabel.addEventListener("click", () => {
  try {
    els.monthInput.showPicker();
  } catch (_) {
    els.monthInput.focus();
    els.monthInput.click();
  }
});
els.monthInput.addEventListener("click", () => {
  try {
    els.monthInput.showPicker();
  } catch (_) {}
});
els.monthInput.addEventListener("change", () => {
  const [y, m] = (els.monthInput.value || "").split("-").map(Number);
  if (y && m) changePeriod(y, m - 1);
});

els.bizSelect.addEventListener("change", () => {
  selectBusiness(els.bizSelect.value);
});

els.btnAddBiz.addEventListener("click", () => openWizard(true));

/* ================================================================== */
/* Daily sales logger                                                  */
/* ================================================================== */

const logger = { date: toYmd(), qty: {}, existing: false, token: 0 };

function openLogger(date = toYmd()) {
  if (!currentBiz()) return;
  els.modal.hidden = false;
  document.body.classList.add("is-modal");
  els.lgDate.value = date;
  renderLoggerProducts();
  loadLoggerDate(date);
  setTimeout(() => els.lgSave.focus({ preventScroll: true }), 50);
}

function closeLogger() {
  els.modal.hidden = true;
  document.body.classList.remove("is-modal");
}

async function loadLoggerDate(date) {
  const token = ++logger.token;
  logger.date = date;
  logger.qty = {};
  logger.existing = false;
  els.lgNotes.value = "";
  updateLoggerUi();

  let rec = state.sales.find((s) => s.date === date) || null;
  if (!rec && !(date >= periodRange().start && date <= periodRange().end)) {
    rec = await getDailySale(state.currentId, date);
  }
  if (token !== logger.token) return;
  if (rec) {
    logger.existing = true;
    for (const it of rec.items || []) logger.qty[it.productId] = num(it.qty);
    els.lgNotes.value = rec.notes || "";
  }
  renderLoggerProducts();
  updateLoggerUi();
}

function renderLoggerProducts() {
  const d = derive();
  const perProduct = new Map((d?.be.perProduct || []).map((p) => [p.productId, p]));
  els.lgProducts.innerHTML = state.products
    .map((p) => {
      const t = perProduct.get(p.id);
      return `<div class="lg-item" data-pid="${esc(p.id)}">
        <div class="lg-item__info">
          <strong>${esc(p.name)}</strong>
          <small>${formatRp(p.price)}${t && d.be.valid ? ` · target ≥ ${formatNumber(t.targetQty)}` : ""}</small>
        </div>
        <div class="stepper">
          <button type="button" data-step="-1" aria-label="Kurangi ${esc(p.name)}">−</button>
          <input type="number" inputmode="numeric" min="0" step="1" value="${logger.qty[p.id] || 0}" aria-label="Jumlah ${esc(p.name)}" />
          <button type="button" data-step="1" aria-label="Tambah ${esc(p.name)}">+</button>
        </div>
      </div>`;
    })
    .join("");
}

function loggerItems() {
  return state.products
    .filter((p) => num(logger.qty[p.id]) > 0)
    .map((p) => ({
      productId: p.id,
      name: p.name,
      qty: num(logger.qty[p.id]),
      price: num(p.price),
      cogs: num(p.cogs),
    }));
}

function updateLoggerUi() {
  const totals = dailyTotals(loggerItems());
  els.lgRevenue.textContent = formatRp(totals.totalRevenue);
  els.lgCogs.textContent = formatRp(totals.totalCogs);
  els.lgGross.textContent = formatRp(totals.grossProfit);

  const d = derive();
  const target = d?.be.valid ? d.be.dailyTarget : 0;
  if (target > 0) {
    const reached = totals.totalRevenue >= target;
    const pct = (totals.totalRevenue / target) * 100;
    els.lgBep.className = `bep ${reached ? "bep--ok" : "bep--low"}`;
    els.lgBepText.textContent = reached
      ? `BEP tercapai ✓ (+${formatRp(totals.totalRevenue - target)})`
      : `Target BEP ${formatRp(target)} · kurang ${formatRp(target - totals.totalRevenue)}`;
    els.lgBepPct.textContent = `${Math.round(pct)}%`;
    els.lgBepMeter.style.width = clamp(pct, 0, 100) + "%";
  } else {
    els.lgBep.className = "bep bep--low";
    els.lgBepText.textContent = "Target BEP belum tersedia";
    els.lgBepPct.textContent = "–";
    els.lgBepMeter.style.width = "0%";
  }
  els.lgDelete.hidden = !logger.existing;
}

els.lgProducts.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-step]");
  if (!btn) return;
  const item = btn.closest(".lg-item");
  const input = item.querySelector("input");
  const next = Math.max(0, Math.floor(num(input.value)) + Number(btn.dataset.step));
  input.value = next;
  logger.qty[item.dataset.pid] = next;
  updateLoggerUi();
});

els.lgProducts.addEventListener("input", (e) => {
  if (e.target.tagName !== "INPUT") return;
  const item = e.target.closest(".lg-item");
  logger.qty[item.dataset.pid] = Math.max(0, Math.floor(num(e.target.value)));
  updateLoggerUi();
});

els.lgProducts.addEventListener("focusin", (e) => {
  if (e.target.tagName === "INPUT") e.target.select();
});

els.lgDate.addEventListener("change", () => {
  if (els.lgDate.value) loadLoggerDate(els.lgDate.value);
});

els.lgSave.addEventListener("click", () => {
  const items = loggerItems();
  if (items.length === 0) {
    toast("Isi jumlah terjual minimal satu produk.", "warn");
    return;
  }
  const totals = dailyTotals(items);
  saveDailySale(state.currentId, logger.date, {
    items,
    ...totals,
    notes: els.lgNotes.value.trim(),
  }).catch(() => toast("Tersimpan di perangkat, belum tersinkron ke cloud.", "warn"));
  closeLogger();
  toast(`Penjualan ${prettyDate(logger.date)} tersimpan ✓`, "success");
  // If saved date is outside the visible month, jump there so the user sees it.
  const [y, m] = logger.date.split("-").map(Number);
  if (y !== state.period.year || m - 1 !== state.period.month) changePeriod(y, m - 1);
});

els.lgDelete.addEventListener("click", () => {
  if (!confirm(`Hapus catatan penjualan ${prettyDate(logger.date)}?`)) return;
  deleteDailySale(state.currentId, logger.date).catch(() =>
    toast("Dihapus di perangkat, belum tersinkron ke cloud.", "warn")
  );
  closeLogger();
  toast("Catatan dihapus", "info");
});

els.modal.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) closeLogger();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!els.modal.hidden) closeLogger();
    if (els.editCostModal && els.editCostModal.style.display !== "none") closeEditCostModal();
    if (els.editCapitalModal && els.editCapitalModal.style.display !== "none") closeEditCapitalModal();
    if (els.editProductModal && els.editProductModal.style.display !== "none") closeEditProductModal();
    if (els.burdenViewModal && els.burdenViewModal.style.display !== "none") closeBurdenViewModal();
    if (els.addBurdenModal && els.addBurdenModal.style.display !== "none") closeAddBurdenModal();
    if (els.addCapitalModal && els.addCapitalModal.style.display !== "none") closeAddCapitalModal();
    if (els.deleteBizModal && els.deleteBizModal.style.display !== "none") closeDeleteBizModal();
  }
});

els.fab?.addEventListener("click", () => openLogger(toYmd()));
els.records.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-date]");
  if (btn) openLogger(btn.dataset.date);
});

// Click edit price & portion button in BEP table or delete product
els.bepBody.addEventListener("click", async (e) => {
  const delBtn = e.target.closest(".btn-delete-product");
  if (delBtn) {
    const id = delBtn.dataset.id || delBtn.getAttribute("data-id");
    const name = delBtn.dataset.name || "produk ini";
    if (!id || !state.currentId) return;
    if (state.products.length <= 1) {
      toast("Minimal harus ada 1 produk pada usaha.", "warn");
      return;
    }
    if (!confirm(`Hapus produk "${name}"? Target penjualan akan otomatis disesuaikan.`)) return;
    try {
      await deleteProduct(state.currentId, id);
      toast(`Produk "${name}" berhasil dihapus.`, "success");
    } catch (err) {
      console.error(err);
      toast("Gagal menghapus produk.", "error");
    }
    return;
  }

  const btn = e.target.closest(".btn-edit-price");
  if (btn) {
    const id = btn.dataset.id || btn.getAttribute("data-id") || btn.dataset.name;
    if (id) {
      openEditProductModal(id);
    }
  }
});

/* ================================================================== */
/* Edit Single Cost Item                                               */
/* ================================================================== */

let editingCostId = null;

function openEditCostModal(costId) {
  const biz = currentBiz();
  if (!biz) return;
  const items = biz.opexItems || [];
  const item = items.find((it, idx) => (it.id || `idx-${idx}`) === costId || String(idx) === costId);
  if (!item) return;

  editingCostId = costId;
  els.editCostName.value = item.name || "";
  els.editCostAmount.value = item.amount || "";
  els.editCostFreq.value = item.frequency || "monthly";

  handleEditCostInput();

  els.btnSaveEditCost.disabled = false;
  els.btnSaveEditCost.textContent = "Simpan Perubahan Beban ✓";
  els.editCostModal.style.display = "flex";
  document.body.classList.add("is-modal");
  setTimeout(() => els.editCostAmount.focus(), 80);
}

function closeEditCostModal() {
  els.editCostModal.style.display = "none";
  if (!els.burdenViewModal || els.burdenViewModal.style.display === "none") {
    document.body.classList.remove("is-modal");
  }
}

function handleEditCostInput() {
  const biz = currentBiz();
  if (!biz || !editingCostId) return;
  const items = biz.opexItems || [];
  const item = items.find((it, idx) => (it.id || `idx-${idx}`) === editingCostId || String(idx) === editingCostId);
  if (!item) return;

  const inputVal = els.editCostAmount.value;
  if (inputVal === "" || isNaN(Number(inputVal))) {
    els.editCostPreview.style.display = "none";
    return;
  }

  const newAmount = Math.max(0, num(inputVal));
  const newFreq = els.editCostFreq.value;
  const newItemMonthly = Math.round(toMonthly(newAmount, newFreq));
  const oldItemMonthly = Math.round(toMonthly(item.amount, item.frequency));
  const delta = newItemMonthly - oldItemMonthly;

  const currentTotalBurden = num(biz.monthlyFixedBurden);
  const newTotalBurden = Math.max(0, currentTotalBurden + delta);
  const newDaily = Math.round(newTotalBurden / DAYS_FOR_TARGET);

  const deltaSign = delta > 0 ? "+" : "";
  els.ecPreviewItemMonthly.textContent = `${formatRp(newItemMonthly)} / bln`;
  els.ecPreviewDelta.textContent = `${deltaSign}${formatRp(delta)} / bln`;
  els.ecPreviewDelta.className = delta > 0 ? "text-warning" : delta < 0 ? "text-primary" : "text-muted";
  els.ecPreviewTotalMonthly.textContent = `${formatRp(newTotalBurden)} / bln`;
  els.ecPreviewNewDaily.textContent = `${formatRp(newDaily)} / hari`;
  els.editCostPreview.style.display = "block";
}

async function handleSaveEditCost() {
  const biz = currentBiz();
  if (!biz || !editingCostId) return;

  const name = els.editCostName.value.trim() || "Biaya";
  const inputVal = els.editCostAmount.value;
  if (inputVal === "" || isNaN(Number(inputVal)) || Number(inputVal) < 0) {
    toast("Masukkan nominal biaya yang valid.", "warn");
    return;
  }

  const amount = Math.max(0, num(inputVal));
  const frequency = els.editCostFreq.value;

  els.btnSaveEditCost.disabled = true;
  els.btnSaveEditCost.textContent = "Menyimpan...";

  try {
    const res = await updateCostItem(biz.id, editingCostId, { name, amount, frequency });
    biz.monthlyFixedBurden = res.newMonthlyFixedBurden;
    biz.monthlyOpex = res.newMonthlyOpex;
    biz.opexItems = res.updatedOpex;

    renderAll();
    renderBurdenView();
    closeEditCostModal();
    toast(`Biaya "${name}" berhasil diperbarui ✓`, "success");
  } catch (err) {
    console.error(err);
    toast("Gagal memperbarui biaya.", "error");
  } finally {
    els.btnSaveEditCost.disabled = false;
    els.btnSaveEditCost.textContent = "Simpan Perubahan Beban ✓";
  }
}

els.btnCloseEditCost?.addEventListener("click", closeEditCostModal);
els.btnCancelEditCost?.addEventListener("click", closeEditCostModal);
els.editCostModal?.addEventListener("click", (e) => {
  if (e.target === els.editCostModal) closeEditCostModal();
});
els.editCostAmount?.addEventListener("input", handleEditCostInput);
els.editCostFreq?.addEventListener("change", handleEditCostInput);
els.btnSaveEditCost?.addEventListener("click", handleSaveEditCost);

/* ================================================================== */
/* Edit Capital Burden                                                */
/* ================================================================== */

function openEditCapitalModal() {
  const biz = currentBiz();
  if (!biz) return;

  if (biz.capitalType === "loan") {
    els.editCapDesc.textContent = "Perbarui detail pinjaman modal luar dan bunga per tahun.";
    els.editCapLoanFields.style.display = "block";
    els.editCapOwnFields.style.display = "none";
    els.editCapLoanCapital.value = biz.initialCapital || "";
    els.editCapLoanTenor.value = biz.loanDetails?.tenorMonths || 12;
    els.editCapLoanInterest.value = biz.loanDetails?.annualInterestRatePct || 0;
  } else if (biz.capitalType === "own") {
    els.editCapDesc.textContent = "Perbarui modal awal sendiri dan target balik modal (payback period).";
    els.editCapLoanFields.style.display = "none";
    els.editCapOwnFields.style.display = "block";
    els.editCapOwnCapital.value = biz.initialCapital || "";
    els.editCapOwnPayback.value = biz.ownCapitalDetails?.targetPaybackMonths || 12;
  } else {
    toast("Usaha ini tidak memiliki konfigurasi modal/pinjaman.", "info");
    return;
  }

  handleEditCapitalInput();

  els.btnSaveEditCapital.disabled = false;
  els.btnSaveEditCapital.textContent = "Simpan Perubahan Modal ✓";
  els.editCapitalModal.style.display = "flex";
  document.body.classList.add("is-modal");
  setTimeout(() => {
    if (biz.capitalType === "loan") els.editCapLoanCapital.focus();
    else els.editCapOwnCapital.focus();
  }, 80);
}

function closeEditCapitalModal() {
  els.editCapitalModal.style.display = "none";
  if (!els.burdenViewModal || els.burdenViewModal.style.display === "none") {
    document.body.classList.remove("is-modal");
  }
}

function handleEditCapitalInput() {
  const biz = currentBiz();
  if (!biz) return;

  let capBurden = 0;
  let capital = 0;
  if (biz.capitalType === "loan") {
    capital = num(els.editCapLoanCapital.value);
    const tenor = Math.max(1, num(els.editCapLoanTenor.value) || 1);
    const interest = num(els.editCapLoanInterest.value);
    capBurden = Math.round(
      capitalMonthlyBurden({
        capitalType: "loan",
        initialCapital: capital,
        loanDetails: { tenorMonths: tenor, annualInterestRatePct: interest },
      })
    );
  } else {
    capital = num(els.editCapOwnCapital.value);
    const payback = Math.max(1, num(els.editCapOwnPayback.value) || 1);
    capBurden = Math.round(
      capitalMonthlyBurden({
        capitalType: "own",
        initialCapital: capital,
        ownCapitalDetails: { targetPaybackMonths: payback },
      })
    );
  }

  const monthlyOpex = num(biz.monthlyOpex);
  const newTotalBurden = monthlyOpex + capBurden;

  els.ecapPreviewMonthly.textContent = `${formatRp(capBurden)} / bln`;
  els.ecapPreviewTotal.textContent = `${formatRp(newTotalBurden)} / bln`;
}

async function handleSaveEditCapital() {
  const biz = currentBiz();
  if (!biz) return;

  let payload = {};
  if (biz.capitalType === "loan") {
    const capital = num(els.editCapLoanCapital.value);
    const tenor = Math.max(1, num(els.editCapLoanTenor.value) || 1);
    const interest = Math.max(0, num(els.editCapLoanInterest.value));
    payload = {
      initialCapital: capital,
      loanDetails: { tenorMonths: tenor, annualInterestRatePct: interest },
    };
  } else {
    const capital = num(els.editCapOwnCapital.value);
    const payback = Math.max(1, num(els.editCapOwnPayback.value) || 1);
    payload = {
      initialCapital: capital,
      ownCapitalDetails: { targetPaybackMonths: payback },
    };
  }

  els.btnSaveEditCapital.disabled = true;
  els.btnSaveEditCapital.textContent = "Menyimpan...";

  try {
    const res = await updateCapitalDetails(biz.id, payload);
    biz.initialCapital = payload.initialCapital;
    if (payload.loanDetails) biz.loanDetails = payload.loanDetails;
    if (payload.ownCapitalDetails) biz.ownCapitalDetails = payload.ownCapitalDetails;
    biz.monthlyFixedBurden = res.newMonthlyFixedBurden;

    renderAll();
    renderBurdenView();
    closeEditCapitalModal();
    toast("Beban modal / cicilan berhasil diperbarui ✓", "success");
  } catch (err) {
    console.error(err);
    toast("Gagal memperbarui beban modal.", "error");
  } finally {
    els.btnSaveEditCapital.disabled = false;
    els.btnSaveEditCapital.textContent = "Simpan Perubahan Modal ✓";
  }
}

els.btnCloseEditCapital?.addEventListener("click", closeEditCapitalModal);
els.btnCancelEditCapital?.addEventListener("click", closeEditCapitalModal);
els.editCapitalModal?.addEventListener("click", (e) => {
  if (e.target === els.editCapitalModal) closeEditCapitalModal();
});
els.editCapLoanCapital?.addEventListener("input", handleEditCapitalInput);
els.editCapLoanTenor?.addEventListener("input", handleEditCapitalInput);
els.editCapLoanInterest?.addEventListener("input", handleEditCapitalInput);
els.editCapOwnCapital?.addEventListener("input", handleEditCapitalInput);
els.editCapOwnPayback?.addEventListener("input", handleEditCapitalInput);
els.btnSaveEditCapital?.addEventListener("click", handleSaveEditCapital);

/* ================================================================== */
/* Edit Product (Name, HPP/COGS, Target Margin, Price, Share)          */
/* ================================================================== */

let editingProductId = null;

function openAddProductModal() {
  const biz = currentBiz();
  if (!biz) {
    toast("Pilih atau buat usaha terlebih dahulu.", "warn");
    return;
  }
  editingProductId = null;
  if (els.epModalTitle) els.epModalTitle.textContent = "＋ Tambah Produk Baru";
  if (els.epModalDesc) {
    els.epModalDesc.textContent =
      "Tambahkan produk baru ke dalam daftar menu usaha Anda. Target BEP dan kuota kasir akan otomatis disesuaikan.";
  }
  if (els.epCurrentBanner) els.epCurrentBanner.style.display = "none";

  els.epCurrentCogs.textContent = "Rp 0";
  els.epCurrentPrice.textContent = "Rp 0";
  els.epCurrentShare.textContent = "0%";
  els.epCurrentMargin.textContent = "0%";

  els.editProductName.value = "";
  els.editProductCogs.value = "";
  els.editProductNewPrice.value = "";
  const currentTotalShare = state.products.reduce((s, p) => s + num(p.salesSharePct), 0);
  const remainingShare = Math.max(0, 100 - currentTotalShare);
  els.editProductNewShare.value = remainingShare > 0 ? remainingShare.toFixed(1) : "20";

  els.editProductMarginRange.value = 50;
  els.editProductMarginVal.textContent = "50%";
  if (els.epPriceHint) {
    els.epPriceHint.textContent = "Isi HPP untuk melihat rekomendasi harga.";
    els.epPriceHint.style.color = "#94a3b8";
  }

  if (els.editProductPreview) els.editProductPreview.style.display = "none";
  if (els.epMarginWarning) els.epMarginWarning.style.display = "none";

  els.btnSaveProductPrice.disabled = false;
  els.btnSaveProductPrice.textContent = "Simpan Produk Baru ✓";
  els.editProductModal.style.display = "flex";
  document.body.classList.add("is-modal");
  setTimeout(() => els.editProductName.focus(), 80);
}

function openEditProductModal(productId) {
  const biz = currentBiz();
  if (!biz) return;
  const prod = state.products.find(
    (p) => p.id === productId || p.productId === productId || p.name === productId
  );
  if (!prod) {
    toast("Produk tidak ditemukan.", "warn");
    return;
  }

  editingProductId = prod.id || productId;
  if (els.epModalTitle) els.epModalTitle.textContent = `✏️ Edit Produk: ${prod.name}`;
  if (els.epModalDesc) {
    els.epModalDesc.textContent =
      "Perbarui detail produk termasuk nama, HPP (modal bahan), margin keuntungan, harga jual, dan porsi penjualan. Target BEP dan kuota kasir akan otomatis disesuaikan.";
  }
  if (els.epCurrentBanner) els.epCurrentBanner.style.display = "grid";

  els.epCurrentCogs.textContent = formatRp(prod.cogs);
  els.epCurrentPrice.textContent = formatRp(prod.price);
  els.epCurrentShare.textContent = `${num(prod.salesSharePct).toFixed(1)}%`;
  els.epCurrentMargin.textContent = `${marginPct(prod.price, prod.cogs).toFixed(1)}%`;

  els.editProductName.value = prod.name ?? "";
  els.editProductCogs.value = prod.cogs ?? "";
  els.editProductNewPrice.value = prod.price ?? "";
  els.editProductNewShare.value = prod.salesSharePct ?? "";

  const existingMargin = prod.targetMarginPct || marginPct(prod.price, prod.cogs);
  const safeMargin = clamp(Math.round(existingMargin) || 50, 5, 95);
  els.editProductMarginRange.value = safeMargin;
  els.editProductMarginVal.textContent = `${safeMargin}%`;

  syncProductEditUi("init");

  els.btnSaveProductPrice.disabled = false;
  els.btnSaveProductPrice.textContent = "Simpan Perubahan Produk ✓";
  els.editProductModal.style.display = "flex";
  document.body.classList.add("is-modal");
  setTimeout(() => els.editProductName.focus(), 80);
}

function closeEditProductModal() {
  els.editProductModal.style.display = "none";
  document.body.classList.remove("is-modal");
}

/**
 * Synchronize inputs and preview in the product edit/add modal.
 * @param {"margin" | "price" | "cogs" | "share" | "name" | "init"} trigger
 */
function syncProductEditUi(trigger) {
  const isEditing = Boolean(editingProductId);
  const prod = isEditing ? state.products.find((p) => p.id === editingProductId) : null;
  if (isEditing && !prod) return;

  let cogs = Math.max(0, num(els.editProductCogs.value));
  let margin = Number(els.editProductMarginRange.value) || 50;
  let price = Math.max(0, num(els.editProductNewPrice.value));
  let share = Math.max(0, num(els.editProductNewShare.value));

  if (trigger === "margin") {
    // When user drags margin slider, calculate suggested price and set price input
    const recPrice = suggestPrice(cogs, margin);
    if (recPrice > 0) {
      els.editProductNewPrice.value = recPrice;
      price = recPrice;
    }
    els.editProductMarginVal.textContent = `${margin}%`;
  } else if (trigger === "price") {
    // When user edits selling price directly, recalculate actual margin and sync slider
    if (price > 0 && cogs > 0) {
      const actual = marginPct(price, cogs);
      const safeM = clamp(Math.round(actual), 5, 95);
      els.editProductMarginRange.value = safeM;
      els.editProductMarginVal.textContent = `${actual.toFixed(1)}%`;
      margin = safeM;
    }
  } else if (trigger === "cogs") {
    // When COGS changes, update recommended price and actual margin
    if (price > 0 && cogs > 0) {
      const actual = marginPct(price, cogs);
      const safeM = clamp(Math.round(actual), 5, 95);
      els.editProductMarginRange.value = safeM;
      els.editProductMarginVal.textContent = `${actual.toFixed(1)}%`;
      margin = safeM;
    } else if (cogs > 0 && price === 0) {
      const recPrice = suggestPrice(cogs, margin);
      if (recPrice > 0) {
        els.editProductNewPrice.value = recPrice;
        price = recPrice;
      }
    }
  }

  // Calculate recommendation hint
  const recPrice = suggestPrice(cogs, margin);
  if (els.epPriceHint) {
    if (cogs <= 0) {
      els.epPriceHint.textContent = "Isi HPP untuk melihat rekomendasi harga.";
      els.epPriceHint.style.color = "#94a3b8";
    } else if (price > 0 && price <= cogs) {
      els.epPriceHint.textContent = `Harga di bawah/sama dengan HPP! Rekomendasi: ${formatRp(recPrice)}`;
      els.epPriceHint.style.color = "#f87171";
    } else {
      const profit = price > cogs ? price - cogs : 0;
      els.epPriceHint.textContent = `Rekomendasi ${formatRp(recPrice)} · laba ${formatRp(profit)} / unit`;
      els.epPriceHint.style.color = "#94a3b8";
    }
  }

  // Update live preview metrics
  const newMargin = marginPct(price, cogs);
  const profitPerUnit = price > cogs ? price - cogs : 0;

  if (isEditing && prod) {
    const oldPrice = num(prod.price);
    const oldCogs = num(prod.cogs);
    const oldShare = num(prod.salesSharePct);

    const deltaPrice = price - oldPrice;
    const deltaCogs = cogs - oldCogs;
    const deltaShare = share - oldShare;

    const deltaPriceSign = deltaPrice > 0 ? "+" : "";
    els.epPriceDelta.textContent = `${deltaPriceSign}${formatRp(deltaPrice)}`;
    els.epPriceDelta.className = deltaPrice > 0 ? "text-primary" : deltaPrice < 0 ? "text-warning" : "text-muted";

    const deltaCogsSign = deltaCogs > 0 ? "+" : "";
    if (els.epCogsDelta) {
      els.epCogsDelta.textContent = `${deltaCogsSign}${formatRp(deltaCogs)}`;
      els.epCogsDelta.className = deltaCogs > 0 ? "text-warning" : deltaCogs < 0 ? "text-primary" : "text-muted";
    }

    const deltaShareSign = deltaShare > 0 ? "+" : "";
    els.epShareDelta.textContent = `${deltaShareSign}${deltaShare.toFixed(1)}%`;
    els.epShareDelta.className = deltaShare !== 0 ? "text-warning" : "text-muted";

    const otherShare = state.products
      .filter((p) => p.id !== prod.id)
      .reduce((s, p) => s + num(p.salesSharePct), 0);
    const totalShare = otherShare + share;
    els.epTotalSharePreview.textContent = `${totalShare.toFixed(1)}%`;
    els.epTotalSharePreview.className = Math.abs(totalShare - 100) < 0.1 ? "text-primary" : "text-warning";
  } else {
    // Mode Tambah Produk Baru
    els.epPriceDelta.textContent = formatRp(price);
    els.epPriceDelta.className = "text-primary";
    if (els.epCogsDelta) {
      els.epCogsDelta.textContent = formatRp(cogs);
      els.epCogsDelta.className = "text-muted";
    }
    els.epShareDelta.textContent = `${share.toFixed(1)}%`;
    els.epShareDelta.className = "text-primary";

    const existingTotalShare = state.products.reduce((s, p) => s + num(p.salesSharePct), 0);
    const totalShare = existingTotalShare + share;
    els.epTotalSharePreview.textContent = `${totalShare.toFixed(1)}%`;
    els.epTotalSharePreview.className = Math.abs(totalShare - 100) < 0.1 ? "text-primary" : "text-warning";
  }

  els.epNewMargin.textContent = `${newMargin.toFixed(1)}%`;
  els.epProfitPerUnit.textContent = formatRp(profitPerUnit);

  if (price > 0 && price <= cogs) {
    els.epMarginWarning.style.display = "block";
    els.epNewMargin.className = "text-warning";
  } else {
    els.epMarginWarning.style.display = "none";
    els.epNewMargin.className = "text-primary";
  }

  if (price > 0 || cogs > 0) {
    els.editProductPreview.style.display = "block";
  } else {
    els.editProductPreview.style.display = "none";
  }
}

async function handleSaveProductPrice() {
  const biz = currentBiz();
  if (!biz) {
    toast("Pilih atau buat usaha terlebih dahulu.", "warn");
    return;
  }

  const isEditing = Boolean(editingProductId);
  const prod = isEditing ? state.products.find((p) => p.id === editingProductId) : null;
  if (isEditing && !prod) {
    toast("Produk tidak ditemukan.", "warn");
    return;
  }

  const newName = els.editProductName.value.trim();
  if (!newName) {
    toast("Nama produk tidak boleh kosong.", "warn");
    els.editProductName.focus();
    return;
  }

  const cogsVal = els.editProductCogs.value;
  if (cogsVal === "" || isNaN(Number(cogsVal)) || Number(cogsVal) <= 0) {
    toast("Masukkan HPP (modal pokok) yang valid (> 0).", "warn");
    els.editProductCogs.focus();
    return;
  }

  const priceVal = els.editProductNewPrice.value;
  if (priceVal === "" || isNaN(Number(priceVal)) || Number(priceVal) <= 0) {
    toast("Masukkan harga jual yang valid (> 0).", "warn");
    els.editProductNewPrice.focus();
    return;
  }

  const newCogs = Math.max(0, num(cogsVal));
  const newPrice = Math.max(0, num(priceVal));
  const newShare = Math.max(0, num(els.editProductNewShare.value));

  if (newPrice <= newCogs) {
    toast("Harga jual harus lebih tinggi dari HPP.", "warn");
    els.editProductNewPrice.focus();
    return;
  }

  const newMargin = marginPct(newPrice, newCogs);

  els.btnSaveProductPrice.disabled = true;
  els.btnSaveProductPrice.textContent = "Menyimpan...";

  if (!isEditing) {
    try {
      const created = await addProduct(biz.id, {
        name: newName,
        cogs: newCogs,
        price: newPrice,
        salesSharePct: newShare,
        targetMarginPct: newMargin,
      });
      if (created && created.id && !state.products.some((p) => p.id === created.id)) {
        state.products.push(created);
        state.products.sort(
          (a, b) =>
            (b.salesSharePct || 0) - (a.salesSharePct || 0) ||
            String(a.name).localeCompare(String(b.name))
        );
        renderAll();
      }
      closeEditProductModal();
      toast(`Produk "${newName}" berhasil ditambahkan ✓`, "success");
    } catch (err) {
      console.error(err);
      toast("Gagal menambahkan produk.", "error");
    } finally {
      els.btnSaveProductPrice.disabled = false;
      els.btnSaveProductPrice.textContent = "Simpan Produk Baru ✓";
    }
    return;
  }

  try {
    await updateProduct(biz.id, prod.id, {
      name: newName,
      cogs: newCogs,
      price: newPrice,
      salesSharePct: newShare,
      targetMarginPct: newMargin,
    });
    prod.name = newName;
    prod.cogs = newCogs;
    prod.price = newPrice;
    prod.salesSharePct = newShare;
    prod.targetMarginPct = newMargin;

    renderAll();
    closeEditProductModal();
    toast(`Produk "${newName}" berhasil diperbarui ✓`, "success");
  } catch (err) {
    console.error(err);
    toast("Gagal memperbarui produk.", "error");
  } finally {
    els.btnSaveProductPrice.disabled = false;
    els.btnSaveProductPrice.textContent = "Simpan Perubahan Produk ✓";
  }
}

els.btnCloseEditProduct?.addEventListener("click", closeEditProductModal);
els.btnCancelEditProduct?.addEventListener("click", closeEditProductModal);
els.editProductModal?.addEventListener("click", (e) => {
  if (e.target === els.editProductModal) closeEditProductModal();
});
els.editProductName?.addEventListener("input", () => syncProductEditUi("name"));
els.editProductCogs?.addEventListener("input", () => syncProductEditUi("cogs"));
els.editProductMarginRange?.addEventListener("input", () => syncProductEditUi("margin"));
els.editProductNewPrice?.addEventListener("input", () => syncProductEditUi("price"));
els.editProductNewShare?.addEventListener("input", () => syncProductEditUi("share"));
els.btnApplySuggestedPrice?.addEventListener("click", () => {
  const cogs = Math.max(0, num(els.editProductCogs.value));
  const margin = Number(els.editProductMarginRange.value) || 50;
  const rec = suggestPrice(cogs, margin);
  if (rec > 0) {
    els.editProductNewPrice.value = rec;
    syncProductEditUi("price");
  } else {
    toast("Isi HPP terlebih dahulu untuk menghitung rekomendasi.", "info");
  }
});
els.btnSaveProductPrice?.addEventListener("click", handleSaveProductPrice);
els.btnAddProduct?.addEventListener("click", openAddProductModal);

/* ================================================================== */
/* Current Burden Breakdown & Add Burden                               */
/* ================================================================== */

function openBurdenViewModal() {
  const biz = currentBiz();
  if (!biz) return;
  renderBurdenView();
  els.burdenViewModal.style.display = "flex";
  document.body.classList.add("is-modal");
}

function closeBurdenViewModal() {
  els.burdenViewModal.style.display = "none";
  document.body.classList.remove("is-modal");
}

function renderBurdenView() {
  const biz = currentBiz();
  if (!biz) return;

  const b = num(biz.monthlyFixedBurden);
  const dailyB = Math.round(b / DAYS_FOR_TARGET);
  els.bvTotalMonthly.textContent = formatRp(b) + " / bln";
  els.bvTotalDaily.textContent = formatRp(dailyB) + " / hari";

  // Capital burden (initial + additions)
  const initialCapBurden = Math.round(
    capitalMonthlyBurden({
      capitalType: biz.capitalType,
      initialCapital: biz.initialCapital,
      loanDetails: biz.loanDetails,
      ownCapitalDetails: biz.ownCapitalDetails,
    })
  );
  const additions = biz.capitalAdditions || [];
  const additionsBurden = additions.reduce((s, a) => s + (Number(a.monthlyBurden) || 0), 0);
  const totalCapBurden = initialCapBurden + additionsBurden;
  els.bvCapitalMonthly.textContent = formatRp(totalCapBurden) + " / bln";

  let capHtml = "";
  if (biz.capitalType === "loan" && biz.loanDetails) {
    capHtml = `
      <div class="cap-row">
        <span class="cap-label">Jenis Pinjaman Awal</span>
        <span class="cap-val">Pinjaman Bank / Modal Luar</span>
      </div>
      <div class="cap-row">
        <span class="cap-label">Pokok Pinjaman Awal</span>
        <span class="cap-val">${formatRp(biz.initialCapital)}</span>
      </div>
      <div class="cap-row">
        <span class="cap-label">Tenor &amp; Bunga</span>
        <span class="cap-val">${num(biz.loanDetails.tenorMonths)} bulan @ ${num(biz.loanDetails.annualInterestRatePct)}% p.a.</span>
      </div>
      <div class="cap-row">
        <span class="cap-label">Cicilan Bulanan Awal</span>
        <span class="cap-val" style="color: #38bdf8;">${formatRp(initialCapBurden)} / bulan</span>
      </div>
    `;
  } else if (biz.capitalType === "own" && num(biz.initialCapital) > 0) {
    const payback = biz.ownCapitalDetails?.targetPaybackMonths || 1;
    capHtml = `
      <div class="cap-row">
        <span class="cap-label">Jenis Modal Awal</span>
        <span class="cap-val">Modal Sendiri</span>
      </div>
      <div class="cap-row">
        <span class="cap-label">Modal Awal</span>
        <span class="cap-val">${formatRp(biz.initialCapital)}</span>
      </div>
      <div class="cap-row">
        <span class="cap-label">Target Balik Modal</span>
        <span class="cap-val">${payback} bulan</span>
      </div>
      <div class="cap-row">
        <span class="cap-label">Cicil Modal Awal</span>
        <span class="cap-val" style="color: #38bdf8;">${formatRp(initialCapBurden)} / bulan</span>
      </div>
    `;
  } else {
    capHtml = `<p class="muted" style="margin: 0; font-size: 0.85rem;">Tidak ada alokasi cicilan modal awal khusus.</p>`;
  }

  let additionsHtml = "";
  if (additions.length > 0) {
    additionsHtml = `
      <div style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed rgba(255,255,255,0.15);">
        <strong style="display: block; font-size: 0.85rem; color: #f1f5f9; margin-bottom: 8px;">
          Tambahan Modal &amp; Investasi (${additions.length}):
        </strong>
        ${additions
          .map((it) => {
            let schemeDesc = "";
            let icon = "💰";
            if (it.type === "invest") {
              icon = "🤝";
              if (it.returnType === "dynamic") {
                schemeDesc = `Bagi hasil dinamis ${it.dynamicProfitPct}% dari laba${it.monthlyBurden > 0 ? ` · cicilan ${formatRp(it.monthlyBurden)}/bln` : " · tanpa beban tetap"}`;
              } else {
                schemeDesc = `Imbal hasil tetap ${it.fixedReturnPct}%/bln${it.tenorMonths > 0 ? ` · tenor ${it.tenorMonths} bln` : ""} · beban ${formatRp(it.monthlyBurden)}/bln`;
              }
            } else if (it.type === "loan") {
              icon = "🏦";
              schemeDesc = `Pinjaman · tenor ${it.tenorMonths} bln @ ${it.annualInterestRatePct}% · cicilan ${formatRp(it.monthlyBurden)}/bln`;
            } else {
              icon = "💰";
              schemeDesc = `Modal sendiri${it.paybackMonths > 0 ? ` · target ${it.paybackMonths} bln · alokasi ${formatRp(it.monthlyBurden)}/bln` : " · tanpa cicilan"}`;
            }

            return `
              <div class="burden-item" data-id="${esc(it.id)}" style="background: rgba(15, 23, 42, 0.6); margin-bottom: 6px;">
                <div class="burden-item-info">
                  <strong>${icon} ${esc(it.name || "Tambahan Modal")}</strong>
                  <small>${formatRp(it.amount)} · ${schemeDesc}</small>
                </div>
                <div class="burden-item-action">
                  <span class="burden-item-val" style="color: ${it.monthlyBurden > 0 ? "#38bdf8" : "#94a3b8"};">
                    ${it.monthlyBurden > 0 ? `${formatRp(it.monthlyBurden)}/bln` : "Rp 0"}
                  </span>
                  <button type="button" class="btn-delete-cost" data-del-capital="${esc(it.id)}" title="Hapus tambahan modal ${esc(it.name)}">🗑️</button>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  els.bvCapitalCard.innerHTML = capHtml + additionsHtml;

  // Opex items
  const items = biz.opexItems || [];
  const totalOpex = items.reduce((s, it) => s + toMonthly(it.amount, it.frequency), 0);
  els.bvOpexTotal.textContent = `${formatRp(totalOpex)} / bln`;

  if (items.length === 0) {
    els.bvOpexList.innerHTML = `<p class="muted" style="text-align: center; padding: 14px; margin: 0; font-size: 0.85rem;">Belum ada item biaya operasional.</p>`;
  } else {
    const freqLabels = { daily: "harian", monthly: "bulanan", yearly: "tahunan" };
    els.bvOpexList.innerHTML = items
      .map((it, idx) => {
        const itId = it.id || `idx-${idx}`;
        const monthlyEq = Math.round(toMonthly(it.amount, it.frequency));
        const freqText = freqLabels[it.frequency] || it.frequency || "bulanan";
        return `
          <div class="burden-item" data-id="${esc(itId)}">
            <div class="burden-item-info">
              <strong>${esc(it.name || "Biaya")}</strong>
              <small>${formatRp(it.amount)} / ${freqText}${it.frequency !== "monthly" ? ` (setara ${formatRp(monthlyEq)}/bln)` : ""}</small>
            </div>
            <div class="burden-item-action">
              <span class="burden-item-val">${formatRp(monthlyEq)}</span>
              <button type="button" class="btn-edit-cost" data-edit-cost="${esc(itId)}" title="Ubah detail biaya ${esc(it.name)}">✏️</button>
              <button type="button" class="btn-delete-cost" data-del-cost="${esc(itId)}" title="Hapus biaya ${esc(it.name)}">🗑️</button>
            </div>
          </div>
        `;
      })
      .join("");
  }
}

async function handleDeleteCost(costId) {
  const biz = currentBiz();
  if (!biz) return;
  const items = biz.opexItems || [];
  const item = items.find((it, idx) => (it.id || `idx-${idx}`) === costId || String(idx) === costId);
  if (!item) return;

  const monthlyAmt = Math.round(toMonthly(item.amount, item.frequency));
  if (!confirm(`Hapus biaya "${item.name}"?\nBeban bulanan akan berkurang ${formatRp(monthlyAmt)}.`)) {
    return;
  }

  try {
    const res = await removeCostFromBusiness(biz.id, costId);
    if (res) {
      biz.monthlyFixedBurden = Math.max(0, num(biz.monthlyFixedBurden) - res.monthlyAmt);
      biz.monthlyOpex = Math.max(0, num(biz.monthlyOpex) - res.monthlyAmt);
      biz.opexItems = res.updatedOpex;
      renderAll();
      renderBurdenView();
      toast(`Biaya "${item.name}" berhasil dihapus.`, "info");
    }
  } catch (err) {
    console.error(err);
    toast("Gagal menghapus biaya.", "error");
  }
}

function openAddBurdenModal() {
  const biz = currentBiz();
  if (!biz) return;
  els.addBurdenName.value = "";
  els.addBurdenAmount.value = "";
  els.addBurdenFreq.value = "monthly";
  els.addBurdenPreview.style.display = "none";
  els.btnSaveNewBurden.disabled = false;
  els.btnSaveNewBurden.textContent = "Simpan Beban Baru ✓";
  els.addBurdenModal.style.display = "flex";
  document.body.classList.add("is-modal");
  setTimeout(() => els.addBurdenName.focus(), 80);
}

function closeAddBurdenModal() {
  els.addBurdenModal.style.display = "none";
  document.body.classList.remove("is-modal");
}

function handleAddBurdenInput() {
  const amt = num(els.addBurdenAmount.value);
  if (amt <= 0) {
    els.addBurdenPreview.style.display = "none";
    return;
  }

  const biz = currentBiz();
  if (!biz) return;

  const freq = els.addBurdenFreq.value;
  const monthlyAmt = Math.round(toMonthly(amt, freq));
  const dailyAmt = Math.round(monthlyAmt / DAYS_FOR_TARGET);
  const newTotal = num(biz.monthlyFixedBurden) + monthlyAmt;

  els.abPreviewMonthly.textContent = `+${formatRp(monthlyAmt)} / bln`;
  els.abPreviewDaily.textContent = `+${formatRp(dailyAmt)} / hari`;
  els.abPreviewTotal.textContent = `${formatRp(newTotal)} / bln`;
  els.addBurdenPreview.style.display = "block";
}

async function handleSaveNewBurden() {
  const biz = currentBiz();
  if (!biz) return;

  const name = els.addBurdenName.value.trim() || "Biaya Operasional";
  const amt = num(els.addBurdenAmount.value);
  if (amt <= 0) {
    toast("Masukkan nominal biaya yang valid.", "warn");
    return;
  }

  const freq = els.addBurdenFreq.value;
  els.btnSaveNewBurden.disabled = true;
  els.btnSaveNewBurden.textContent = "Menyimpan...";

  try {
    const res = await addCostToBusiness(biz.id, { name, amount: amt, frequency: freq });
    biz.monthlyFixedBurden = num(biz.monthlyFixedBurden) + res.monthlyAmt;
    biz.monthlyOpex = num(biz.monthlyOpex) + res.monthlyAmt;
    biz.opexItems = res.updatedOpex;

    renderAll();
    closeAddBurdenModal();
    toast(`Beban "${name}" (${formatRp(res.monthlyAmt)}/bln) berhasil ditambahkan!`, "success");

    if (els.burdenViewModal.style.display !== "none") {
      renderBurdenView();
    }
  } catch (err) {
    console.error(err);
    toast("Gagal menambahkan beban baru.", "error");
  } finally {
    els.btnSaveNewBurden.disabled = false;
    els.btnSaveNewBurden.textContent = "Simpan Beban Baru ✓";
  }
}

els.btnViewBurden?.addEventListener("click", openBurdenViewModal);
els.btnCloseBurdenView?.addEventListener("click", closeBurdenViewModal);
els.btnBvClose?.addEventListener("click", closeBurdenViewModal);
els.btnBvAddCost?.addEventListener("click", () => {
  closeBurdenViewModal();
  openAddBurdenModal();
});
els.burdenViewModal?.addEventListener("click", (e) => {
  if (e.target === els.burdenViewModal) closeBurdenViewModal();
});
els.btnBvEditCapital?.addEventListener("click", openEditCapitalModal);
els.bvOpexList?.addEventListener("click", (e) => {
  const editBtn = e.target.closest("[data-edit-cost]");
  if (editBtn) {
    openEditCostModal(editBtn.dataset.editCost);
    return;
  }
  const delBtn = e.target.closest("[data-del-cost]");
  if (delBtn) handleDeleteCost(delBtn.dataset.delCost);
});

els.btnAddBurden?.addEventListener("click", openAddBurdenModal);
els.btnCloseAddBurden?.addEventListener("click", closeAddBurdenModal);
els.addBurdenModal?.addEventListener("click", (e) => {
  if (e.target === els.addBurdenModal) closeAddBurdenModal();
});
els.addBurdenAmount?.addEventListener("input", handleAddBurdenInput);
els.addBurdenFreq?.addEventListener("change", handleAddBurdenInput);
els.btnSaveNewBurden?.addEventListener("click", handleSaveNewBurden);

/* ================================================================== */
/* Add Capital & Investment Modal                                      */
/* ================================================================== */

let selectedCapType = "invest";
let selectedInvestScheme = "dynamic";

function openAddCapitalModal() {
  const biz = currentBiz();
  if (!biz) return;

  selectedCapType = "invest";
  selectedInvestScheme = "dynamic";

  if (els.schemeDynamic) els.schemeDynamic.checked = true;
  if (els.schemeFixed) els.schemeFixed.checked = false;

  updateCapTypeTabs();
  updateInvestSchemeUi();

  if (els.addCapName) els.addCapName.value = "";
  if (els.addCapAmount) els.addCapAmount.value = "";
  if (els.addCapDynamicPct) els.addCapDynamicPct.value = "15";
  if (els.addCapDynamicTenor) els.addCapDynamicTenor.value = "";
  if (els.addCapFixedPct) els.addCapFixedPct.value = "2";
  if (els.addCapFixedTenor) els.addCapFixedTenor.value = "";
  if (els.addCapOwnPayback) els.addCapOwnPayback.value = "";
  if (els.addCapLoanTenor) els.addCapLoanTenor.value = "12";
  if (els.addCapLoanInterest) els.addCapLoanInterest.value = "10";

  syncAddCapitalPreview();

  if (els.btnSaveAddCapital) {
    els.btnSaveAddCapital.disabled = false;
    els.btnSaveAddCapital.textContent = "Simpan Tambahan Modal ✓";
  }
  els.addCapitalModal.style.display = "flex";
  document.body.classList.add("is-modal");
  setTimeout(() => els.addCapAmount?.focus(), 80);
}

function closeAddCapitalModal() {
  els.addCapitalModal.style.display = "none";
  document.body.classList.remove("is-modal");
}

function updateCapTypeTabs() {
  if (els.addCapInvestFields) els.addCapInvestFields.style.display = selectedCapType === "invest" ? "block" : "none";
  if (els.addCapOwnFields) els.addCapOwnFields.style.display = selectedCapType === "own" ? "block" : "none";
  if (els.addCapLoanFields) els.addCapLoanFields.style.display = selectedCapType === "loan" ? "block" : "none";

  els.btnCapTypeInvest?.classList.toggle("is-selected", selectedCapType === "invest");
  els.btnCapTypeOwn?.classList.toggle("is-selected", selectedCapType === "own");
  els.btnCapTypeLoan?.classList.toggle("is-selected", selectedCapType === "loan");
}

function updateInvestSchemeUi() {
  const isDynamic = selectedInvestScheme === "dynamic";
  if (els.investDynamicBox) els.investDynamicBox.style.display = isDynamic ? "block" : "none";
  if (els.investFixedBox) els.investFixedBox.style.display = isDynamic ? "none" : "block";

  if (els.labelSchemeDynamic) {
    els.labelSchemeDynamic.style.borderColor = isDynamic ? "#38bdf8" : "#334155";
    els.labelSchemeDynamic.style.background = isDynamic ? "rgba(56, 189, 248, 0.1)" : "#0f172a";
  }
  if (els.labelSchemeFixed) {
    els.labelSchemeFixed.style.borderColor = !isDynamic ? "#38bdf8" : "#334155";
    els.labelSchemeFixed.style.background = !isDynamic ? "rgba(56, 189, 248, 0.1)" : "#0f172a";
  }
}

function syncAddCapitalPreview() {
  const biz = currentBiz();
  if (!biz) return;

  const rawAmount = els.addCapAmount ? els.addCapAmount.value : "";
  if (rawAmount === "" || isNaN(Number(rawAmount)) || Number(rawAmount) <= 0) {
    if (els.addCapPreview) els.addCapPreview.style.display = "none";
    return;
  }

  const amount = Math.max(0, num(rawAmount));
  const currentBurden = num(biz.monthlyFixedBurden);

  const payload = {
    amount,
    type: selectedCapType,
    returnType: selectedInvestScheme,
    fixedReturnPct: els.addCapFixedPct ? num(els.addCapFixedPct.value) : 0,
    dynamicProfitPct: els.addCapDynamicPct ? num(els.addCapDynamicPct.value) : 0,
    tenorMonths: selectedCapType === "loan"
      ? (els.addCapLoanTenor ? num(els.addCapLoanTenor.value) : 12)
      : selectedInvestScheme === "fixed"
        ? (els.addCapFixedTenor ? num(els.addCapFixedTenor.value) : 0)
        : (els.addCapDynamicTenor ? num(els.addCapDynamicTenor.value) : 0),
    paybackMonths: els.addCapOwnPayback ? num(els.addCapOwnPayback.value) : 0,
    annualInterestRatePct: els.addCapLoanInterest ? num(els.addCapLoanInterest.value) : 0,
  };

  const addedMonthlyBurden = calculateAdditionMonthlyBurden(payload);
  const newTotalBurden = currentBurden + addedMonthlyBurden;
  const dailyDelta = Math.round(addedMonthlyBurden / DAYS_FOR_TARGET);

  if (els.acPreviewAmount) els.acPreviewAmount.textContent = `+${formatRp(amount)}`;

  let schemeText = "";
  if (selectedCapType === "invest") {
    if (selectedInvestScheme === "dynamic") {
      schemeText = `Bagi hasil dinamis ${payload.dynamicProfitPct}% dari laba bersih`;
    } else {
      schemeText = `Imbal hasil tetap ${payload.fixedReturnPct}%/bln`;
    }
  } else if (selectedCapType === "own") {
    schemeText = payload.paybackMonths > 0 ? `Modal sendiri (${payload.paybackMonths} bulan)` : "Modal sendiri (tanpa beban cicilan)";
  } else {
    schemeText = `Pinjaman (${payload.tenorMonths} bulan @ ${payload.annualInterestRatePct}%)`;
  }
  if (els.acPreviewScheme) els.acPreviewScheme.textContent = schemeText;

  if (els.acPreviewMonthly) {
    els.acPreviewMonthly.textContent = addedMonthlyBurden > 0 ? `+${formatRp(addedMonthlyBurden)} / bln` : "Rp 0 (tidak membebani BEP)";
    els.acPreviewMonthly.className = addedMonthlyBurden > 0 ? "text-warning" : "text-primary";
  }
  if (els.acPreviewDaily) els.acPreviewDaily.textContent = dailyDelta > 0 ? `+${formatRp(dailyDelta)} / hari` : "Rp 0 / hari";
  if (els.acPreviewTotal) els.acPreviewTotal.textContent = `${formatRp(newTotalBurden)} / bln`;

  if (els.addCapPreview) els.addCapPreview.style.display = "block";
}

async function handleSaveAddCapital() {
  const biz = currentBiz();
  if (!biz) return;

  const rawAmount = els.addCapAmount ? els.addCapAmount.value : "";
  if (rawAmount === "" || isNaN(Number(rawAmount)) || Number(rawAmount) <= 0) {
    toast("Masukkan nominal modal tambahan yang valid.", "warn");
    els.addCapAmount?.focus();
    return;
  }

  const amount = Math.max(0, num(rawAmount));
  const name = els.addCapName ? els.addCapName.value.trim() : "";

  const payload = {
    name,
    amount,
    type: selectedCapType,
    returnType: selectedInvestScheme,
    fixedReturnPct: els.addCapFixedPct ? num(els.addCapFixedPct.value) : 0,
    dynamicProfitPct: els.addCapDynamicPct ? num(els.addCapDynamicPct.value) : 0,
    tenorMonths: selectedCapType === "loan"
      ? (els.addCapLoanTenor ? num(els.addCapLoanTenor.value) : 12)
      : selectedInvestScheme === "fixed"
        ? (els.addCapFixedTenor ? num(els.addCapFixedTenor.value) : 0)
        : (els.addCapDynamicTenor ? num(els.addCapDynamicTenor.value) : 0),
    paybackMonths: els.addCapOwnPayback ? num(els.addCapOwnPayback.value) : 0,
    annualInterestRatePct: els.addCapLoanInterest ? num(els.addCapLoanInterest.value) : 0,
  };

  els.btnSaveAddCapital.disabled = true;
  els.btnSaveAddCapital.textContent = "Menyimpan...";

  try {
    const res = await addCapitalAddition(biz.id, payload);
    if (res) {
      biz.capitalAdditions = res.capitalAdditions;
      biz.initialCapital = res.initialCapital;
      biz.unrecoveredCapital = res.unrecoveredCapital;
      biz.monthlyFixedBurden = res.monthlyFixedBurden;

      renderAll();
      if (els.burdenViewModal && els.burdenViewModal.style.display !== "none") {
        renderBurdenView();
      }
      closeAddCapitalModal();
      toast(`Tambahan modal ${formatRp(amount)} berhasil disimpan ✓`, "success");
    }
  } catch (err) {
    console.error(err);
    toast("Gagal menambahkan modal usaha.", "error");
  } finally {
    els.btnSaveAddCapital.disabled = false;
    els.btnSaveAddCapital.textContent = "Simpan Tambahan Modal ✓";
  }
}

async function handleDeleteCapitalAddition(additionId) {
  const biz = currentBiz();
  if (!biz) return;
  const additions = biz.capitalAdditions || [];
  const item = additions.find((a) => a.id === additionId);
  if (!item) return;

  if (!confirm(`Hapus tambahan modal "${item.name}" (${formatRp(item.amount)})?\nBeban bulanan akan berkurang ${formatRp(item.monthlyBurden)}.`)) {
    return;
  }

  try {
    const res = await removeCapitalAddition(biz.id, additionId);
    if (res) {
      biz.capitalAdditions = res.capitalAdditions;
      biz.initialCapital = res.initialCapital;
      biz.unrecoveredCapital = res.unrecoveredCapital;
      biz.monthlyFixedBurden = res.monthlyFixedBurden;

      renderAll();
      renderBurdenView();
      toast(`Tambahan modal "${item.name}" berhasil dihapus.`, "info");
    }
  } catch (err) {
    console.error(err);
    toast("Gagal menghapus tambahan modal.", "error");
  }
}

els.btnAddCapital?.addEventListener("click", openAddCapitalModal);
els.btnBvAddCapital?.addEventListener("click", () => {
  closeBurdenViewModal();
  openAddCapitalModal();
});
els.btnCloseAddCapital?.addEventListener("click", closeAddCapitalModal);
els.btnCancelAddCapital?.addEventListener("click", closeAddCapitalModal);
els.addCapitalModal?.addEventListener("click", (e) => {
  if (e.target === els.addCapitalModal) closeAddCapitalModal();
});

els.bvCapitalCard?.addEventListener("click", (e) => {
  const delBtn = e.target.closest("[data-del-capital]");
  if (delBtn) handleDeleteCapitalAddition(delBtn.dataset.delCapital);
});

els.btnCapTypeInvest?.addEventListener("click", () => {
  selectedCapType = "invest";
  updateCapTypeTabs();
  syncAddCapitalPreview();
});
els.btnCapTypeOwn?.addEventListener("click", () => {
  selectedCapType = "own";
  updateCapTypeTabs();
  syncAddCapitalPreview();
});
els.btnCapTypeLoan?.addEventListener("click", () => {
  selectedCapType = "loan";
  updateCapTypeTabs();
  syncAddCapitalPreview();
});

els.schemeDynamic?.addEventListener("change", () => {
  selectedInvestScheme = "dynamic";
  updateInvestSchemeUi();
  syncAddCapitalPreview();
});
els.schemeFixed?.addEventListener("change", () => {
  selectedInvestScheme = "fixed";
  updateInvestSchemeUi();
  syncAddCapitalPreview();
});

els.addCapName?.addEventListener("input", syncAddCapitalPreview);
els.addCapAmount?.addEventListener("input", syncAddCapitalPreview);
els.addCapDynamicPct?.addEventListener("input", syncAddCapitalPreview);
els.addCapDynamicTenor?.addEventListener("input", syncAddCapitalPreview);
els.addCapFixedPct?.addEventListener("input", syncAddCapitalPreview);
els.addCapFixedTenor?.addEventListener("input", syncAddCapitalPreview);
els.addCapOwnPayback?.addEventListener("input", syncAddCapitalPreview);
els.addCapLoanTenor?.addEventListener("input", syncAddCapitalPreview);
els.addCapLoanInterest?.addEventListener("input", syncAddCapitalPreview);
els.btnSaveAddCapital?.addEventListener("click", handleSaveAddCapital);

/* ================================================================== */
/* Delete Business Permanently                                         */
/* ================================================================== */

function openDeleteBizModal() {
  const biz = currentBiz();
  if (!biz) {
    toast("Pilih usaha yang ingin dihapus terlebih dahulu.", "warn");
    return;
  }
  els.delBizName.textContent = `"${biz.name}"`;
  els.delBizMatchName.textContent = `"${biz.name}"`;
  els.delBizConfirmInput.value = "";
  els.btnConfirmDeleteBiz.disabled = true;
  els.btnConfirmDeleteBiz.textContent = "Ya, Hapus Permanen";
  els.deleteBizModal.style.display = "flex";
  document.body.classList.add("is-modal");
  setTimeout(() => els.delBizConfirmInput?.focus(), 80);
}

function closeDeleteBizModal() {
  els.deleteBizModal.style.display = "none";
  document.body.classList.remove("is-modal");
}

function handleDeleteBizConfirmInput() {
  const biz = currentBiz();
  if (!biz) return;
  const typed = els.delBizConfirmInput.value.trim().toLowerCase();
  const target = biz.name.trim().toLowerCase();
  els.btnConfirmDeleteBiz.disabled = typed !== target;
}

async function handleConfirmDeleteBiz() {
  const biz = currentBiz();
  if (!biz) return;

  const typed = els.delBizConfirmInput.value.trim().toLowerCase();
  const target = biz.name.trim().toLowerCase();
  if (typed !== target) {
    toast("Nama usaha yang diketik tidak cocok.", "warn");
    return;
  }

  els.btnConfirmDeleteBiz.disabled = true;
  els.btnConfirmDeleteBiz.textContent = "Menghapus dari Firestore...";

  try {
    const bizIdToDelete = biz.id;
    const bizNameToDelete = biz.name;
    await deleteBusiness(bizIdToDelete);

    try {
      localStorage.removeItem(LAST_BIZ_KEY);
      localStorage.removeItem(OLD_LAST_BIZ_KEY);
    } catch (_) {}

    closeDeleteBizModal();
    toast(`Usaha "${bizNameToDelete}" berhasil dihapus permanen dari Firestore.`, "info", 5000);
  } catch (err) {
    console.error(err);
    toast("Gagal menghapus usaha dari Firestore.", "error");
    els.btnConfirmDeleteBiz.disabled = false;
    els.btnConfirmDeleteBiz.textContent = "Ya, Hapus Permanen";
  }
}

els.btnDeleteBiz?.addEventListener("click", openDeleteBizModal);
els.btnBvDeleteBiz?.addEventListener("click", () => {
  closeBurdenViewModal();
  openDeleteBizModal();
});
els.btnCloseDeleteBiz?.addEventListener("click", closeDeleteBizModal);
els.btnCancelDeleteBiz?.addEventListener("click", closeDeleteBizModal);
els.deleteBizModal?.addEventListener("click", (e) => {
  if (e.target === els.deleteBizModal) closeDeleteBizModal();
});
els.delBizConfirmInput?.addEventListener("input", handleDeleteBizConfirmInput);
els.btnConfirmDeleteBiz?.addEventListener("click", handleConfirmDeleteBiz);

/* ================================================================== */
/* Incidental Expense Logger Modal & Exports                           */
/* ================================================================== */

function openExpenseModal() {
  if (!state.currentId) {
    toast("Pilih atau buat usaha terlebih dahulu.", "warn");
    return;
  }
  if (els.expDate) els.expDate.value = new Date().toISOString().split("T")[0];
  if (els.expTitle) els.expTitle.value = "";
  if (els.expAmount) els.expAmount.value = "";
  if (els.expNotes) els.expNotes.value = "";
  const opexRadio = els.formExpense?.querySelector('input[name="expenseType"][value="opex"]');
  if (opexRadio) opexRadio.checked = true;
  if (els.expenseModal) {
    els.expenseModal.style.display = "flex";
    els.expTitle?.focus();
  }
}

function hideExpenseModal() {
  if (els.expenseModal) {
    els.expenseModal.style.display = "none";
  }
}

els.btnOpenDailySales?.addEventListener("click", () => openLogger(toYmd()));
els.btnOpenExpenseModal?.addEventListener("click", () => openExpenseModal());
els.btnCloseExpenseModal?.addEventListener("click", () => hideExpenseModal());
els.btnAddExpSec?.addEventListener("click", () => openExpenseModal());

els.expenseModal?.addEventListener("click", (e) => {
  if (e.target === els.expenseModal) hideExpenseModal();
});

els.formExpense?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.currentId) {
    toast("Pilih atau buat usaha terlebih dahulu.", "warn");
    return;
  }

  const title = (els.expTitle?.value || "").trim();
  const amount = Number(els.expAmount?.value) || 0;
  const date = els.expDate?.value || toYmd();
  const expenseType = els.formExpense?.querySelector('input[name="expenseType"]:checked')?.value || "opex";
  const notes = (els.expNotes?.value || "").trim();

  if (!title) {
    toast("Keterangan pengeluaran harus diisi.", "warn");
    return;
  }
  if (amount <= 0) {
    toast("Nominal pengeluaran harus lebih besar dari 0.", "warn");
    return;
  }

  let category = "other";
  if (expenseType === "capex") {
    category = "asset";
  } else {
    const tLower = title.toLowerCase();
    if (tLower.includes("servis") || tLower.includes("reparasi") || tLower.includes("perbaikan") || tLower.includes("bengkel")) {
      category = "maintenance";
    } else if (tLower.includes("beli") || tLower.includes("bahan") || tLower.includes("kemasan") || tLower.includes("sabun") || tLower.includes("perlengkapan")) {
      category = "supplies";
    }
  }

  const payload = {
    date,
    title,
    category,
    amount,
    expenseType,
    notes,
  };

  try {
    if (els.btnSaveExpense) {
      els.btnSaveExpense.disabled = true;
      els.btnSaveExpense.textContent = "Menyimpan…";
    }
    await addIncidentalExpense(state.currentId, payload);
    const b = currentBiz();
    if (b && payload.expenseType === "capex") {
      b.unrecoveredCapital = (Number(b.unrecoveredCapital) || 0) + Number(payload.amount);
      renderAll();
    }
    hideExpenseModal();
    els.formExpense?.reset();
    toast("Pengeluaran berhasil dicatat.", "success");
  } catch (err) {
    console.error("Error saving expense:", err);
    toast("Gagal mencatat pengeluaran: " + (err.message || err), "error");
  } finally {
    if (els.btnSaveExpense) {
      els.btnSaveExpense.disabled = false;
      els.btnSaveExpense.innerHTML = "Simpan Pengeluaran Kas &check;";
    }
  }
});

els.expenseRecords?.addEventListener("click", async (e) => {
  const btn = e.target.closest(".btn-delete-expense");
  if (!btn) return;
  const id = btn.dataset.id;
  const exp = state.expenses.find((x) => x.id === id);
  if (!id || !state.currentId) return;

  const desc = exp ? `${exp.title} (${formatRp(exp.amount)})` : "pengeluaran ini";
  if (!confirm(`Hapus ${desc}?`)) return;

  try {
    await deleteIncidentalExpense(state.currentId, id, exp);
    const b = currentBiz();
    if (b && exp && exp.expenseType === "capex") {
      b.unrecoveredCapital = Math.max(0, (Number(b.unrecoveredCapital) || 0) - Number(exp.amount));
      renderAll();
    }
    toast("Pengeluaran kas berhasil dihapus.", "success");
  } catch (err) {
    console.error("Error deleting expense:", err);
    toast("Gagal menghapus pengeluaran.", "error");
  }
});

els.btnExportMonth?.addEventListener("click", () => {
  const biz = currentBiz();
  if (!biz) return;
  const d = derive();
  if (!d) return;
  const filename = exportMonthCsv({
    business: biz,
    products: state.products,
    sales: state.sales,
    expenses: state.expenses,
    year: state.period.year,
    monthIndex0: state.period.month,
    dailyTarget: d.be.dailyTarget,
    burden: d.burden,
    summary: {
      ...d.rr,
      daysElapsed: d.incCalc.daysElapsed,
      proratedBurden: d.incCalc.proratedBurden,
      totalIncidentalOpex: d.totalIncidentalOpex,
      totalIncidentalCapex: d.totalIncidentalCapex,
      operatingNetProfit: d.incCalc.operatingNetProfit,
      netCashRemaining: d.incCalc.netCashRemaining,
      netProfitMonthToDate: d.incCalc.operatingNetProfit,
      projectedNet: d.rr.recorded > 0
        ? Math.round(d.rr.avgDailyGross * d.days - d.incCalc.totalOperatingBurden)
        : d.incCalc.operatingNetProfit,
    },
  });
  toast(`Mengunduh laporan: ${filename}`, "success");
});

els.btnExportExpenses?.addEventListener("click", () => {
  const biz = currentBiz();
  if (!biz) return;
  const filename = exportExpensesCsv({
    business: biz,
    expenses: state.expenses,
    year: state.period.year,
    monthIndex0: state.period.month,
  });
  toast(`Mengunduh pengeluaran kas: ${filename}`, "success");
});

/* ================================================================== */
/* List & Manage Capital Modal (CRUD List Modal)                      */
/* ================================================================== */

function openListCapitalModal() {
  const biz = currentBiz();
  if (!biz) {
    toast("Pilih atau buat usaha terlebih dahulu.", "warn");
    return;
  }

  const initialCapBurden = Math.round(
    capitalMonthlyBurden({
      capitalType: biz.capitalType,
      initialCapital: biz.initialCapital,
      loanDetails: biz.loanDetails,
      ownCapitalDetails: biz.ownCapitalDetails,
    })
  );
  const additions = biz.capitalAdditions || [];
  const additionsBurden = additions.reduce((s, a) => s + (Number(a.monthlyBurden) || 0), 0);
  const totalCapBurden = initialCapBurden + additionsBurden;

  if (els.lcmTotalCapital) els.lcmTotalCapital.textContent = formatRp(biz.initialCapital);
  if (els.lcmUnrecoveredCapital) els.lcmUnrecoveredCapital.textContent = formatRp(biz.unrecoveredCapital);
  if (els.lcmMonthlyBurden) els.lcmMonthlyBurden.textContent = formatRp(totalCapBurden) + " / bln";

  // Section 1: Modal Awal
  let initHtml = "";
  if (biz.capitalType === "loan" && biz.loanDetails) {
    initHtml = `
      <div class="cap-row">
        <span class="cap-label">Jenis Modal Awal</span>
        <span class="cap-val">🏦 Pinjaman Bank / Modal Luar</span>
      </div>
      <div class="cap-row">
        <span class="cap-label">Pokok Pinjaman</span>
        <span class="cap-val">${formatRp(biz.initialCapital)}</span>
      </div>
      <div class="cap-row">
        <span class="cap-label">Tenor &amp; Bunga</span>
        <span class="cap-val">${num(biz.loanDetails.tenorMonths)} bulan @ ${num(biz.loanDetails.annualInterestRatePct)}% p.a.</span>
      </div>
      <div class="cap-row">
        <span class="cap-label">Cicilan Bulanan</span>
        <span class="cap-val" style="color: #38bdf8;">${formatRp(initialCapBurden)} / bulan</span>
      </div>
    `;
  } else if (biz.capitalType === "own" && num(biz.initialCapital) > 0) {
    const payback = biz.ownCapitalDetails?.targetPaybackMonths || 1;
    initHtml = `
      <div class="cap-row">
        <span class="cap-label">Jenis Modal Awal</span>
        <span class="cap-val">💰 Modal Sendiri</span>
      </div>
      <div class="cap-row">
        <span class="cap-label">Modal Awal</span>
        <span class="cap-val">${formatRp(biz.initialCapital)}</span>
      </div>
      <div class="cap-row">
        <span class="cap-label">Target Balik Modal</span>
        <span class="cap-val">${payback} bulan</span>
      </div>
      <div class="cap-row">
        <span class="cap-label">Alokasi Cicilan Modal</span>
        <span class="cap-val" style="color: #38bdf8;">${formatRp(initialCapBurden)} / bulan</span>
      </div>
    `;
  } else {
    initHtml = `<p class="muted" style="margin: 0; font-size: 0.85rem;">Tidak ada alokasi cicilan modal awal khusus.</p>`;
  }
  if (els.lcmInitialCapitalCard) els.lcmInitialCapitalCard.innerHTML = initHtml;

  // Section 2: Tambahan Modal & Investasi
  if (additions.length > 0) {
    if (els.lcmAdditionsEmpty) els.lcmAdditionsEmpty.style.display = "none";
    if (els.lcmAdditionsList) {
      els.lcmAdditionsList.innerHTML = additions
        .map((it) => {
          let schemeDesc = "";
          let icon = "💰";
          let typeBadge = "Modal Sendiri";
          if (it.type === "invest") {
            icon = "🤝";
            typeBadge = "Investasi";
            if (it.returnType === "dynamic") {
              schemeDesc = `Bagi hasil dinamis ${it.dynamicProfitPct}% dari laba${it.monthlyBurden > 0 ? ` · cicilan ${formatRp(it.monthlyBurden)}/bln` : " · tanpa beban rutin"}`;
            } else {
              schemeDesc = `Imbal hasil tetap ${it.fixedReturnPct}%/bln${it.tenorMonths > 0 ? ` · tenor ${it.tenorMonths} bln` : ""} · beban ${formatRp(it.monthlyBurden)}/bln`;
            }
          } else if (it.type === "loan") {
            icon = "🏦";
            typeBadge = "Pinjaman";
            schemeDesc = `Pinjaman · tenor ${it.tenorMonths} bln @ ${it.annualInterestRatePct}% · cicilan ${formatRp(it.monthlyBurden)}/bln`;
          } else {
            icon = "💰";
            typeBadge = "Modal Sendiri";
            schemeDesc = `Modal sendiri${it.paybackMonths > 0 ? ` · target ${it.paybackMonths} bln · alokasi ${formatRp(it.monthlyBurden)}/bln` : " · tanpa cicilan"}`;
          }

          return `
            <div class="burden-item" data-id="${esc(it.id)}" style="background: rgba(15, 23, 42, 0.6); margin-bottom: 8px; padding: 10px 12px; border-radius: 8px; border: 1px solid #334155;">
              <div class="burden-item-info">
                <div style="display: flex; align-items: center; gap: 6px;">
                  <strong>${icon} ${esc(it.name || "Tambahan Modal")}</strong>
                  <span class="badge badge--low" style="font-size: 0.7rem; padding: 2px 7px;">${typeBadge}</span>
                </div>
                <small style="color: #94a3b8; margin-top: 2px; display: block;">${formatRp(it.amount)} · ${schemeDesc}</small>
              </div>
              <div class="burden-item-action" style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
                <span class="burden-item-val" style="color: ${it.monthlyBurden > 0 ? "#38bdf8" : "#94a3b8"}; font-weight: 700;">
                  ${it.monthlyBurden > 0 ? `${formatRp(it.monthlyBurden)}/bln` : "Rp 0"}
                </span>
                <button type="button" class="btn-edit-cost btn-edit-capital-add" data-id="${esc(it.id)}" title="Ubah modal ini" style="font-size: 0.85rem; padding: 3px 6px;">✏️</button>
                <button type="button" class="btn-delete-cost btn-delete-capital-add" data-id="${esc(it.id)}" title="Hapus modal ini" style="font-size: 0.85rem; padding: 3px 6px;">🗑️</button>
              </div>
            </div>
          `;
        })
        .join("");
    }
  } else {
    if (els.lcmAdditionsList) els.lcmAdditionsList.innerHTML = "";
    if (els.lcmAdditionsEmpty) els.lcmAdditionsEmpty.style.display = "block";
  }

  if (els.listCapitalModal) els.listCapitalModal.style.display = "flex";
  document.body.classList.add("is-modal");
}

function closeListCapitalModal() {
  if (els.listCapitalModal) els.listCapitalModal.style.display = "none";
  document.body.classList.remove("is-modal");
}

let editingCapitalAdditionId = null;

function openEditCapitalAdditionModal(additionId) {
  const biz = currentBiz();
  if (!biz) return;
  const addition = (biz.capitalAdditions || []).find((a) => a.id === additionId);
  if (!addition) {
    toast("Data modal tidak ditemukan.", "warn");
    return;
  }

  editingCapitalAdditionId = additionId;
  if (els.ecaName) els.ecaName.value = addition.name || "";
  if (els.ecaAmount) els.ecaAmount.value = addition.amount || "";

  const type = addition.type || "invest";
  let typeLabel = "🤝 Investasi (Bagi Hasil / Imbal Hasil)";
  if (type === "own") typeLabel = "💰 Modal Sendiri (Owner Equity)";
  if (type === "loan") typeLabel = "🏦 Pinjaman Bank";
  if (els.ecaTypeBadge) els.ecaTypeBadge.textContent = typeLabel;

  if (els.ecaInvestFields) els.ecaInvestFields.style.display = type === "invest" ? "block" : "none";
  if (els.ecaOwnFields) els.ecaOwnFields.style.display = type === "own" ? "block" : "none";
  if (els.ecaLoanFields) els.ecaLoanFields.style.display = type === "loan" ? "block" : "none";

  if (type === "invest") {
    const isDynamic = addition.returnType !== "fixed";
    if (els.ecaDynamicBox) els.ecaDynamicBox.style.display = isDynamic ? "block" : "none";
    if (els.ecaFixedBox) els.ecaFixedBox.style.display = isDynamic ? "none" : "block";
    if (els.ecaDynamicPct) els.ecaDynamicPct.value = addition.dynamicProfitPct || 15;
    if (els.ecaFixedPct) els.ecaFixedPct.value = addition.fixedReturnPct || 2;
    if (els.ecaTenor) els.ecaTenor.value = addition.tenorMonths || "";
  } else if (type === "own") {
    if (els.ecaPayback) els.ecaPayback.value = addition.paybackMonths || 12;
  } else if (type === "loan") {
    if (els.ecaLoanTenor) els.ecaLoanTenor.value = addition.tenorMonths || 12;
    if (els.ecaLoanInterest) els.ecaLoanInterest.value = addition.annualInterestRatePct || 10;
  }

  if (els.editCapitalAdditionModal) els.editCapitalAdditionModal.style.display = "flex";
  document.body.classList.add("is-modal");
  setTimeout(() => els.ecaName?.focus(), 80);
}

function closeEditCapitalAdditionModal() {
  if (els.editCapitalAdditionModal) els.editCapitalAdditionModal.style.display = "none";
  document.body.classList.remove("is-modal");
}

els.btnListModal?.addEventListener("click", openListCapitalModal);
els.btnCloseListCapital?.addEventListener("click", closeListCapitalModal);
els.btnLcmClose?.addEventListener("click", closeListCapitalModal);
els.listCapitalModal?.addEventListener("click", (e) => {
  if (e.target === els.listCapitalModal) closeListCapitalModal();
});
els.btnLcmEditInitial?.addEventListener("click", () => {
  closeListCapitalModal();
  openEditCapitalModal();
});
els.btnLcmAddCapital?.addEventListener("click", () => {
  closeListCapitalModal();
  openAddCapitalModal();
});

els.lcmAdditionsList?.addEventListener("click", async (e) => {
  const editBtn = e.target.closest(".btn-edit-capital-add");
  if (editBtn) {
    const id = editBtn.dataset.id;
    if (id) openEditCapitalAdditionModal(id);
    return;
  }
  const delBtn = e.target.closest(".btn-delete-capital-add");
  if (delBtn) {
    const id = delBtn.dataset.id;
    const biz = currentBiz();
    if (!biz || !id) return;
    const item = (biz.capitalAdditions || []).find((a) => a.id === id);
    const itemName = item ? item.name : "modal ini";
    if (!confirm(`Hapus ${itemName}? Sisa modal dan beban bulanan akan disesuaikan.`)) return;

    try {
      const res = await removeCapitalAddition(biz.id, id);
      if (res && res.capitalAdditions) {
        biz.capitalAdditions = res.capitalAdditions;
        biz.initialCapital = res.initialCapital;
        biz.unrecoveredCapital = res.unrecoveredCapital;
        biz.monthlyFixedBurden = res.monthlyFixedBurden;
      }
      renderAll();
      openListCapitalModal();
      toast(`Tambahan modal "${itemName}" berhasil dihapus.`, "info");
    } catch (err) {
      console.error(err);
      toast("Gagal menghapus modal.", "error");
    }
  }
});

els.btnCloseEditCapAdd?.addEventListener("click", closeEditCapitalAdditionModal);
els.btnCancelEditCapAdd?.addEventListener("click", closeEditCapitalAdditionModal);
els.editCapitalAdditionModal?.addEventListener("click", (e) => {
  if (e.target === els.editCapitalAdditionModal) closeEditCapitalAdditionModal();
});

els.formEditCapitalAddition?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const biz = currentBiz();
  if (!biz || !editingCapitalAdditionId) return;

  const addition = (biz.capitalAdditions || []).find((a) => a.id === editingCapitalAdditionId);
  if (!addition) return;

  const name = (els.ecaName.value || "").trim();
  const amount = Number(els.ecaAmount.value) || 0;
  if (!name) {
    toast("Nama sumber modal harus diisi.", "warn");
    return;
  }
  if (amount <= 0) {
    toast("Nominal modal harus lebih besar dari 0.", "warn");
    return;
  }

  const payload = {
    name,
    amount,
    type: addition.type,
    returnType: addition.returnType,
    fixedReturnPct: Number(els.ecaFixedPct?.value) || 0,
    dynamicProfitPct: Number(els.ecaDynamicPct?.value) || 0,
    tenorMonths: addition.type === "loan" ? Number(els.ecaLoanTenor?.value) || 0 : Number(els.ecaTenor?.value) || 0,
    paybackMonths: Number(els.ecaPayback?.value) || 0,
    annualInterestRatePct: Number(els.ecaLoanInterest?.value) || 0,
  };

  try {
    if (els.btnSaveEditCapAdd) {
      els.btnSaveEditCapAdd.disabled = true;
      els.btnSaveEditCapAdd.textContent = "Menyimpan…";
    }
    const res = await updateCapitalAddition(biz.id, editingCapitalAdditionId, payload);
    if (res && res.capitalAdditions) {
      biz.capitalAdditions = res.capitalAdditions;
      biz.initialCapital = res.initialCapital;
      biz.unrecoveredCapital = res.unrecoveredCapital;
      biz.monthlyFixedBurden = res.monthlyFixedBurden;
    }
    renderAll();
    closeEditCapitalAdditionModal();
    openListCapitalModal();
    toast("Perubahan modal berhasil disimpan ✓", "success");
  } catch (err) {
    console.error(err);
    toast("Gagal mengubah modal: " + (err.message || err), "error");
  } finally {
    if (els.btnSaveEditCapAdd) {
      els.btnSaveEditCapAdd.disabled = false;
      els.btnSaveEditCapAdd.textContent = "Simpan Perubahan Modal ✓";
    }
  }
});

/* ================================================================== */
/* Floating Action Button (FAB) Speed Dial Wiring                      */
/* ================================================================== */

function toggleFabMenu(force) {
  if (!els.fabMenu || !els.fabMain) return;
  const isCurrentlyOpen = els.fabMenu.style.display !== "none";
  const shouldOpen = force !== undefined ? force : !isCurrentlyOpen;

  if (shouldOpen) {
    els.fabMenu.style.display = "flex";
    els.fabMain.classList.add("is-active");
    els.fabMain.setAttribute("aria-expanded", "true");
  } else {
    els.fabMenu.style.display = "none";
    els.fabMain.classList.remove("is-active");
    els.fabMain.setAttribute("aria-expanded", "false");
  }
}

function closeFabMenu() {
  toggleFabMenu(false);
}

els.fabMain?.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleFabMenu();
});

els.fabOptSale?.addEventListener("click", (e) => {
  e.stopPropagation();
  closeFabMenu();
  openLogger(toYmd());
});

els.fabOptExpense?.addEventListener("click", (e) => {
  e.stopPropagation();
  closeFabMenu();
  openExpenseModal();
});

document.addEventListener("click", (e) => {
  if (els.fabContainer && !els.fabContainer.contains(e.target)) {
    closeFabMenu();
  }
});

/* ================================================================== */
/* Network pill + Service Worker                                       */
/* ================================================================== */

function updateNetPill() {
  const online = navigator.onLine;
  els.netPill.textContent = online ? "Online" : "Offline";
  els.netPill.className = `pill ${online ? "pill--online" : "pill--offline"}`;
  els.netPill.title = online
    ? "Terhubung. Data tersinkron otomatis."
    : "Offline. Data disimpan di perangkat dan disinkronkan saat online.";
}
window.addEventListener("online", () => {
  updateNetPill();
  toast("Kembali online — data disinkronkan", "success");
});
window.addEventListener("offline", () => {
  updateNetPill();
  toast("Mode offline — data tetap tersimpan", "warn");
});
updateNetPill();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("[SW] register failed", err));
  });
}

/* ================================================================== */
/* Boot                                                                */
/* ================================================================== */

subscribeBusinesses(handleBusinessesChanged, (err) => {
  console.error(err);
  hideSplash();
  toast("Gagal membaca data usaha. Periksa konfigurasi Firebase.", "error", 6000);
  if (state.businesses.length === 0 && !wizard.isOpen()) openWizard(false);
});

window.__bizmetricBooted = true;
window.__bisniskuBooted = true;
