const DEFAULT_TITHES_RATE = 0.1;
const SAVE_DEBOUNCE_MS = 400;

const state = {
  bills: [],
  tithesRate: DEFAULT_TITHES_RATE,
  saveTimers: new Map(),
};

const elements = {
  billsList: document.querySelector("#bills-list"),
  cardTemplate: document.querySelector("#bill-card-template"),
  unpaidTotal: document.querySelector("#unpaid-total"),
  paidTotal: document.querySelector("#paid-total"),
  tithesRate: document.querySelector("#tithes-rate"),
  tithesTotal: document.querySelector("#tithes-total"),
  asOfLabel: document.querySelector("#as-of-label"),
  syncStatus: document.querySelector("#sync-status"),
  addBillButton: document.querySelector("#add-bill-button"),
  resetButton: document.querySelector("#reset-button"),
};

boot();

async function boot() {
  bindActions();
  await loadState();
}

function bindActions() {
  elements.addBillButton.addEventListener("click", addBill);
  elements.resetButton.addEventListener("click", resetBills);
}

async function loadState() {
  setSyncStatus("Loading", "");

  try {
    const response = await fetch("/api/state");
    if (!response.ok) throw new Error("Unable to load data");

    const payload = await response.json();
    state.bills = payload.bills || [];
    state.tithesRate = typeof payload.tithesRate === "number" ? payload.tithesRate : DEFAULT_TITHES_RATE;
    render();
    setSyncStatus("Synced", "sync-ok");
  } catch (error) {
    console.error(error);
    setSyncStatus("Offline", "sync-error");
  }
}

async function addBill() {
  setSyncStatus("Saving", "");

  try {
    const response = await fetch("/api/bills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", amount: 0, paid: "NO" }),
    });

    if (!response.ok) throw new Error("Unable to add bill");

    const bill = await response.json();
    state.bills.push(bill);
    render();
    setSyncStatus("Synced", "sync-ok");
  } catch (error) {
    console.error(error);
    setSyncStatus("Save failed", "sync-error");
  }
}

async function resetBills() {
  setSyncStatus("Saving", "");

  try {
    const response = await fetch("/api/reset", { method: "POST" });
    if (!response.ok) throw new Error("Unable to reset bills");

    state.bills = state.bills.map((bill) => ({ ...bill, paid: "NO" }));
    render();
    setSyncStatus("Synced", "sync-ok");
  } catch (error) {
    console.error(error);
    setSyncStatus("Save failed", "sync-error");
  }
}

function render() {
  elements.billsList.innerHTML = "";

  state.bills.forEach((bill) => {
    const fragment = elements.cardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".bill-card");
    const nameInput = fragment.querySelector(".bill-name-input");
    const amountInput = fragment.querySelector(".bill-amount-input");
    const deleteButton = fragment.querySelector(".delete-row-button");
    const toggleButtons = Array.from(fragment.querySelectorAll(".toggle-button"));

    if (bill.paid === "YES") card.classList.add("bill-paid");

    nameInput.value = bill.name;
    amountInput.value = bill.amount ? String(bill.amount) : "";

    toggleButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.value === bill.paid);
      button.addEventListener("click", async () => {
        if (bill.paid === button.dataset.value) return;
        bill.paid = button.dataset.value;
        render();
        await saveBillNow(bill);
      });
    });

    nameInput.addEventListener("input", (event) => {
      bill.name = event.target.value;
      queueSave(bill);
    });

    amountInput.addEventListener("input", (event) => {
      const nextAmount = Number.parseFloat(event.target.value);
      bill.amount = Number.isFinite(nextAmount) ? nextAmount : 0;
      renderSummary();
      queueSave(bill);
    });

    deleteButton.addEventListener("click", async () => {
      setSyncStatus("Saving", "");

      try {
        const response = await fetch(`/api/bills/${bill.id}`, { method: "DELETE" });
        if (!response.ok) throw new Error("Unable to delete bill");

        state.bills = state.bills.filter((currentBill) => currentBill.id !== bill.id);
        render();
        setSyncStatus("Synced", "sync-ok");
      } catch (error) {
        console.error(error);
        setSyncStatus("Save failed", "sync-error");
      }
    });

    elements.billsList.appendChild(fragment);
  });

  renderSummary();
}

function queueSave(bill) {
  setSyncStatus("Saving", "");
  clearTimeout(state.saveTimers.get(bill.id));

  const timeoutId = window.setTimeout(async () => {
    state.saveTimers.delete(bill.id);
    await saveBillNow(bill);
  }, SAVE_DEBOUNCE_MS);

  state.saveTimers.set(bill.id, timeoutId);
}

async function saveBillNow(bill) {
  try {
    const response = await fetch(`/api/bills/${bill.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: bill.name, amount: bill.amount, paid: bill.paid }),
    });

    if (!response.ok) throw new Error("Unable to save bill");

    const savedBill = await response.json();
    const index = state.bills.findIndex((entry) => entry.id === savedBill.id);
    if (index >= 0) state.bills[index] = savedBill;
    render();
    setSyncStatus("Synced", "sync-ok");
  } catch (error) {
    console.error(error);
    setSyncStatus("Save failed", "sync-error");
  }
}

function renderSummary() {
  const paidTotal = sumBills((bill) => bill.paid === "YES");
  const unpaidTotal = sumBills((bill) => bill.paid !== "YES");
  const tithesTotal = paidTotal * state.tithesRate;

  elements.unpaidTotal.textContent = formatCurrency(unpaidTotal);
  elements.paidTotal.textContent = formatCurrency(paidTotal);
  elements.tithesRate.textContent = `${Math.round(state.tithesRate * 100)}%`;
  elements.tithesTotal.textContent = formatCurrency(tithesTotal);
  elements.asOfLabel.textContent = `As of ${formatDate(new Date())}`;
}

function sumBills(predicate) {
  return state.bills.reduce((total, bill) => (predicate(bill) ? total + normalizeAmount(bill.amount) : total), 0);
}

function normalizeAmount(amount) {
  return Number.isFinite(amount) ? amount : 0;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }).format(date);
}

function setSyncStatus(label, className) {
  elements.syncStatus.textContent = label;
  elements.syncStatus.className = `sync-status ${className}`.trim();
}
