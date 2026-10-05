/**
 * Bisnisku — wizard.js
 * Multi-step, one-question-per-screen business setup.
 * Steps: status → name → capital → opex → products → review/submit.
 */
import {
  num,
  clamp,
  toMonthly,
  totalMonthlyOpex,
  loanBreakdown,
  monthlyBurden,
  capitalMonthlyBurden,
  suggestPrice,
  marginPct,
  breakEven,
  wacmr,
  formatRp,
  formatNumber,
  escapeHtml as esc,
} from "./calculator.js";
import { createBusiness } from "./db.js";

const STEPS = ["status", "name", "capital", "opex", "products", "review"];
const FREQ_LABEL = { daily: "Harian", monthly: "Bulanan", yearly: "Tahunan" };

let rowSeq = 0;
const rid = () => `r${++rowSeq}`;

const newOpex = () => ({ id: rid(), name: "", amount: "", frequency: "monthly" });
const newProduct = () => ({
  id: rid(),
  name: "",
  cogs: "",
  margin: 50,
  price: "",
  salesSharePct: "100",
});

function freshState() {
  return {
    step: 0,
    status: null, // "new" | "existing"
    name: "",
    capitalAmount: "",
    unrecovered: "",
    capitalType: "own", // "own" | "loan"
    payback: 12,
    tenor: 12,
    rate: 12,
    opex: [newOpex()],
    products: [newProduct()],
  };
}

/**
 * @param {Object} opts
 * @param {(businessId:string)=>void} opts.onComplete
 * @param {()=>void} [opts.onCancel]
 * @param {(err:Error)=>void} [opts.onSaveError]
 */
export function createWizard({ onComplete, onCancel, onSaveError }) {
  const view = document.getElementById("wizard-view");
  const stage = document.getElementById("wz-stage");
  const btnNext = document.getElementById("wz-next");
  const btnBack = document.getElementById("wz-back");
  const btnCancel = document.getElementById("wz-cancel");
  const hint = document.getElementById("wz-hint");
  const stepLabel = document.getElementById("wz-step-label");
  const progress = document.getElementById("wz-progress");
  const progressBar = document.getElementById("wz-progress-bar");

  let s = freshState();
  let canCancel = false;
  let direction = "fwd";
  let saving = false;

  /* ------------------------------------------------------------ */
  /* Derived numbers                                               */
  /* ------------------------------------------------------------ */

  const capital = () => num(s.capitalAmount);

  function capitalInfo() {
    return {
      capitalType: s.capitalType,
      initialCapital: capital(),
      loanDetails: {
        tenorMonths: num(s.tenor),
        annualInterestRatePct: num(s.rate),
      },
      ownCapitalDetails: { targetPaybackMonths: num(s.payback) },
    };
  }

  const opexMonthly = () =>
    totalMonthlyOpex(s.opex.map((o) => ({ amount: o.amount, frequency: o.frequency })));
  const burden = () => monthlyBurden(opexMonthly(), capitalInfo());
  const productsForCalc = () =>
    s.products.map((p) => ({
      id: p.id,
      name: p.name.trim(),
      cogs: num(p.cogs),
      price: num(p.price),
      salesSharePct: num(p.salesSharePct),
    }));
  const shareTotal = () => s.products.reduce((sum, p) => sum + num(p.salesSharePct), 0);

  /* ------------------------------------------------------------ */
  /* Validation (returns "" when OK)                               */
  /* ------------------------------------------------------------ */

  function validate(stepIndex) {
    switch (STEPS[stepIndex]) {
      case "status":
        return s.status ? "" : "Pilih salah satu untuk melanjutkan.";
      case "name":
        return s.name.trim() ? "" : "Isi nama usaha Anda.";
      case "capital": {
        if (s.capitalAmount === "" || capital() < 0) return "Isi jumlah modal (boleh 0 jika tanpa modal).";
        if (s.capitalType === "loan") {
          if (capital() <= 0) return "Jumlah pinjaman harus lebih dari 0.";
          if (num(s.tenor) < 1) return "Tenor minimal 1 bulan.";
          if (num(s.rate) < 0) return "Bunga tidak boleh negatif.";
        }
        return "";
      }
      case "opex": {
        for (const o of s.opex) {
          const hasAny = o.name.trim() || o.amount !== "";
          if (hasAny && (!o.name.trim() || num(o.amount) <= 0)) {
            return "Lengkapi nama & nominal setiap biaya, atau hapus baris kosong.";
          }
        }
        return burden() > 0 ? "" : "Beban bulanan masih Rp 0 — tambahkan biaya rutin atau modal.";
      }
      case "products": {
        if (s.products.length === 0) return "Tambahkan minimal 1 produk.";
        for (const p of s.products) {
          if (!p.name.trim()) return "Setiap produk perlu nama.";
          if (num(p.cogs) <= 0) return `Isi HPP untuk "${p.name.trim() || "produk"}".`;
          if (num(p.price) <= num(p.cogs)) return `Harga "${p.name.trim()}" harus lebih besar dari HPP.`;
          if (num(p.salesSharePct) <= 0) return `Porsi penjualan "${p.name.trim()}" harus > 0%.`;
        }
        if (Math.abs(shareTotal() - 100) > 0.01) {
          return `Total porsi penjualan harus 100% (sekarang ${+shareTotal().toFixed(1)}%).`;
        }
        return "";
      }
      default:
        return "";
    }
  }

  /* ------------------------------------------------------------ */
  /* Step templates                                                */
  /* ------------------------------------------------------------ */

  const title = (t, d) =>
    `<h2 class="step__title">${t}</h2>${d ? `<p class="step__desc">${d}</p>` : ""}`;

  function tplStatus() {
    const card = (value, icon, name, desc) => `
      <button type="button" class="choice ${s.status === value ? "is-selected" : ""}"
              data-action="pick-status" data-value="${value}" aria-pressed="${s.status === value}">
        <span class="choice__icon" aria-hidden="true">${icon}</span>
        <span class="choice__name">${name}</span>
        <span class="choice__desc">${desc}</span>
      </button>`;
    return `
      ${title("Bagaimana kondisi usaha Anda?", "Pilih yang paling sesuai. Anda bisa menambah usaha lain kapan saja.")}
      <div class="choice-grid">
        ${card("new", "🌱", "Bisnis Baru", "Baru akan dimulai atau baru berjalan beberapa waktu.")}
        ${card("existing", "🏪", "Bisnis Sudah Berjalan", "Sudah beroperasi dan ingin memantau balik modal.")}
      </div>`;
  }

  function tplName() {
    return `
      ${title("Apa nama usaha Anda?", "Langsung mulai — tanpa daftar, tanpa login.")}
      <div class="field">
        <label for="wz-name" class="sr-only">Nama usaha</label>
        <input id="wz-name" class="input input--xl" type="text" maxlength="60" autocomplete="off"
               placeholder="mis. Kopi Bahagia" value="${esc(s.name)}" data-f="name" />
      </div>`;
  }

  function tplCapital() {
    const own = s.capitalType === "own";
    const typeCard = (value, icon, name, desc) => `
      <button type="button" class="choice choice--sm ${s.capitalType === value ? "is-selected" : ""}"
              data-action="pick-captype" data-value="${value}" role="radio" aria-checked="${s.capitalType === value}">
        <span class="choice__icon" aria-hidden="true">${icon}</span>
        <span class="choice__name">${name}</span>
        <span class="choice__desc">${desc}</span>
      </button>`;
    return `
      ${title("Berapa modal usaha Anda?", "Modal dipakai untuk menghitung beban bulanan balik modal.")}
      <div class="field">
        <label for="wz-capital">Jumlah modal (Rp)</label>
        <input id="wz-capital" class="input input--xl" type="number" inputmode="numeric" min="0" step="any"
               placeholder="mis. 25000000" value="${esc(s.capitalAmount)}" data-f="capitalAmount" />
        <small class="field__note" id="cap-preview"></small>
      </div>

      ${
        s.status === "existing"
          ? `<div class="field">
               <label for="wz-unrecovered">Modal yang belum kembali (Rp)</label>
               <input id="wz-unrecovered" class="input" type="number" inputmode="numeric" min="0" step="any"
                      placeholder="Kosongkan jika sama dengan modal" value="${esc(s.unrecovered)}" data-f="unrecovered" />
             </div>`
          : ""
      }

      <div class="field">
        <span class="field__label" id="cap-type-label">Sumber modal</span>
        <div class="choice-grid" role="radiogroup" aria-labelledby="cap-type-label">
          ${typeCard("own", "💰", "Modal Sendiri", "Target balik modal dalam beberapa bulan.")}
          ${typeCard("loan", "🏦", "Pinjaman", "Cicilan bulanan dengan bunga flat.")}
        </div>
      </div>

      ${
        own
          ? `<div class="field panel">
               <label for="wz-payback">Target balik modal: <strong id="payback-out">${num(s.payback)} bulan</strong></label>
               <input id="wz-payback" class="range" type="range" min="6" max="36" step="1" value="${num(s.payback)}" data-f="payback" />
               <div class="range-scale"><span>6 bln</span><span>36 bln</span></div>
             </div>`
          : `<div class="field panel panel--grid">
               <div>
                 <label for="wz-tenor">Tenor (bulan)</label>
                 <input id="wz-tenor" class="input" type="number" inputmode="numeric" min="1" max="360" value="${esc(s.tenor)}" data-f="tenor" />
               </div>
               <div>
                 <label for="wz-rate">Bunga tahunan (%)</label>
                 <input id="wz-rate" class="input" type="number" inputmode="decimal" min="0" step="any" value="${esc(s.rate)}" data-f="rate" />
               </div>
               <small class="field__note panel__wide" id="loan-preview"></small>
             </div>`
      }`;
  }

  function opexRow(o) {
    return `
      <div class="list-row" data-row="${o.id}" data-kind="opex">
        <div class="list-row__main">
          <input class="input" type="text" maxlength="50" placeholder="mis. Sewa tempat" aria-label="Nama biaya"
                 value="${esc(o.name)}" data-f="name" />
          <input class="input" type="number" inputmode="numeric" min="0" step="any" placeholder="Nominal (Rp)"
                 aria-label="Nominal biaya" value="${esc(o.amount)}" data-f="amount" />
          <select class="input" aria-label="Frekuensi biaya" data-f="frequency">
            ${Object.entries(FREQ_LABEL)
              .map(([v, l]) => `<option value="${v}" ${o.frequency === v ? "selected" : ""}>${l}</option>`)
              .join("")}
          </select>
        </div>
        <div class="list-row__foot">
          <span class="muted eq">${monthlyEqText(o)}</span>
          <button type="button" class="link-btn link-btn--danger" data-action="remove-row" aria-label="Hapus biaya">Hapus</button>
        </div>
      </div>`;
  }

  const monthlyEqText = (o) =>
    num(o.amount) > 0 ? `≈ ${formatRp(toMonthly(o.amount, o.frequency))} / bulan` : "≈ Rp 0 / bulan";

  function tplOpex() {
    return `
      ${title("Biaya rutin apa saja?", "Sewa, listrik, gaji, internet, dll. Pilih frekuensinya — kami ubah ke bulanan otomatis.")}
      <div id="opex-list" class="list">${s.opex.map(opexRow).join("")}</div>
      <button type="button" class="btn btn--ghost btn--block" data-action="add-opex">＋ Tambah biaya</button>
      <div class="preview-box">
        <span>Total biaya rutin</span>
        <strong id="opex-total">${formatRp(opexMonthly())} / bulan</strong>
      </div>`;
  }

  function productRow(p, index) {
    return `
      <div class="product" data-row="${p.id}" data-kind="product">
        <div class="product__head">
          <span class="product__no">Produk ${index + 1}</span>
          ${
            s.products.length > 1
              ? `<button type="button" class="link-btn link-btn--danger" data-action="remove-row" aria-label="Hapus produk">Hapus</button>`
              : ""
          }
        </div>
        <div class="product__grid">
          <div class="field product__wide">
            <label>Nama produk</label>
            <input class="input" type="text" maxlength="50" placeholder="mis. Kopi Susu" value="${esc(p.name)}" data-f="name" />
          </div>
          <div class="field">
            <label>HPP / modal per unit (Rp)</label>
            <input class="input" type="number" inputmode="numeric" min="0" step="any" placeholder="7000" value="${esc(p.cogs)}" data-f="cogs" />
          </div>
          <div class="field">
            <label>Porsi penjualan (%)</label>
            <input class="input" type="number" inputmode="decimal" min="0" max="100" step="any" value="${esc(p.salesSharePct)}" data-f="salesSharePct" />
          </div>
          <div class="field product__wide">
            <label>Target margin: <strong class="margin-out"></strong></label>
            <input class="range" type="range" min="20" max="85" step="1" value="${p.margin}" data-f="margin" aria-label="Target margin" />
            <div class="range-scale"><span>20%</span><span>85%</span></div>
          </div>
          <div class="field product__wide">
            <label>Harga jual (Rp)</label>
            <input class="input" type="number" inputmode="numeric" min="0" step="any" value="${esc(p.price)}" data-f="price" />
            <small class="field__note price-hint"></small>
          </div>
        </div>
      </div>`;
  }

  function tplProducts() {
    return `
      ${title("Apa saja produk Anda?", "Atur margin — harga rekomendasi dihitung otomatis. Isi porsi penjualan agar totalnya 100%.")}
      <div id="product-list" class="list">${s.products.map(productRow).join("")}</div>
      <div class="product-actions">
        <button type="button" class="btn btn--ghost" data-action="add-product">＋ Tambah produk</button>
        <button type="button" class="btn btn--ghost" data-action="split-share">⚖️ Bagi rata porsi</button>
      </div>
      <div class="preview-box" id="share-box"><span>Total porsi penjualan</span><strong id="share-total"></strong></div>`;
  }

  function tplReview() {
    const b = burden();
    const be = breakEven({ burden: b, products: productsForCalc() });
    const capBurden = capitalMonthlyBurden(capitalInfo());
    return `
      ${title("Siap dimulai! 🎉", "Periksa ringkasan di bawah, lalu simpan.")}
      <div class="summary">
        <div class="summary__row"><span>Usaha</span><strong>${esc(s.name.trim())}</strong></div>
        <div class="summary__row"><span>Status</span><strong>${s.status === "new" ? "Bisnis Baru" : "Bisnis Sudah Berjalan"}</strong></div>
        <div class="summary__row"><span>Modal</span><strong>${formatRp(capital())} · ${s.capitalType === "own" ? `sendiri, target ${num(s.payback)} bln` : `pinjaman ${num(s.tenor)} bln @ ${num(s.rate)}%`}</strong></div>
        <div class="summary__row"><span>Biaya rutin</span><strong>${formatRp(opexMonthly())} / bln</strong></div>
        <div class="summary__row"><span>${s.capitalType === "own" ? "Cicilan balik modal" : "Cicilan pinjaman"}</span><strong>${formatRp(capBurden)} / bln</strong></div>
        <div class="summary__row summary__row--total"><span>Beban bulanan</span><strong>${formatRp(b)}</strong></div>
      </div>
      <div class="summary summary--accent">
        <div class="summary__row"><span>Margin rata-rata tertimbang</span><strong>${(wacmr(productsForCalc()) * 100).toFixed(1)}%</strong></div>
        <div class="summary__row"><span>Target BEP bulanan</span><strong>${formatRp(be.monthlyTarget)}</strong></div>
        <div class="summary__row summary__row--total"><span>Target BEP harian</span><strong>${formatRp(be.dailyTarget)}</strong></div>
        ${be.perProduct
          .map((p) => `<div class="summary__row summary__row--sub"><span>${esc(p.name)}</span><strong>≥ ${formatNumber(p.targetQty)} terjual / hari</strong></div>`)
          .join("")}
      </div>`;
  }

  const TEMPLATES = {
    status: tplStatus,
    name: tplName,
    capital: tplCapital,
    opex: tplOpex,
    products: tplProducts,
    review: tplReview,
  };

  /* ------------------------------------------------------------ */
  /* Rendering                                                     */
  /* ------------------------------------------------------------ */

  function render() {
    const key = STEPS[s.step];
    stage.innerHTML = `<div class="step step--${direction}">${TEMPLATES[key]()}</div>`;
    stepLabel.textContent = `Langkah ${s.step + 1} dari ${STEPS.length}`;
    const pct = ((s.step + 1) / STEPS.length) * 100;
    progressBar.style.width = pct + "%";
    progress.setAttribute("aria-valuenow", String(Math.round(pct)));
    btnBack.style.visibility = s.step === 0 ? "hidden" : "visible";
    btnCancel.style.visibility = canCancel ? "visible" : "hidden";
    btnNext.textContent = key === "review" ? "Simpan & Mulai ✓" : "Lanjut →";
    btnNext.style.display = key === "status" ? "none" : "";

    if (key === "products") s.products.forEach((p) => syncProductRow(p, stage.querySelector(`[data-row="${p.id}"]`)));
    refreshDerived();
    updateNav();

    // Focus first text input for fast typing (not on touch-range steps).
    const first = stage.querySelector('input[type="text"], input[type="number"]');
    if (first && (key === "name" || key === "capital")) setTimeout(() => first.focus({ preventScroll: true }), 220);
    window.scrollTo({ top: 0 });
  }

  function refreshDerived() {
    const key = STEPS[s.step];
    if (key === "capital") {
      const prev = stage.querySelector("#cap-preview");
      if (prev) prev.textContent = s.capitalAmount !== "" ? `= ${formatRp(capital())}` : "";
      const out = stage.querySelector("#payback-out");
      if (out) out.textContent = `${num(s.payback)} bulan`;
      const lp = stage.querySelector("#loan-preview");
      if (lp) {
        const l = loanBreakdown({ capital: capital(), tenorMonths: s.tenor, annualInterestRatePct: s.rate });
        lp.textContent = `Cicilan flat: pokok ${formatRp(l.principal)} + bunga ${formatRp(l.interest)} = ${formatRp(l.installment)} / bulan`;
      }
    } else if (key === "opex") {
      const t = stage.querySelector("#opex-total");
      if (t) t.textContent = `${formatRp(opexMonthly())} / bulan`;
    } else if (key === "products") {
      const t = stage.querySelector("#share-total");
      const box = stage.querySelector("#share-box");
      if (t) {
        const total = shareTotal();
        const ok = Math.abs(total - 100) <= 0.01;
        t.textContent = `${+total.toFixed(1)}% ${ok ? "✓" : ""}`;
        box.classList.toggle("is-ok", ok);
        box.classList.toggle("is-bad", !ok);
      }
    }
  }

  function updateNav() {
    const err = validate(s.step);
    btnNext.disabled = !!err || saving;
    hint.textContent = err;
    hint.classList.toggle("is-visible", !!err);
  }

  /* ------------------------------------------------------------ */
  /* Product row helpers                                           */
  /* ------------------------------------------------------------ */

  function priceFromMargin(p) {
    const v = suggestPrice(num(p.cogs), p.margin);
    p.price = v > 0 ? String(v) : "";
  }

  function syncProductRow(p, row, activeField) {
    if (!row) return;
    const price = num(p.price);
    const cogs = num(p.cogs);
    const actual = marginPct(price, cogs);

    if (activeField !== "price") row.querySelector('[data-f="price"]').value = p.price;
    if (activeField === "price" && price > 0) {
      p.margin = clamp(Math.round(actual), 20, 85);
      row.querySelector('[data-f="margin"]').value = p.margin;
    }
    row.querySelector(".margin-out").textContent =
      price > 0 ? `${actual.toFixed(1)}%` : `${p.margin}%`;

    const rec = suggestPrice(cogs, p.margin);
    const hintEl = row.querySelector(".price-hint");
    if (cogs <= 0) {
      hintEl.textContent = "Isi HPP untuk melihat harga rekomendasi.";
      hintEl.classList.remove("is-bad");
    } else if (price <= cogs) {
      hintEl.textContent = `Harga harus di atas HPP. Rekomendasi: ${formatRp(rec)}`;
      hintEl.classList.add("is-bad");
    } else {
      hintEl.textContent = `Rekomendasi ${formatRp(rec)} · laba ${formatRp(price - cogs)} / unit`;
      hintEl.classList.remove("is-bad");
    }
  }

  function splitShareEvenly() {
    const n = s.products.length;
    const base = Math.floor(100 / n);
    let remainder = 100 - base * n;
    s.products.forEach((p) => {
      p.salesSharePct = String(base + (remainder-- > 0 ? 1 : 0));
    });
  }

  /* ------------------------------------------------------------ */
  /* Events                                                        */
  /* ------------------------------------------------------------ */

  function go(delta) {
    direction = delta > 0 ? "fwd" : "back";
    s.step = clamp(s.step + delta, 0, STEPS.length - 1);
    render();
  }

  stage.addEventListener("input", (e) => {
    const t = e.target;
    const f = t.dataset.f;
    if (!f) return;
    const row = t.closest("[data-row]");

    if (row) {
      const id = row.dataset.row;
      if (row.dataset.kind === "opex") {
        const o = s.opex.find((x) => x.id === id);
        if (!o) return;
        o[f] = t.value;
        row.querySelector(".eq").textContent = monthlyEqText(o);
      } else {
        const p = s.products.find((x) => x.id === id);
        if (!p) return;
        if (f === "margin") {
          p.margin = Number(t.value);
          priceFromMargin(p);
        } else if (f === "cogs") {
          p.cogs = t.value;
          priceFromMargin(p);
        } else {
          p[f] = t.value;
        }
        syncProductRow(p, row, f);
      }
    } else {
      s[f] = t.value;
    }
    refreshDerived();
    updateNav();
  });

  // <select> inside opex rows
  stage.addEventListener("change", (e) => {
    const t = e.target;
    if (t.tagName !== "SELECT") return;
    const row = t.closest("[data-row]");
    const o = row && s.opex.find((x) => x.id === row.dataset.row);
    if (!o) return;
    o.frequency = t.value;
    row.querySelector(".eq").textContent = monthlyEqText(o);
    refreshDerived();
    updateNav();
  });

  stage.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;

    switch (action) {
      case "pick-status":
        s.status = btn.dataset.value;
        stage.querySelectorAll('[data-action="pick-status"]').forEach((b) => {
          const on = b === btn;
          b.classList.toggle("is-selected", on);
          b.setAttribute("aria-pressed", String(on));
        });
        updateNav();
        setTimeout(() => go(1), 220);
        break;
      case "pick-captype":
        s.capitalType = btn.dataset.value;
        render();
        break;
      case "add-opex":
        s.opex.push(newOpex());
        render();
        break;
      case "add-product": {
        const p = newProduct();
        p.salesSharePct = "0";
        s.products.push(p);
        splitShareEvenly();
        render();
        break;
      }
      case "split-share":
        splitShareEvenly();
        stage.querySelectorAll('[data-kind="product"]').forEach((row) => {
          const p = s.products.find((x) => x.id === row.dataset.row);
          if (p) row.querySelector('[data-f="salesSharePct"]').value = p.salesSharePct;
        });
        refreshDerived();
        updateNav();
        break;
      case "remove-row": {
        const row = btn.closest("[data-row]");
        if (!row) break;
        if (row.dataset.kind === "opex") {
          s.opex = s.opex.filter((o) => o.id !== row.dataset.row);
          if (s.opex.length === 0) s.opex.push(newOpex());
        } else {
          s.products = s.products.filter((p) => p.id !== row.dataset.row);
          if (s.products.length) splitShareEvenly();
        }
        render();
        break;
      }
    }
  });

  stage.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.tagName === "INPUT" && STEPS[s.step] === "name") {
      e.preventDefault();
      if (!btnNext.disabled) btnNext.click();
    }
  });

  btnNext.addEventListener("click", () => {
    if (validate(s.step)) return;
    if (STEPS[s.step] === "review") submit();
    else go(1);
  });
  btnBack.addEventListener("click", () => go(-1));
  btnCancel.addEventListener("click", () => {
    if (!canCancel) return;
    close();
    onCancel?.();
  });

  /* ------------------------------------------------------------ */
  /* Submit                                                        */
  /* ------------------------------------------------------------ */

  function submit() {
    if (saving) return;
    saving = true;
    btnNext.disabled = true;
    btnNext.textContent = "Menyimpan…";

    const cap = capital();
    const info = capitalInfo();
    const loan = loanBreakdown({ capital: cap, tenorMonths: s.tenor, annualInterestRatePct: s.rate });
    const opexItems = s.opex
      .filter((o) => o.name.trim() && num(o.amount) > 0)
      .map((o) => ({ name: o.name.trim(), amount: num(o.amount), frequency: o.frequency }));

    // NOTE: monthlyFixedBurden stores the TOTAL monthly burden (Opex + capital).
    const business = {
      name: s.name.trim(),
      status: s.status,
      capitalType: s.capitalType,
      initialCapital: cap,
      unrecoveredCapital:
        s.status === "existing" && s.unrecovered !== "" ? num(s.unrecovered) : cap,
      loanDetails:
        s.capitalType === "loan"
          ? {
              tenorMonths: Math.round(num(s.tenor)),
              annualInterestRatePct: num(s.rate),
              monthlyInstallment: Math.round(loan.installment),
            }
          : null,
      ownCapitalDetails:
        s.capitalType === "own" ? { targetPaybackMonths: Math.round(num(s.payback)) } : null,
      monthlyFixedBurden: Math.round(burden()),
      monthlyOpex: Math.round(opexMonthly()),
      opexItems,
    };

    const products = s.products.map((p) => ({
      name: p.name.trim(),
      cogs: num(p.cogs),
      price: num(p.price),
      salesSharePct: num(p.salesSharePct),
      targetMarginPct: +marginPct(num(p.price), num(p.cogs)).toFixed(1),
    }));

    try {
      const { id, committed } = createBusiness(business, products);
      committed.catch((err) => onSaveError?.(err)); // never block UI on server ack (offline-first)
      saving = false;
      close();
      onComplete(id);
    } catch (err) {
      saving = false;
      onSaveError?.(err);
      render();
    }
  }

  /* ------------------------------------------------------------ */
  /* Public API                                                    */
  /* ------------------------------------------------------------ */

  function open({ canCancel: cc = false } = {}) {
    s = freshState();
    canCancel = cc;
    direction = "fwd";
    saving = false;
    view.hidden = false;
    document.body.classList.add("is-wizard");
    render();
  }

  function close() {
    view.hidden = true;
    document.body.classList.remove("is-wizard");
  }

  const isOpen = () => !view.hidden;

  return { open, close, isOpen };
}
