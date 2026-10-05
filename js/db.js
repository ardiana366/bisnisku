/**
 * Bisnisku — db.js
 * Firestore CRUD scoped to  devices/{deviceId}/businesses/{businessId}/...
 *
 * Offline note: with the persistent cache, write promises only resolve once the
 * server acknowledges. The UI therefore never blocks on them — it listens to
 * onSnapshot streams, which fire immediately from the local cache.
 */
import { db } from "./firebase-config.js";
import { toMonthly, capitalMonthlyBurden, calculateAdditionMonthlyBurden } from "./calculator.js";
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  writeBatch,
  setDoc,
  deleteDoc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  increment,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const DEVICE_KEY = "bisnisku_device_id";
const OLD_DEVICE_KEY = "bizmetric_device_id";

/* ---------- Identity (no login) ---------- */

function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  // Fallback for very old browsers
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function getDeviceId() {
  let id = null;
  try {
    id = localStorage.getItem(DEVICE_KEY) || localStorage.getItem(OLD_DEVICE_KEY);
  } catch (_) {}
  if (!id) {
    id = uuid();
  }
  try {
    localStorage.setItem(DEVICE_KEY, id);
  } catch (_) {}
  return id;
}

const deviceId = getDeviceId();

const businessesCol = () => collection(db, "devices", deviceId, "businesses");
const businessDoc = (bizId) => doc(db, "devices", deviceId, "businesses", bizId);
const productsCol = (bizId) => collection(businessDoc(bizId), "products");
const salesCol = (bizId) => collection(businessDoc(bizId), "daily_sales");
const saleDoc = (bizId, date) => doc(salesCol(bizId), date);

const tsMillis = (t) => (t && typeof t.toMillis === "function" ? t.toMillis() : 0);

/* ---------- Businesses ---------- */

/** Live list of businesses, oldest first. Returns an unsubscribe fn. */
export function subscribeBusinesses(onData, onError) {
  return onSnapshot(
    businessesCol(),
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...d.data({ serverTimestamps: "estimate" }),
      }));
      list.sort((a, b) => tsMillis(a.createdAt) - tsMillis(b.createdAt));
      onData(list, snap.metadata);
    },
    (err) => onError?.(err)
  );
}

/**
 * Create a business + its products atomically (one batch).
 * Returns { id, committed } — `committed` resolves when the server has the data.
 */
export function createBusiness(business, products) {
  const bizRef = doc(businessesCol());
  const batch = writeBatch(db);
  batch.set(bizRef, { ...business, createdAt: serverTimestamp() });
  for (const p of products) {
    batch.set(doc(collection(bizRef, "products")), {
      name: p.name,
      cogs: p.cogs,
      price: p.price,
      salesSharePct: p.salesSharePct,
      targetMarginPct: p.targetMarginPct,
    });
  }
  return { id: bizRef.id, committed: batch.commit() };
}

/**
 * Permanently delete a business and all its subcollections (products, daily_sales, costs) from Firestore.
 */
export async function deleteBusiness(bizId) {
  const bDoc = businessDoc(bizId);
  const pCol = productsCol(bizId);
  const sCol = salesCol(bizId);
  const cCol = collection(bDoc, "costs");
  const eCol = collection(bDoc, "expenses");

  // Read all subcollection documents
  const [pSnap, sSnap, cSnap, eSnap] = await Promise.all([
    getDocs(pCol).catch(() => ({ docs: [] })),
    getDocs(sCol).catch(() => ({ docs: [] })),
    getDocs(cCol).catch(() => ({ docs: [] })),
    getDocs(eCol).catch(() => ({ docs: [] })),
  ]);

  const allDocRefs = [
    ...pSnap.docs.map((d) => d.ref),
    ...sSnap.docs.map((d) => d.ref),
    ...cSnap.docs.map((d) => d.ref),
    ...eSnap.docs.map((d) => d.ref),
    bDoc,
  ];

  // Batch delete in chunks of 400 (Firestore max batch is 500)
  for (let i = 0; i < allDocRefs.length; i += 400) {
    const chunk = allDocRefs.slice(i, i + 400);
    const batch = writeBatch(db);
    chunk.forEach((ref) => batch.delete(ref));
    await batch.commit();
  }

  // Also issue deleteDoc on bDoc to ensure immediate local cache purge
  try {
    await deleteDoc(bDoc);
  } catch (_) {}

  return true;
}

/* ---------- Products ---------- */

export function subscribeProducts(bizId, onData, onError) {
  return onSnapshot(
    productsCol(bizId),
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      // Stable order: highest sales share first, then name.
      list.sort(
        (a, b) =>
          (b.salesSharePct || 0) - (a.salesSharePct || 0) ||
          String(a.name).localeCompare(String(b.name))
      );
      onData(list);
    },
    (err) => onError?.(err)
  );
}

/* ---------- Daily sales ---------- */

/** Live daily_sales between two YYYY-MM-DD dates (inclusive). */
export function subscribeDailySales(bizId, startDate, endDate, onData, onError) {
  const q = query(
    salesCol(bizId),
    where("date", ">=", startDate),
    where("date", "<=", endDate),
    orderBy("date", "asc")
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => onError?.(err)
  );
}

/** Live daily_sales for a specific month (1-based month or 0-based). */
export function subscribeMonthlySales(bizId, year, month, onData, onError) {
  const m = Number(month);
  const monthString = String(m).padStart(2, "0");
  const startDate = `${year}-${monthString}-01`;
  const endDate = `${year}-${monthString}-31`;
  return subscribeDailySales(bizId, startDate, endDate, onData, onError);
}

/** One-off read, resolves to null when missing or unreachable (3 s cap). */
export async function getDailySale(bizId, date) {
  try {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000));
    const snap = await Promise.race([getDoc(saleDoc(bizId, date)), timeout]);
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch (_) {
    return null;
  }
}

/** Upsert daily_sales/{date}. Returns the (non-awaited) write promise. */
export function saveDailySale(bizId, date, { items, totalRevenue, totalCogs, grossProfit, notes }) {
  return setDoc(saleDoc(bizId, date), {
    date,
    items,
    totalRevenue,
    totalCogs,
    grossProfit,
    notes: notes || "",
    updatedAt: serverTimestamp(),
  });
}

export function deleteDailySale(bizId, date) {
  return deleteDoc(saleDoc(bizId, date));
}

/* ---------- Costs & Burden ---------- */

/**
 * Permanently append a cost item and increment monthlyFixedBurden on the business.
 */
export async function applyCostIncrease(businessId, costTitle, monthlyAmount) {
  const deviceId = getDeviceId();
  const businessRef = doc(db, "devices", deviceId, "businesses", businessId);
  const costColRef = collection(db, "devices", deviceId, "businesses", businessId, "costs");

  const amount = Number(monthlyAmount) || 0;
  const newItem = {
    id: uuid(),
    name: costTitle || "Kenaikan Beban",
    amount,
    frequency: "monthly",
    createdAt: Date.now(),
  };

  // 1. Simpan detail item biaya baru di subcollection costs
  await addDoc(costColRef, {
    ...newItem,
    type: "fixed",
    createdAt: serverTimestamp(),
  });

  // 2. Baca data opexItems yang ada untuk diupdate
  const snap = await getDoc(businessRef);
  const currentOpex = snap.exists() ? snap.data().opexItems || [] : [];
  const updatedOpex = [...currentOpex, newItem];

  // 3. Update total monthlyFixedBurden dan opexItems di root business doc
  await updateDoc(businessRef, {
    monthlyFixedBurden: increment(amount),
    monthlyOpex: increment(amount),
    opexItems: updatedOpex,
  });
}

/**
 * Directly update the total monthlyFixedBurden of a business.
 */
export async function updateMonthlyBurden(businessId, newMonthlyBurden) {
  const bDoc = businessDoc(businessId);
  const amount = Math.max(0, Number(newMonthlyBurden) || 0);
  await updateDoc(bDoc, {
    monthlyFixedBurden: amount,
    updatedAt: serverTimestamp(),
  });
  return amount;
}

/**
/**
 * Update product details: name, cogs, selling price, salesSharePct, and targetMarginPct.
 */
export async function updateProduct(businessId, productId, { name, cogs, price, salesSharePct, targetMarginPct }) {
  const pRef = doc(productsCol(businessId), productId);
  const snap = await getDoc(pRef);
  if (!snap.exists()) throw new Error("Produk tidak ditemukan");
  const data = snap.data();

  const newName = (name !== undefined && name !== null && String(name).trim() !== "") ? String(name).trim() : data.name;
  const newCogs = (cogs !== undefined && cogs !== null) ? Math.max(0, Number(cogs) || 0) : (Number(data.cogs) || 0);
  const newPrice = (price !== undefined && price !== null) ? Math.max(0, Number(price) || 0) : (Number(data.price) || 0);
  const newShare = (salesSharePct !== undefined && salesSharePct !== null) ? Math.max(0, Number(salesSharePct) || 0) : (Number(data.salesSharePct) || 0);
  const calculatedMargin = newPrice > 0 ? Math.round(((newPrice - newCogs) / newPrice) * 1000) / 10 : 0;
  const marginToSave = (targetMarginPct !== undefined && targetMarginPct !== null) ? Number(targetMarginPct) : calculatedMargin;

  await updateDoc(pRef, {
    name: newName,
    cogs: newCogs,
    price: newPrice,
    salesSharePct: newShare,
    targetMarginPct: marginToSave,
    updatedAt: serverTimestamp(),
  });
  return { id: productId, name: newName, cogs: newCogs, price: newPrice, salesSharePct: newShare, targetMarginPct: marginToSave };
}

export const updateProductPrice = (businessId, productId, price) =>
  updateProduct(businessId, productId, { price });

/**
 * Add a new product to an existing business.
 */
export async function addProduct(businessId, { name, cogs, price, salesSharePct, targetMarginPct }) {
  const pCol = productsCol(businessId);
  const newCogs = Math.max(0, Number(cogs) || 0);
  const newPrice = Math.max(0, Number(price) || 0);
  const newShare = Math.max(0, Number(salesSharePct) || 0);
  const calculatedMargin = newPrice > 0 ? Math.round(((newPrice - newCogs) / newPrice) * 1000) / 10 : 0;
  const marginToSave = targetMarginPct !== undefined ? Number(targetMarginPct) : calculatedMargin;

  const docRef = await addDoc(pCol, {
    name: (name || "Produk Baru").trim(),
    cogs: newCogs,
    price: newPrice,
    salesSharePct: newShare,
    targetMarginPct: marginToSave,
    createdAt: serverTimestamp(),
  });
  return { id: docRef.id, name, cogs: newCogs, price: newPrice, salesSharePct: newShare, targetMarginPct: marginToSave };
}

/**
 * Delete a product from a business.
 */
export async function deleteProduct(businessId, productId) {
  const pRef = doc(productsCol(businessId), productId);
  await deleteDoc(pRef);
  return true;
}

/**
 * Update a specific cost item in opexItems and adjust monthlyFixedBurden and monthlyOpex accordingly.
 */
export async function updateCostItem(businessId, costItemId, { name, amount, frequency }) {
  const deviceId = getDeviceId();
  const businessRef = doc(db, "devices", deviceId, "businesses", businessId);

  const snap = await getDoc(businessRef);
  if (!snap.exists()) throw new Error("Usaha tidak ditemukan");
  const data = snap.data();
  const currentOpex = data.opexItems || [];

  let oldItem = null;
  let itemIndex = -1;

  const rawAmount = Math.max(0, Number(amount) || 0);
  const newMonthlyEq = Math.round(toMonthly(rawAmount, frequency));

  const updatedOpex = currentOpex.map((it, idx) => {
    const itId = it.id || `idx-${idx}`;
    if (itId === costItemId || it.id === costItemId || String(idx) === String(costItemId)) {
      oldItem = it;
      itemIndex = idx;
      return {
        ...it,
        id: it.id || itId,
        name: (name || it.name || "Biaya").trim(),
        amount: rawAmount,
        frequency: frequency || it.frequency || "monthly",
        updatedAt: Date.now(),
      };
    }
    return it;
  });

  if (!oldItem) throw new Error("Item beban tidak ditemukan");

  const oldMonthlyEq = Math.round(toMonthly(oldItem.amount, oldItem.frequency));
  const deltaMonthly = newMonthlyEq - oldMonthlyEq;

  const newMonthlyFixedBurden = Math.max(0, (Number(data.monthlyFixedBurden) || 0) + deltaMonthly);
  const newMonthlyOpex = Math.max(0, (Number(data.monthlyOpex) || 0) + deltaMonthly);

  await updateDoc(businessRef, {
    opexItems: updatedOpex,
    monthlyFixedBurden: newMonthlyFixedBurden,
    monthlyOpex: newMonthlyOpex,
    updatedAt: serverTimestamp(),
  });

  return {
    updatedItem: updatedOpex[itemIndex],
    deltaMonthly,
    newMonthlyFixedBurden,
    newMonthlyOpex,
    updatedOpex,
  };
}

/**
 * Update capital / loan details and recalculate monthly fixed burden.
 */
export async function updateCapitalDetails(businessId, { initialCapital, loanDetails, ownCapitalDetails }) {
  const bDoc = businessDoc(businessId);
  const snap = await getDoc(bDoc);
  if (!snap.exists()) throw new Error("Usaha tidak ditemukan");
  const data = snap.data();

  const capitalType = data.capitalType || "own";
  const capital = Math.max(0, Number(initialCapital) || 0);

  const capBurden = Math.round(
    capitalMonthlyBurden({
      capitalType,
      initialCapital: capital,
      loanDetails,
      ownCapitalDetails,
    })
  );

  const monthlyOpex = Number(data.monthlyOpex) || 0;
  const newMonthlyFixedBurden = monthlyOpex + capBurden;

  const updatePayload = {
    initialCapital: capital,
    monthlyFixedBurden: newMonthlyFixedBurden,
    updatedAt: serverTimestamp(),
  };

  if (capitalType === "loan" && loanDetails) {
    updatePayload.loanDetails = loanDetails;
  } else if (capitalType === "own" && ownCapitalDetails) {
    updatePayload.ownCapitalDetails = ownCapitalDetails;
  }

  await updateDoc(bDoc, updatePayload);
  return { capBurden, newMonthlyFixedBurden, capital, loanDetails, ownCapitalDetails };
}

/**
 * Add a new capital addition (investment, own equity, or loan) to a business.
 */
export async function addCapitalAddition(businessId, payload) {
  const bDoc = businessDoc(businessId);
  const snap = await getDoc(bDoc);
  if (!snap.exists()) throw new Error("Usaha tidak ditemukan");
  const data = snap.data();

  const amount = Math.max(0, Number(payload.amount) || 0);
  const type = payload.type || "invest";
  const returnType = payload.returnType || "dynamic";
  const fixedReturnPct = Number(payload.fixedReturnPct) || 0;
  const dynamicProfitPct = Number(payload.dynamicProfitPct) || 0;
  const tenorMonths = Number(payload.tenorMonths) || 0;
  const paybackMonths = Number(payload.paybackMonths) || 0;
  const annualInterestRatePct = Number(payload.annualInterestRatePct) || 0;

  const monthlyBurden = calculateAdditionMonthlyBurden({
    amount,
    type,
    returnType,
    fixedReturnPct,
    tenorMonths,
    paybackMonths,
    annualInterestRatePct,
  });

  const newItem = {
    id: uuid(),
    name: (payload.name && payload.name.trim()) || (type === "invest" ? "Modal Investasi" : "Tambahan Modal"),
    amount,
    type,
    returnType,
    fixedReturnPct,
    dynamicProfitPct,
    tenorMonths,
    paybackMonths,
    annualInterestRatePct,
    monthlyBurden,
    createdAt: Date.now(),
  };

  const existingAdditions = Array.isArray(data.capitalAdditions) ? data.capitalAdditions : [];
  const updatedAdditions = [...existingAdditions, newItem];

  const currentCapital = Number(data.initialCapital) || 0;
  const currentUnrec = Number(data.unrecoveredCapital) || 0;
  const currentBurden = Number(data.monthlyFixedBurden) || 0;

  const newInitialCapital = currentCapital + amount;
  const newUnrecoveredCapital = currentUnrec + amount;
  const newMonthlyFixedBurden = currentBurden + monthlyBurden;

  await updateDoc(bDoc, {
    capitalAdditions: updatedAdditions,
    initialCapital: newInitialCapital,
    unrecoveredCapital: newUnrecoveredCapital,
    monthlyFixedBurden: newMonthlyFixedBurden,
    updatedAt: serverTimestamp(),
  });

  return {
    addition: newItem,
    capitalAdditions: updatedAdditions,
    initialCapital: newInitialCapital,
    unrecoveredCapital: newUnrecoveredCapital,
    monthlyFixedBurden: newMonthlyFixedBurden,
  };
}

/**
 * Remove a capital addition from a business and adjust capital and monthly burden.
 */
export async function removeCapitalAddition(businessId, additionId) {
  const bDoc = businessDoc(businessId);
  const snap = await getDoc(bDoc);
  if (!snap.exists()) throw new Error("Usaha tidak ditemukan");
  const data = snap.data();

  const existingAdditions = Array.isArray(data.capitalAdditions) ? data.capitalAdditions : [];
  const item = existingAdditions.find((a) => a.id === additionId);
  if (!item) return null;

  const updatedAdditions = existingAdditions.filter((a) => a.id !== additionId);
  const itemAmount = Number(item.amount) || 0;
  const itemBurden = Number(item.monthlyBurden) || 0;

  const monthlyOpex = Number(data.monthlyOpex) || 0;
  const currentCapital = Number(data.initialCapital) || 0;
  const currentUnrec = Number(data.unrecoveredCapital) || 0;
  const currentBurden = Number(data.monthlyFixedBurden) || 0;

  const newInitialCapital = Math.max(0, currentCapital - itemAmount);
  const newUnrecoveredCapital = Math.max(0, currentUnrec - itemAmount);
  const newMonthlyFixedBurden = Math.max(monthlyOpex, currentBurden - itemBurden);

  await updateDoc(bDoc, {
    capitalAdditions: updatedAdditions,
    initialCapital: newInitialCapital,
    unrecoveredCapital: newUnrecoveredCapital,
    monthlyFixedBurden: newMonthlyFixedBurden,
    updatedAt: serverTimestamp(),
  });

  return {
    removedId: additionId,
    capitalAdditions: updatedAdditions,
    initialCapital: newInitialCapital,
    unrecoveredCapital: newUnrecoveredCapital,
    monthlyFixedBurden: newMonthlyFixedBurden,
  };
}

/**
 * Update an existing capital addition (Update in CRUD).
 */
export async function updateCapitalAddition(businessId, additionId, payload) {
  const bDoc = businessDoc(businessId);
  const snap = await getDoc(bDoc);
  if (!snap.exists()) throw new Error("Usaha tidak ditemukan");
  const data = snap.data();

  const existingAdditions = Array.isArray(data.capitalAdditions) ? data.capitalAdditions : [];
  const oldItem = existingAdditions.find((a) => a.id === additionId);
  if (!oldItem) throw new Error("Data modal tidak ditemukan");

  const amount = Math.max(0, Number(payload.amount) || 0);
  const type = payload.type || oldItem.type || "invest";
  const returnType = payload.returnType || oldItem.returnType || "dynamic";
  const fixedReturnPct = Math.max(0, Number(payload.fixedReturnPct) || 0);
  const dynamicProfitPct = Math.max(0, Number(payload.dynamicProfitPct) || 0);
  const tenorMonths = Math.max(0, Math.round(Number(payload.tenorMonths) || 0));
  const paybackMonths = Math.max(0, Math.round(Number(payload.paybackMonths) || 0));
  const annualInterestRatePct = Math.max(0, Number(payload.annualInterestRatePct) || 0);

  const newMonthlyBurden = calculateAdditionMonthlyBurden({
    amount,
    type,
    returnType,
    fixedReturnPct,
    tenorMonths,
    paybackMonths,
    annualInterestRatePct,
  });

  const updatedItem = {
    ...oldItem,
    name: (payload.name && payload.name.trim()) || oldItem.name,
    amount,
    type,
    returnType,
    fixedReturnPct,
    dynamicProfitPct,
    tenorMonths,
    paybackMonths,
    annualInterestRatePct,
    monthlyBurden: newMonthlyBurden,
    updatedAt: Date.now(),
  };

  const updatedAdditions = existingAdditions.map((a) => (a.id === additionId ? updatedItem : a));

  const oldAmount = Number(oldItem.amount) || 0;
  const oldBurden = Number(oldItem.monthlyBurden) || 0;
  const currentCapital = Number(data.initialCapital) || 0;
  const currentUnrec = Number(data.unrecoveredCapital) || 0;
  const currentBurden = Number(data.monthlyFixedBurden) || 0;

  const newInitialCapital = Math.max(0, currentCapital - oldAmount + amount);
  const newUnrecoveredCapital = Math.max(0, currentUnrec - oldAmount + amount);
  const newMonthlyFixedBurden = Math.max(0, currentBurden - oldBurden + newMonthlyBurden);

  await updateDoc(bDoc, {
    capitalAdditions: updatedAdditions,
    initialCapital: newInitialCapital,
    unrecoveredCapital: newUnrecoveredCapital,
    monthlyFixedBurden: newMonthlyFixedBurden,
    updatedAt: serverTimestamp(),
  });

  return {
    addition: updatedItem,
    capitalAdditions: updatedAdditions,
    initialCapital: newInitialCapital,
    unrecoveredCapital: newUnrecoveredCapital,
    monthlyFixedBurden: newMonthlyFixedBurden,
  };
}

/**
 * Add a new cost/expense item to the business and update monthlyFixedBurden and monthlyOpex.
 */
export async function addCostToBusiness(businessId, { name, amount, frequency = "monthly" }) {
  const deviceId = getDeviceId();
  const businessRef = doc(db, "devices", deviceId, "businesses", businessId);
  const costColRef = collection(db, "devices", deviceId, "businesses", businessId, "costs");

  const rawAmount = Number(amount) || 0;
  const monthlyAmt = Math.round(toMonthly(rawAmount, frequency));
  const newItem = {
    id: uuid(),
    name: (name || "Biaya Baru").trim(),
    amount: rawAmount,
    frequency,
    createdAt: Date.now(),
  };

  // 1. Simpan ke subcollection costs
  await addDoc(costColRef, {
    ...newItem,
    monthlyAmount: monthlyAmt,
    createdAt: serverTimestamp(),
  });

  // 2. Baca data opexItems yang ada untuk diupdate
  const snap = await getDoc(businessRef);
  const currentOpex = snap.exists() ? snap.data().opexItems || [] : [];
  const updatedOpex = [...currentOpex, newItem];

  await updateDoc(businessRef, {
    monthlyFixedBurden: increment(monthlyAmt),
    monthlyOpex: increment(monthlyAmt),
    opexItems: updatedOpex,
  });

  return { newItem, monthlyAmt, updatedOpex };
}

/**
 * Remove a cost item from the business and decrement monthlyFixedBurden and monthlyOpex.
 */
export async function removeCostFromBusiness(businessId, costItemId) {
  const deviceId = getDeviceId();
  const businessRef = doc(db, "devices", deviceId, "businesses", businessId);

  const snap = await getDoc(businessRef);
  if (!snap.exists()) return null;
  const data = snap.data();
  const currentOpex = data.opexItems || [];

  let removedItem = null;
  const updatedOpex = currentOpex.filter((it, idx) => {
    const itId = it.id || `idx-${idx}`;
    if (itId === costItemId || it.id === costItemId || String(idx) === String(costItemId)) {
      removedItem = it;
      return false;
    }
    return true;
  });

  if (!removedItem) return null;

  const monthlyAmt = Math.round(toMonthly(removedItem.amount, removedItem.frequency));

  await updateDoc(businessRef, {
    monthlyFixedBurden: increment(-monthlyAmt),
    monthlyOpex: increment(-monthlyAmt),
    opexItems: updatedOpex,
  });

  return { removedItem, monthlyAmt, updatedOpex };
}

/* ---------- Incidental Expenses (One-off Cash Outflows) ---------- */

/**
 * Simpan transaksi pengeluaran insidental ke subcollection expenses.
 * Jika tipe Capex, otomatis tambahkan nominal ke unrecoveredCapital bisnis.
 */
export async function addIncidentalExpense(businessId, expenseData) {
  const deviceId = getDeviceId();
  const expenseColRef = collection(db, "devices", deviceId, "businesses", businessId, "expenses");
  
  // 1. Simpan dokumen transaksi pengeluaran
  const docRef = await addDoc(expenseColRef, {
    ...expenseData,
    amount: Number(expenseData.amount) || 0,
    createdAt: serverTimestamp()
  });

  // 2. Jika tipe Capex, otomatis tambahkan ke unrecoveredCapital bisnis
  if (expenseData.expenseType === "capex" && expenseData.amount > 0) {
    const businessDocRef = doc(db, "devices", deviceId, "businesses", businessId);
    await updateDoc(businessDocRef, {
      unrecoveredCapital: increment(Number(expenseData.amount) || 0)
    });
  }

  return docRef.id;
}

/**
 * Berlangganan data pengeluaran insidental untuk bulan tertentu (live stream).
 */
export function subscribeMonthlyExpenses(businessId, year, month, onUpdate, onError) {
  const deviceId = getDeviceId();
  const monthString = String(month).padStart(2, "0");
  const startDate = `${year}-${monthString}-01`;
  const endDate = `${year}-${monthString}-31`;

  const expenseColRef = collection(db, "devices", deviceId, "businesses", businessId, "expenses");
  const q = query(
    expenseColRef,
    where("date", ">=", startDate),
    where("date", "<=", endDate),
    orderBy("date", "asc")
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const records = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      onUpdate(records);
    },
    onError
  );
}

/**
 * Hapus dokumen pengeluaran insidental.
 * Jika bertipe Capex dan data tersedia, kurangi kembali unrecoveredCapital bisnis.
 */
export async function deleteIncidentalExpense(businessId, expenseId, expenseData = null) {
  const deviceId = getDeviceId();
  const expenseDocRef = doc(db, "devices", deviceId, "businesses", businessId, "expenses", expenseId);

  if (expenseData && expenseData.expenseType === "capex" && Number(expenseData.amount) > 0) {
    const businessDocRef = doc(db, "devices", deviceId, "businesses", businessId);
    await updateDoc(businessDocRef, {
      unrecoveredCapital: increment(-Number(expenseData.amount))
    });
  }

  await deleteDoc(expenseDocRef);
  return true;
}

