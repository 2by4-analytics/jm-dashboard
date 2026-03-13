const STORAGE_KEY = "railway-expenses-balance-state-v1";
const seedBills = [
  { id: crypto.randomUUID(), name: "Child Support", amount: 650, paid: "NO" },
  { id: crypto.randomUUID(), name: "Health Insurance", amount: 300, paid: "NO" },
  { id: crypto.randomUUID(), name: "Jacobs Car", amount: 600, paid: "NO" },
  { id: crypto.randomUUID(), name: "Car Hauler", amount: 168, paid: "NO" },
  { id: crypto.randomUUID(), name: "Shed Trailer - Paducah", amount: 2400, paid: "NO" },
  { id: crypto.randomUUID(), name: "Side by Side", amount: 600, paid: "NO" },
  { id: crypto.randomUUID(), name: "New Truck", amount: 1600, paid: "NO" },
  { id: crypto.randomUUID(), name: "Shed Truck", amount: 1100, paid: "NO" },
  { id: crypto.randomUUID(), name: "Forcht Bank Credit Card", amount: 0, paid: "NO" },
  { id: crypto.randomUUID(), name: "Personal Loan", amount: 1000, paid: "NO" },
  { id: crypto.randomUUID(), name: "RCR Hunting Blind", amount: 166.85, paid: "NO" },
  { id: crypto.randomUUID(), name: "Ford Financial - Car & Bronco", amount: 1800, paid: "NO" },
  { id: crypto.randomUUID(), name: "Shed Geek", amount: 1040, paid: "NO" },
  { id: crypto.randomUUID(), name: "State Farm Insurance", amount: 900, paid: "NO" },
  { id: crypto.randomUUID(), name: "Motor Carrier", amount: 150, paid: "NO" },
  { id: crypto.randomUUID(), name: "Bee Garbage", amount: 100, paid: "NO" },
  { id: crypto.randomUUID(), name: "Dish", amount: 200, paid: "NO" },
  { id: crypto.randomUUID(), name: "Jackson Propane", amount: 0, paid: "NO" },
  { id: crypto.randomUUID(), name: "KU", amount: 350, paid: "NO" },
  { id: crypto.randomUUID(), name: "Windstream", amount: 100, paid: "NO" },
  { id: crypto.randomUUID(), name: "Western Rockcastle Water", amount: 100, paid: "NO" },
  { id: crypto.randomUUID(), name: "Truck", amount: 1600, paid: "NO" },
  { id: crypto.randomUUID(), name: "House", amount: 2500, paid: "NO" },
  { id: crypto.randomUUID(), name: "Land", amount: 400, paid: "NO" },
  { id: crypto.randomUUID(), name: "State Revenue", amount: 100, paid: "NO" },
  { id: crypto.randomUUID(), name: "IRS", amount: 600, paid: "NO" },
];
const state = loadState();
const elements = {
  billsTableBody: document.querySelector("#bills-table-body"),
  rowTemplate: document.querySelector("#bill-row-template"),
  unpaidTotal: document.querySelector("#unpaid-total"),
  paidTotal: document.querySelector("#paid-total"),
  tithesRate: document.querySelector("#tithes-rate"),
  tithesTotal: document.querySelector("#tithes-total"),
  asOfLabel: document.querySelector("#as-of-label"),
  addBillButton: document.querySelector("#add-bill-button"),
  resetButton: document.querySelector("#reset-button"),
};
elements.addBillButton.addEventListener("click", () => {
  state.bills.push({ id: crypto.randomUUID(), name: "", amount: 0, paid: "NO" });
  persistState();
  render();
});
elements.resetButton.addEventListener("click", () => {
  state.bills = state.bills.map((bill) => ({ ...bill, paid: "NO" }));
  persistState();
  render();
});
render();
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { bills: structuredClone(seedBills), tithesRate: 0.1 };
    const parsed = JSON.parse(raw);
    return {
      bills: Array.isArray(parsed.bills) ? parsed.bills : structuredClone(seedBills),
      tithesRate: typeof parsed.tithesRate === "number" ? parsed.tithesRate : 0.1,
    };
  } catch {
    return { bills: structuredClone(seedBills), tithesRate: 0.1 };
  }
}
function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ bills: state.bills, tithesRate: state.tithesRate }));
}
function render() {
  renderTable();
  renderSummary();
}
function renderTable() {
  elements.billsTableBody.innerHTML = "";
  state.bills.forEach((bill) => {
    const rowFragment = elements.rowTemplate.content.cloneNode(true);
    const row = rowFragment.querySelector("tr");
    const nameInput = rowFragment.querySelector(".bill-name-input");
    const amountInput = rowFragment.querySelector(".bill-amount-input");
    const statusSelect = rowFragment.querySelector(".bill-status-select");
    const deleteButton = rowFragment.querySelector(".delete-row-button");
    if (bill.paid === "YES") row.classList.add("row-paid");
    nameInput.value = bill.name;
    amountInput.value = bill.amount ? String(bill.amount) : "";
    statusSelect.value = bill.paid;
    nameInput.addEventListener("input", (event) => { bill.name = event.target.value; persistState(); });
    amountInput.addEventListener("input", (event) => {
      const nextAmount = Number.parseFloat(event.target.value);
      bill.amount = Number.isFinite(nextAmount) ? nextAmount : 0;
      persistState();
      renderSummary();
    });
    statusSelect.addEventListener("change", (event) => { bill.paid = event.target.value; persistState(); render(); });
    deleteButton.addEventListener("click", () => {
      state.bills = state.bills.filter((currentBill) => currentBill.id !== bill.id);
      persistState();
      render();
    });
    elements.billsTableBody.appendChild(rowFragment);
  });
}
function renderSummary() {
  const paidTotal = sumBills((bill) => bill.paid === "YES");
  const unpaidTotal = sumBills((bill) => bill.paid !== "YES");
  const tithesTotal = paidTotal * state.tithesRate;
  elements.unpaidTotal.textContent = formatCurrency(unpaidTotal);
  elements.paidTotal.textContent = formatCurrency(paidTotal);
  elements.tithesRate.textContent = `${Math.round(state.tithesRate * 100)}%`;
  elements.tithesTotal.textContent = formatCurrency(tithesTotal);
  elements.asOfLabel.textContent = `Total Due Monthly As Of ${formatDate(new Date())}`;
}
function sumBills(predicate) {
  return state.bills.reduce((total, bill) => predicate(bill) ? total + normalizeAmount(bill.amount) : total, 0);
}
function normalizeAmount(amount) { return Number.isFinite(amount) ? amount : 0; }
function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}
function formatDate(date) {
  return new Intl.DateTimeFormat("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }).format(date);
}
