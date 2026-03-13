var DEFAULT_TITHES_RATE = 0.1;
var SAVE_DEBOUNCE_MS = 400;

var state = {
  bills: [],
  tithesRate: DEFAULT_TITHES_RATE,
  saveTimers: {}
};

var elements = {
  billsList: document.getElementById("bills-list"),
  unpaidTotal: document.getElementById("unpaid-total"),
  paidTotal: document.getElementById("paid-total"),
  tithesRate: document.getElementById("tithes-rate"),
  tithesTotal: document.getElementById("tithes-total"),
  asOfLabel: document.getElementById("as-of-label"),
  syncStatus: document.getElementById("sync-status"),
  addBillButton: document.getElementById("add-bill-button"),
  resetButton: document.getElementById("reset-button")
};

boot();

function boot() {
  bindActions();
  loadState();
}

function bindActions() {
  elements.addBillButton.onclick = addBill;
  elements.resetButton.onclick = resetBills;
}

function loadState() {
  setSyncStatus("Loading", "");

  requestJson("GET", "/api/state", null, function (error, payload) {
    if (error) {
      console.error(error);
      setSyncStatus("Offline", "sync-error");
      return;
    }

    state.bills = payload && payload.bills ? payload.bills : [];
    state.tithesRate = payload && typeof payload.tithesRate === "number" ? payload.tithesRate : DEFAULT_TITHES_RATE;
    render();
    setSyncStatus("Synced", "sync-ok");
  });
}

function addBill() {
  setSyncStatus("Saving", "");

  requestJson("POST", "/api/bills", { name: "", amount: 0, paid: "NO" }, function (error, bill) {
    if (error) {
      console.error(error);
      setSyncStatus("Save failed", "sync-error");
      return;
    }

    state.bills.push(bill);
    render();
    setSyncStatus("Synced", "sync-ok");
  });
}

function resetBills() {
  setSyncStatus("Saving", "");

  requestJson("POST", "/api/reset", {}, function (error) {
    if (error) {
      console.error(error);
      setSyncStatus("Save failed", "sync-error");
      return;
    }

    for (var i = 0; i < state.bills.length; i += 1) {
      state.bills[i].paid = "NO";
    }

    render();
    setSyncStatus("Synced", "sync-ok");
  });
}

function render() {
  elements.billsList.innerHTML = "";

  for (var i = 0; i < state.bills.length; i += 1) {
    elements.billsList.appendChild(createBillCard(state.bills[i]));
  }

  renderSummary();
}

function createBillCard(bill) {
  var card = document.createElement("article");
  card.className = "bill-card" + (bill.paid === "YES" ? " bill-paid" : "");

  var topRow = document.createElement("div");
  topRow.className = "bill-top-row";

  var nameWrap = document.createElement("label");
  nameWrap.className = "bill-name-wrap";
  var nameLabel = document.createElement("span");
  nameLabel.className = "field-label";
  nameLabel.textContent = "Bill";
  var nameInput = document.createElement("input");
  nameInput.className = "bill-name-input";
  nameInput.type = "text";
  nameInput.value = bill.name;
  nameInput.setAttribute("aria-label", "Bill name");
  nameInput.oninput = function (event) {
    bill.name = event.target.value;
    queueSave(bill);
  };
  nameWrap.appendChild(nameLabel);
  nameWrap.appendChild(nameInput);

  var amountWrap = document.createElement("label");
  amountWrap.className = "bill-amount-wrap";
  var amountLabel = document.createElement("span");
  amountLabel.className = "field-label";
  amountLabel.textContent = "Amount";
  var amountBox = document.createElement("div");
  amountBox.className = "amount-input-wrap";
  var currencyMark = document.createElement("span");
  currencyMark.className = "currency-mark";
  currencyMark.textContent = "$";
  var amountInput = document.createElement("input");
  amountInput.className = "bill-amount-input";
  amountInput.type = "number";
  amountInput.min = "0";
  amountInput.step = "0.01";
  amountInput.setAttribute("inputmode", "decimal");
  amountInput.setAttribute("aria-label", "Bill amount");
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
  toggleGroup.setAttribute("role", "group");
  toggleGroup.setAttribute("aria-label", "Paid status");
  toggleGroup.appendChild(createToggleButton(bill, "NO", "Unpaid"));
  toggleGroup.appendChild(createToggleButton(bill, "YES", "Paid"));

  var deleteButton = document.createElement("button");
  deleteButton.className = "delete-link delete-row-button";
  deleteButton.type = "button";
  deleteButton.textContent = "Delete";
  deleteButton.onclick = function () {
    setSyncStatus("Saving", "");
    requestJson("DELETE", "/api/bills/" + bill.id, null, function (error) {
      if (error) {
        console.error(error);
        setSyncStatus("Save failed", "sync-error");
        return;
      }

      var nextBills = [];
      for (var i = 0; i < state.bills.length; i += 1) {
        if (state.bills[i].id !== bill.id) nextBills.push(state.bills[i]);
      }
      state.bills = nextBills;
      render();
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
  button.setAttribute("data-value", value);
  button.textContent = label;
  button.onclick = function () {
    if (bill.paid === value) return;
    bill.paid = value;
    render();
    saveBillNow(bill);
  };
  return button;
}

function queueSave(bill) {
  setSyncStatus("Saving", "");
  if (state.saveTimers[bill.id]) {
    clearTimeout(state.saveTimers[bill.id]);
  }

  state.saveTimers[bill.id] = setTimeout(function () {
    delete state.saveTimers[bill.id];
    saveBillNow(bill);
  }, SAVE_DEBOUNCE_MS);
}

function saveBillNow(bill) {
  requestJson("PATCH", "/api/bills/" + bill.id, {
    name: bill.name,
    amount: bill.amount,
    paid: bill.paid
  }, function (error, savedBill) {
    if (error) {
      console.error(error);
      setSyncStatus("Save failed", "sync-error");
      return;
    }

    for (var i = 0; i < state.bills.length; i += 1) {
      if (state.bills[i].id === savedBill.id) {
        state.bills[i] = savedBill;
        break;
      }
    }

    render();
    setSyncStatus("Synced", "sync-ok");
  });
}

function renderSummary() {
  var paidTotal = sumBills(function (bill) { return bill.paid === "YES"; });
  var unpaidTotal = sumBills(function (bill) { return bill.paid !== "YES"; });
  var tithesTotal = paidTotal * state.tithesRate;

  elements.unpaidTotal.textContent = formatCurrency(unpaidTotal);
  elements.paidTotal.textContent = formatCurrency(paidTotal);
  elements.tithesRate.textContent = Math.round(state.tithesRate * 100) + "%";
  elements.tithesTotal.textContent = formatCurrency(tithesTotal);
  elements.asOfLabel.textContent = "As of " + formatDate(new Date());
}

function sumBills(predicate) {
  var total = 0;
  for (var i = 0; i < state.bills.length; i += 1) {
    if (predicate(state.bills[i])) {
      total += normalizeAmount(state.bills[i].amount);
    }
  }
  return total;
}

function normalizeAmount(amount) {
  return isFinite(amount) ? amount : 0;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }).format(date);
}

function setSyncStatus(label, className) {
  elements.syncStatus.textContent = label;
  elements.syncStatus.className = className ? "sync-status " + className : "sync-status";
}

function requestJson(method, url, body, callback) {
  var request = new XMLHttpRequest();
  request.open(method, url, true);
  request.setRequestHeader("Accept", "application/json");

  if (body) {
    request.setRequestHeader("Content-Type", "application/json");
  }

  request.onreadystatechange = function () {
    if (request.readyState !== 4) return;

    if (request.status >= 200 && request.status < 300) {
      if (!request.responseText) {
        callback(null, null);
        return;
      }

      try {
        callback(null, JSON.parse(request.responseText));
      } catch (error) {
        callback(error);
      }
      return;
    }

    callback(new Error("Request failed with status " + request.status));
  };

  request.onerror = function () {
    callback(new Error("Network request failed"));
  };

  request.send(body ? JSON.stringify(body) : null);
}
