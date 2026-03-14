var state = {
  currentView: "dashboard",
  selectedMonth: "2026-03",
  months: [],
  bills: [],
  tithesRate: 0.1,
  saveTimers: {}
};

var elements = {
  homeButton: document.getElementById("home-button"),
  dashboardView: document.getElementById("dashboard-view"),
  expensesView: document.getElementById("expenses-view"),
  expensesModule: document.getElementById("expenses-module"),
  backButton: document.getElementById("back-button"),
  monthSelector: document.getElementById("month-selector"),
  syncStatus: document.getElementById("sync-status"),
  unpaidTotal: document.getElementById("unpaid-total"),
  paidTotal: document.getElementById("paid-total"),
  tithesTotal: document.getElementById("tithes-total"),
  tithesRate: document.getElementById("tithes-rate"),
  asOfLabel: document.getElementById("as-of-label"),
  addBillButton: document.getElementById("add-bill-button"),
  resetButton: document.getElementById("reset-button"),
  billsList: document.getElementById("bills-list")
};

boot();

function boot() {
  bindActions();
  loadBootstrap();
}

function bindActions() {
  elements.homeButton.onclick = showDashboard;
  elements.expensesModule.onclick = function () {
    showExpenses();
  };
  elements.backButton.onclick = showDashboard;
  elements.monthSelector.onchange = function (event) {
    state.selectedMonth = event.target.value;
    loadMonth();
  };
  elements.addBillButton.onclick = addBill;
  elements.resetButton.onclick = resetBills;
}

function loadBootstrap() {
  requestJson("GET", "/api/bootstrap", null, function (error, payload) {
    if (error) {
      setSyncStatus("Offline", "sync-error");
      return;
    }

    state.months = payload.months || [];
    state.selectedMonth = payload.selectedMonth || "2026-03";
    state.tithesRate = payload.tithesRate || 0.1;
    renderMonthOptions();
    showDashboard();
  });
}

function renderMonthOptions() {
  elements.monthSelector.innerHTML = "";

  for (var i = 0; i < state.months.length; i += 1) {
    var option = document.createElement("option");
    option.value = state.months[i].value;
    option.textContent = state.months[i].label;
    if (state.months[i].value === state.selectedMonth) option.selected = true;
    elements.monthSelector.appendChild(option);
  }
}

function showDashboard() {
  state.currentView = "dashboard";
  elements.dashboardView.className = "view-section";
  elements.expensesView.className = "view-section is-hidden";
}

function showExpenses() {
  state.currentView = "expenses";
  elements.dashboardView.className = "view-section is-hidden";
  elements.expensesView.className = "view-section";
  loadMonth();
}

function loadMonth() {
  setSyncStatus("Loading", "");
  requestJson("GET", "/api/state?month=" + encodeURIComponent(state.selectedMonth), null, function (error, payload) {
    if (error) {
      setSyncStatus("Offline", "sync-error");
      return;
    }

    state.bills = payload.bills || [];
    state.tithesRate = payload.tithesRate || 0.1;
    renderMonthOptions();
    renderBills();
    renderSummary();
    setSyncStatus("Synced", "sync-ok");
  });
}

function addBill() {
  setSyncStatus("Saving", "");
  requestJson("POST", "/api/bills?month=" + encodeURIComponent(state.selectedMonth), { name: "", amount: 0, paid: "NO" }, function (error, bill) {
    if (error) {
      setSyncStatus("Save failed", "sync-error");
      return;
    }

    state.bills.push(bill);
    renderBills();
    renderSummary();
    setSyncStatus("Synced", "sync-ok");
  });
}

function resetBills() {
  setSyncStatus("Saving", "");
  requestJson("POST", "/api/reset?month=" + encodeURIComponent(state.selectedMonth), {}, function (error) {
    if (error) {
      setSyncStatus("Save failed", "sync-error");
      return;
    }

    for (var i = 0; i < state.bills.length; i += 1) {
      state.bills[i].paid = "NO";
    }

    renderBills();
    renderSummary();
    setSyncStatus("Synced", "sync-ok");
  });
}

function renderBills() {
  elements.billsList.innerHTML = "";

  for (var i = 0; i < state.bills.length; i += 1) {
    elements.billsList.appendChild(createBillCard(state.bills[i]));
  }
}

function createBillCard(bill) {
  var card = document.createElement("article");
  card.className = "bill-card" + (bill.paid === "YES" ? " bill-paid" : "");

  var topRow = document.createElement("div");
  topRow.className = "bill-top-row";

  var nameWrap = document.createElement("label");
  nameWrap.className = "field-stack";
  var nameLabel = document.createElement("span");
  nameLabel.className = "field-label";
  nameLabel.textContent = "Bill";
  var nameInput = document.createElement("input");
  nameInput.className = "text-input";
  nameInput.type = "text";
  nameInput.value = bill.name;
  nameInput.oninput = function (event) {
    bill.name = event.target.value;
    queueSave(bill);
  };
  nameWrap.appendChild(nameLabel);
  nameWrap.appendChild(nameInput);

  var amountWrap = document.createElement("label");
  amountWrap.className = "field-stack";
  var amountLabel = document.createElement("span");
  amountLabel.className = "field-label";
  amountLabel.textContent = "Amount";
  var amountBox = document.createElement("div");
  amountBox.className = "amount-input-wrap";
  var currencyMark = document.createElement("span");
  currencyMark.className = "currency-mark";
  currencyMark.textContent = "$";
  var amountInput = document.createElement("input");
  amountInput.className = "amount-input";
  amountInput.type = "number";
  amountInput.min = "0";
  amountInput.step = "0.01";
  amountInput.value = bill.amount ? String(bill.amount) : "";
  amountInput.oninput = function (event) {
    var nextAmount = parseFloat(event.target.value);
    bill.amount = isFinite(nextAmount) ? nextAmount : 0;
    renderSummary();
    queueSave(bill);
  };
  amountBox.appendChild(currencyMark);
  amountBox.appendChild(amountInput);
  amountWrap.appendChild(amountLabel);
  amountWrap.appendChild(amountBox);

  topRow.appendChild(nameWrap);
  topRow.appendChild(amountWrap);

  var bottomRow = document.createElement("div");
  bottomRow.className = "bill-bottom-row";

  var toggleGroup = document.createElement("div");
  toggleGroup.className = "toggle-group";
  toggleGroup.appendChild(createToggleButton(bill, "NO", "Unpaid"));
  toggleGroup.appendChild(createToggleButton(bill, "YES", "Paid"));

  var deleteButton = document.createElement("button");
  deleteButton.className = "delete-link";
  deleteButton.type = "button";
  deleteButton.textContent = "Delete";
  deleteButton.onclick = function () {
    setSyncStatus("Saving", "");
    requestJson("DELETE", "/api/bills/" + bill.id, null, function (error) {
      if (error) {
        setSyncStatus("Save failed", "sync-error");
        return;
      }

      var nextBills = [];
      for (var i = 0; i < state.bills.length; i += 1) {
        if (state.bills[i].id !== bill.id) nextBills.push(state.bills[i]);
      }
      state.bills = nextBills;
      renderBills();
      renderSummary();
      setSyncStatus("Synced", "sync-ok");
    });
  };

  bottomRow.appendChild(toggleGroup);
  bottomRow.appendChild(deleteButton);

  card.appendChild(topRow);
  card.appendChild(bottomRow);
  return card;
}

function createToggleButton(bill, value, label) {
  var button = document.createElement("button");
  button.className = "toggle-button" + (bill.paid === value ? " is-active" : "");
  button.type = "button";
  button.textContent = label;
  button.onclick = function () {
    if (bill.paid === value) return;
    bill.paid = value;
    renderBills();
    renderSummary();
    saveBillNow(bill);
  };
  return button;
}

function queueSave(bill) {
  setSyncStatus("Saving", "");
  if (state.saveTimers[bill.id]) clearTimeout(state.saveTimers[bill.id]);
  state.saveTimers[bill.id] = setTimeout(function () {
    delete state.saveTimers[bill.id];
    saveBillNow(bill);
  }, 350);
}

function saveBillNow(bill) {
  requestJson("PATCH", "/api/bills/" + bill.id, { name: bill.name, amount: bill.amount, paid: bill.paid }, function (error, savedBill) {
    if (error) {
      setSyncStatus("Save failed", "sync-error");
      return;
    }

    for (var i = 0; i < state.bills.length; i += 1) {
      if (state.bills[i].id === savedBill.id) {
        state.bills[i] = savedBill;
        break;
      }
    }

    renderBills();
    renderSummary();
    setSyncStatus("Synced", "sync-ok");
  });
}

function renderSummary() {
  var paidTotal = 0;
  var unpaidTotal = 0;

  for (var i = 0; i < state.bills.length; i += 1) {
    var amount = isFinite(state.bills[i].amount) ? state.bills[i].amount : 0;
    if (state.bills[i].paid === "YES") paidTotal += amount;
    else unpaidTotal += amount;
  }

  elements.unpaidTotal.textContent = formatCurrency(unpaidTotal);
  elements.paidTotal.textContent = formatCurrency(paidTotal);
  elements.tithesTotal.textContent = formatCurrency(paidTotal * state.tithesRate);
  elements.tithesRate.textContent = Math.round(state.tithesRate * 100) + "% rate";
  elements.asOfLabel.textContent = labelForMonth(state.selectedMonth);
}

function labelForMonth(monthKey) {
  for (var i = 0; i < state.months.length; i += 1) {
    if (state.months[i].value === monthKey) return state.months[i].label;
  }
  return monthKey;
}

function setSyncStatus(label, className) {
  elements.syncStatus.textContent = label;
  elements.syncStatus.className = className ? "sync-status " + className : "sync-status";
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function requestJson(method, url, body, callback) {
  var request = new XMLHttpRequest();
  request.open(method, url, true);
  request.setRequestHeader("Accept", "application/json");
  if (body) request.setRequestHeader("Content-Type", "application/json");

  request.onreadystatechange = function () {
    if (request.readyState !== 4) return;
    if (request.status >= 200 && request.status < 300) {
      if (!request.responseText) return callback(null, null);
      try {
        return callback(null, JSON.parse(request.responseText));
      } catch (error) {
        return callback(error);
      }
    }
    callback(new Error("Request failed with status " + request.status));
  };

  request.onerror = function () {
    callback(new Error("Network request failed"));
  };

  request.send(body ? JSON.stringify(body) : null);
}
