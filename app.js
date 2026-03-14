var state = {
  authenticated: false,
  currentUser: null,
  currentView: "dashboard",
  selectedMonth: "2026-03",
  months: [],
  bills: [],
  taxDocs: [],
  taxCategories: [],
  taxYears: [],
  taxFilters: { search: "", category: "all", year: "all" },
  tithesRate: 0.1,
  saveTimers: {}
};

var elements = {
  loginView: document.getElementById("login-view"),
  appView: document.getElementById("app-view"),
  loginForm: document.getElementById("login-form"),
  loginPhone: document.getElementById("login-phone"),
  loginPassword: document.getElementById("login-password"),
  loginStatus: document.getElementById("login-status"),
  logoutButton: document.getElementById("logout-button"),
  userName: document.getElementById("user-name"),
  userRole: document.getElementById("user-role"),
  homeButton: document.getElementById("home-button"),
  dashboardView: document.getElementById("dashboard-view"),
  expensesView: document.getElementById("expenses-view"),
  taxDocsView: document.getElementById("tax-docs-view"),
  expensesModule: document.getElementById("expenses-module"),
  taxDocsModule: document.getElementById("tax-docs-module"),
  backButton: document.getElementById("back-button"),
  taxBackButton: document.getElementById("tax-back-button"),
  monthSelector: document.getElementById("month-selector"),
  syncStatus: document.getElementById("sync-status"),
  taxSyncStatus: document.getElementById("tax-sync-status"),
  unpaidTotal: document.getElementById("unpaid-total"),
  paidTotal: document.getElementById("paid-total"),
  tithesTotal: document.getElementById("tithes-total"),
  tithesRate: document.getElementById("tithes-rate"),
  asOfLabel: document.getElementById("as-of-label"),
  addBillButton: document.getElementById("add-bill-button"),
  resetButton: document.getElementById("reset-button"),
  billsList: document.getElementById("bills-list"),
  taxDocsList: document.getElementById("tax-docs-list"),
  taxUploadForm: document.getElementById("tax-upload-form"),
  taxPdfInput: document.getElementById("tax-pdf-input"),
  taxCategoryInput: document.getElementById("tax-category-input"),
  taxYearInput: document.getElementById("tax-year-input"),
  taxNotesInput: document.getElementById("tax-notes-input"),
  taxSearchInput: document.getElementById("tax-search-input"),
  taxFilterCategory: document.getElementById("tax-filter-category"),
  taxFilterYear: document.getElementById("tax-filter-year")
};

boot();

function boot() {
  bindActions();
  window.onhashchange = syncViewFromHash;
  checkSession();
}

function bindActions() {
  elements.loginForm.onsubmit = function (event) {
    event.preventDefault();
    login();
  };
  elements.loginPhone.oninput = function (event) {
    event.target.value = formatPhoneInput(event.target.value);
  };
  elements.logoutButton.onclick = logout;
  elements.expensesModule.onclick = function () { showExpenses(); };
  elements.taxDocsModule.onclick = function () { showTaxDocs(); };
  elements.homeButton.onclick = function () { showDashboard(); };
  elements.backButton.onclick = function () { showDashboard(); };
  elements.taxBackButton.onclick = function () { showDashboard(); };
  elements.monthSelector.onchange = function (event) { state.selectedMonth = event.target.value; loadMonth(); };
  elements.addBillButton.onclick = addBill;
  elements.resetButton.onclick = resetBills;
  elements.taxUploadForm.onsubmit = function (event) { event.preventDefault(); uploadTaxDoc(); };
  elements.taxSearchInput.oninput = function (event) { state.taxFilters.search = event.target.value; loadTaxDocs(); };
  elements.taxFilterCategory.onchange = function (event) { state.taxFilters.category = event.target.value; loadTaxDocs(); };
  elements.taxFilterYear.onchange = function (event) { state.taxFilters.year = event.target.value; loadTaxDocs(); };
}

function checkSession() {
  setLoginStatus("Checking session", "");
  requestJson("GET", "/api/auth/session", null, function (error, payload) {
    if (error) {
      if (error.statusCode === 401) return enterLoggedOutState();
      return setLoginStatus("Unable to connect", "sync-error");
    }
    enterLoggedInState(payload);
    loadBootstrap();
  });
}

function login() {
  var phone = elements.loginPhone.value || "";
  var password = elements.loginPassword.value || "";
  if (!normalizePhone(phone)) return setLoginStatus("Enter a valid phone number", "sync-error");
  if (!password) return setLoginStatus("Enter your password", "sync-error");

  setLoginStatus("Signing in", "");
  requestJson("POST", "/api/auth/login", { phone: phone, password: password }, function (error, payload) {
    if (error) {
      return setLoginStatus(error.message || "Sign in failed", "sync-error");
    }
    elements.loginPassword.value = "";
    enterLoggedInState(payload);
    loadBootstrap();
  });
}

function logout() {
  requestJson("POST", "/api/auth/logout", {}, function () {
    enterLoggedOutState();
  });
}

function enterLoggedOutState() {
  state.authenticated = false;
  state.currentUser = null;
  elements.loginView.className = "auth-shell";
  elements.appView.className = "app-view is-hidden";
  setLoginStatus("Sign in with your phone number", "");
}

function enterLoggedInState(payload) {
  state.authenticated = true;
  state.currentUser = payload && payload.user ? payload.user : null;
  elements.loginView.className = "auth-shell is-hidden";
  elements.appView.className = "app-view";
  elements.userName.textContent = state.currentUser ? state.currentUser.name : "Account";
  elements.userRole.textContent = state.currentUser ? prettyRole(state.currentUser.role) : "User";
  setLoginStatus("Signed in", "sync-ok");
}

function loadBootstrap() {
  requestJson("GET", "/api/bootstrap", null, function (error, payload) {
    if (error) return handleApiError(error, setSyncStatus, "Offline");
    state.months = payload.months || [];
    state.selectedMonth = payload.selectedMonth || "2026-03";
    state.tithesRate = payload.tithesRate || 0.1;
    state.taxCategories = payload.taxCategories || [];
    state.taxYears = payload.taxYears || [];
    renderMonthOptions();
    renderTaxMetaOptions();
    syncViewFromHash();
  });
}

function renderMonthOptions() {
  elements.monthSelector.innerHTML = "";
  for (var i = 0; i < state.months.length; i += 1) {
    var option = document.createElement("option");
    option.value = state.months[i].value;
    option.textContent = state.months[i].label;
    option.selected = state.months[i].value === state.selectedMonth;
    elements.monthSelector.appendChild(option);
  }
}

function renderTaxMetaOptions() {
  renderOptions(elements.taxCategoryInput, state.taxCategories, null, null);
  renderOptions(elements.taxYearInput, state.taxYears, null, null);
  renderOptions(elements.taxFilterCategory, state.taxCategories, "all", "All categories");
  renderOptions(elements.taxFilterYear, state.taxYears, "all", "All years");
}

function renderOptions(target, items, allValue, allLabel) {
  target.innerHTML = "";
  if (allValue) {
    var allOption = document.createElement("option");
    allOption.value = allValue;
    allOption.textContent = allLabel;
    target.appendChild(allOption);
  }
  for (var i = 0; i < items.length; i += 1) {
    var option = document.createElement("option");
    option.value = String(items[i]);
    option.textContent = String(items[i]);
    target.appendChild(option);
  }
}

function syncViewFromHash() {
  if (!state.authenticated) return showLogin();
  var hash = window.location.hash || "#dashboard";
  if (hash === "#expenses") return showExpenses(true);
  if (hash === "#tax-docs") return showTaxDocs(true);
  return showDashboard(true);
}

function showLogin() {
  elements.loginView.className = "auth-shell";
  elements.appView.className = "app-view is-hidden";
}

function setHash(hash) {
  if (window.location.hash !== hash) window.location.hash = hash;
}

function showDashboard(skipHash) {
  state.currentView = "dashboard";
  elements.dashboardView.className = "view-section";
  elements.expensesView.className = "view-section is-hidden";
  elements.taxDocsView.className = "view-section is-hidden";
  if (!skipHash) setHash("#dashboard");
}

function showExpenses(skipHash) {
  state.currentView = "expenses";
  elements.dashboardView.className = "view-section is-hidden";
  elements.expensesView.className = "view-section";
  elements.taxDocsView.className = "view-section is-hidden";
  if (!skipHash) setHash("#expenses");
  loadMonth();
}

function showTaxDocs(skipHash) {
  state.currentView = "tax-docs";
  elements.dashboardView.className = "view-section is-hidden";
  elements.expensesView.className = "view-section is-hidden";
  elements.taxDocsView.className = "view-section";
  if (!skipHash) setHash("#tax-docs");
  loadTaxDocs();
}

function loadMonth() {
  setSyncStatus("Loading", "");
  requestJson("GET", "/api/state?month=" + encodeURIComponent(state.selectedMonth), null, function (error, payload) {
    if (error) return handleApiError(error, setSyncStatus, "Offline");
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
    if (error) return handleApiError(error, setSyncStatus, "Save failed");
    state.bills.push(bill);
    renderBills();
    renderSummary();
    setSyncStatus("Synced", "sync-ok");
  });
}

function resetBills() {
  setSyncStatus("Saving", "");
  requestJson("POST", "/api/reset?month=" + encodeURIComponent(state.selectedMonth), {}, function (error) {
    if (error) return handleApiError(error, setSyncStatus, "Save failed");
    for (var i = 0; i < state.bills.length; i += 1) state.bills[i].paid = "NO";
    renderBills();
    renderSummary();
    setSyncStatus("Synced", "sync-ok");
  });
}

function renderBills() {
  elements.billsList.innerHTML = "";
  for (var i = 0; i < state.bills.length; i += 1) elements.billsList.appendChild(createBillCard(state.bills[i]));
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
  nameInput.oninput = function (event) { bill.name = event.target.value; queueSave(bill); };
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
      if (error) return handleApiError(error, setSyncStatus, "Save failed");
      var nextBills = [];
      for (var i = 0; i < state.bills.length; i += 1) if (state.bills[i].id !== bill.id) nextBills.push(state.bills[i]);
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
    if (error) return handleApiError(error, setSyncStatus, "Save failed");
    for (var i = 0; i < state.bills.length; i += 1) if (state.bills[i].id === savedBill.id) state.bills[i] = savedBill;
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
  for (var i = 0; i < state.months.length; i += 1) if (state.months[i].value === monthKey) return state.months[i].label;
  return monthKey;
}

function loadTaxDocs() {
  setTaxSyncStatus("Loading", "");
  var params = [];
  if (state.taxFilters.search) params.push("search=" + encodeURIComponent(state.taxFilters.search));
  if (state.taxFilters.category !== "all") params.push("category=" + encodeURIComponent(state.taxFilters.category));
  if (state.taxFilters.year !== "all") params.push("taxYear=" + encodeURIComponent(state.taxFilters.year));
  var url = "/api/tax-docs" + (params.length ? "?" + params.join("&") : "");
  requestJson("GET", url, null, function (error, payload) {
    if (error) return handleApiError(error, setTaxSyncStatus, "Offline");
    state.taxDocs = payload.docs || [];
    renderTaxDocs();
    setTaxSyncStatus("Ready", "sync-ok");
  });
}

function uploadTaxDoc() {
  var file = elements.taxPdfInput.files && elements.taxPdfInput.files[0];
  if (!file) return setTaxSyncStatus("Choose a PDF", "sync-error");
  if (!/pdf$/i.test(file.name) && file.type !== "application/pdf") return setTaxSyncStatus("PDF only", "sync-error");

  setTaxSyncStatus("Uploading", "");
  uploadFormData(file, function (error) {
    if (error) return handleApiError(error, setTaxSyncStatus, error.message || "Upload failed");
    elements.taxPdfInput.value = "";
    elements.taxNotesInput.value = "";
    loadTaxDocs();
  });
}

function renderTaxDocs() {
  elements.taxDocsList.innerHTML = "";
  if (!state.taxDocs.length) {
    var empty = document.createElement("div");
    empty.className = "empty-card";
    empty.textContent = "No matching tax PDFs yet.";
    elements.taxDocsList.appendChild(empty);
    return;
  }
  for (var i = 0; i < state.taxDocs.length; i += 1) elements.taxDocsList.appendChild(createTaxDocCard(state.taxDocs[i]));
}

function createTaxDocCard(doc) {
  var card = document.createElement("article");
  card.className = "tax-doc-card";
  var meta = document.createElement("div");
  meta.className = "tax-doc-meta";
  var title = document.createElement("strong");
  title.className = "tax-doc-title";
  title.textContent = doc.original_name;
  var chips = document.createElement("div");
  chips.className = "doc-chip-row";
  chips.appendChild(createDocChip(doc.category));
  if (doc.tax_year) chips.appendChild(createDocChip(String(doc.tax_year)));
  var details = document.createElement("span");
  details.className = "tax-doc-details";
  details.textContent = formatBytes(doc.byte_size) + " • " + formatDateTime(doc.uploaded_at);
  meta.appendChild(title);
  meta.appendChild(chips);
  if (doc.notes) {
    var notes = document.createElement("p");
    notes.className = "doc-notes";
    notes.textContent = doc.notes;
    meta.appendChild(notes);
  }
  meta.appendChild(details);

  var actions = document.createElement("div");
  actions.className = "tax-doc-actions";
  actions.appendChild(createLinkButton("View", "/api/tax-docs/" + doc.id + "/view"));
  actions.appendChild(createLinkButton("Download", "/api/tax-docs/" + doc.id + "/download"));

  var deleteButton = document.createElement("button");
  deleteButton.className = "delete-link";
  deleteButton.type = "button";
  deleteButton.textContent = "Delete";
  deleteButton.onclick = function () {
    setTaxSyncStatus("Saving", "");
    requestJson("DELETE", "/api/tax-docs/" + doc.id, null, function (error) {
      if (error) return handleApiError(error, setTaxSyncStatus, "Delete failed");
      loadTaxDocs();
    });
  };
  actions.appendChild(deleteButton);

  card.appendChild(meta);
  card.appendChild(actions);
  return card;
}

function createDocChip(label) {
  var chip = document.createElement("span");
  chip.className = "doc-chip";
  chip.textContent = label;
  return chip;
}

function createLinkButton(label, href) {
  var link = document.createElement("a");
  link.className = "mini-button";
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = label;
  return link;
}

function handleApiError(error, statusSetter, fallbackLabel) {
  if (error && error.statusCode === 401) {
    enterLoggedOutState();
    return setLoginStatus("Session expired. Sign in again.", "sync-error");
  }
  statusSetter(fallbackLabel, "sync-error");
}

function setLoginStatus(label, className) {
  elements.loginStatus.textContent = label;
  elements.loginStatus.className = className ? "auth-status sync-status " + className : "auth-status sync-status";
}

function setSyncStatus(label, className) {
  elements.syncStatus.textContent = label;
  elements.syncStatus.className = className ? "sync-status " + className : "sync-status";
}

function setTaxSyncStatus(label, className) {
  elements.taxSyncStatus.textContent = label;
  elements.taxSyncStatus.className = className ? "sync-status " + className : "sync-status";
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatBytes(value) {
  if (value >= 1024 * 1024) return (value / (1024 * 1024)).toFixed(1) + " MB";
  return Math.max(1, Math.round(value / 1024)) + " KB";
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function prettyRole(role) {
  if (role === "admin") return "Admin";
  if (role === "read_only") return "Read only";
  return "User";
}

function normalizePhone(value) {
  var digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.charAt(0) === "1") digits = digits.slice(1);
  return digits.length === 10 ? digits : "";
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
      try { return callback(null, JSON.parse(request.responseText)); }
      catch (error) { return callback(error); }
    }
    try {
      var parsed = request.responseText ? JSON.parse(request.responseText) : null;
      var apiError = new Error(parsed && parsed.error ? parsed.error : "Request failed with status " + request.status);
      apiError.statusCode = request.status;
      callback(apiError);
    } catch (error) {
      var fallbackError = new Error("Request failed with status " + request.status);
      fallbackError.statusCode = request.status;
      callback(fallbackError);
    }
  };
  request.onerror = function () {
    var networkError = new Error("Network request failed");
    networkError.statusCode = 0;
    callback(networkError);
  };
  request.send(body ? JSON.stringify(body) : null);
}

function uploadFormData(file, callback) {
  var formData = new FormData();
  formData.append("file", file);
  formData.append("category", elements.taxCategoryInput.value || "Other");
  formData.append("taxYear", elements.taxYearInput.value || "");
  formData.append("notes", elements.taxNotesInput.value || "");
  var request = new XMLHttpRequest();
  request.open("POST", "/api/tax-docs", true);
  request.onreadystatechange = function () {
    if (request.readyState !== 4) return;
    if (request.status >= 200 && request.status < 300) {
      try { callback(null, JSON.parse(request.responseText)); }
      catch (error) { callback(error); }
      return;
    }
    try {
      var parsed = request.responseText ? JSON.parse(request.responseText) : null;
      var apiError = new Error(parsed && parsed.error ? parsed.error : "Upload failed");
      apiError.statusCode = request.status;
      callback(apiError);
    } catch (error) {
      var fallbackError = new Error("Upload failed");
      fallbackError.statusCode = request.status;
      callback(fallbackError);
    }
  };
  request.onerror = function () {
    var networkError = new Error("Network request failed");
    networkError.statusCode = 0;
    callback(networkError);
  };
  request.send(formData);
}


