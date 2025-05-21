// ========== CONSTANTS & INITIAL STATE ========== //
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzB0gYjzugEpx1-ku83sbtvCLjiWdMWyv70mn0jVQYGKGbdObc4g3skjMDPqDu-1Fmr4w/exec';
const DB_NAME = 'GemstoneDB';
const DB_VERSION = 7;
let db;
let isSyncing = false;

let accountingData = {
  transactions: [],
  expenses: [],
  employees: [],
  settings: {
    defaultExchangeRate: 50.00,
    defaultCommission: 2,
    profitSharing: { partnerA: 60, partnerB: 40 },
    dateFormat: 'YYYY-MM-DD',
    lastSync: null,
    appName: 'Gemstone Tracker',
    titleFontWeight: 600
  }
};

// ========== INDEXEDDB IMPLEMENTATION ========== //
async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      showError(`Database error: ${event.target.error}`);
      reject(event.target.error);
    };

    request.onupgradeneeded = (event) => {
      const oldVersion = event.oldVersion;
      db = event.target.result;

      // Create object stores if they don't exist
      if (!db.objectStoreNames.contains('transactions')) {
        const txStore = db.createObjectStore('transactions', {
          keyPath: 'id',
          autoIncrement: true
        });
        txStore.createIndex('date_status', ['date', 'status']);
        txStore.createIndex('saleId_status', ['saleId', 'status'], { unique: true });
        txStore.createIndex('canceled', 'canceled');
      }

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'name' });
      }

      if (!db.objectStoreNames.contains('expenses')) {
        const expenseStore = db.createObjectStore('expenses', {
          keyPath: 'id',
          autoIncrement: true
        });
        expenseStore.createIndex('date', 'date');
        expenseStore.createIndex('type', 'type');
      }

      if (!db.objectStoreNames.contains('employees')) {
        const employeeStore = db.createObjectStore('employees', {
          keyPath: 'id',
          autoIncrement: true
        });
        employeeStore.createIndex('name', 'name', { unique: true });
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      loadInitialData().then(resolve).catch(reject);
    };
  });
}

async function loadInitialData() {
  try {
    const [settings, transactions, expenses, employees] = await Promise.all([
      getAll('settings'),
      getAll('transactions'),
      getAll('expenses'),
      getAll('employees')
    ]);

    // Apply settings
    settings.forEach(setting => {
      accountingData.settings[setting.name] = setting.value;
    });

    // Set default values if not present
    if (!accountingData.settings.appName) {
      accountingData.settings.appName = 'Gemstone Tracker';
    }
    if (!accountingData.settings.titleFontWeight) {
      accountingData.settings.titleFontWeight = 600;
    }

    // Initialize data arrays
    accountingData.transactions = transactions;
    accountingData.expenses = expenses;
    accountingData.employees = employees;

    // Update UI with settings
    updateUIWithSettings();

    // If no settings exist, create default ones
    if (settings.length === 0) {
      await Promise.all([
        add('settings', { name: 'defaultExchangeRate', value: 50.00 }),
        add('settings', { name: 'defaultCommission', value: 2 }),
        add('settings', { name: 'profitSharing', value: { partnerA: 60, partnerB: 40 } }),
        add('settings', { name: 'appName', value: 'Gemstone Tracker' }),
        add('settings', { name: 'titleFontWeight', value: 600 })
      ]);
    }

    // Initialize form fields
    initializeForms();
  } catch (error) {
    showError(`Failed to load initial data: ${error.message}`);
    throw error;
  }
}

async function logout() {
  try {
    await logoutUser();
    window.location.href = 'login.html';
  } catch (error) {
    showError(`Logout failed: ${error.message}`);
  }
}

function updateUIWithSettings() {
  const { appName, titleFontWeight } = accountingData.settings;
  document.getElementById('dynamicTitle').textContent = appName;
  document.getElementById('appTitleDisplay').textContent = appName;
  document.querySelector('.app-title').style.fontWeight = titleFontWeight;

  // Update form fields
  document.getElementById('appName').value = appName;
  document.getElementById('titleFontWeight').value = titleFontWeight;
  document.getElementById('defaultExchangeRate').value = accountingData.settings.defaultExchangeRate;
  document.getElementById('defaultCommission').value = accountingData.settings.defaultCommission;
  document.getElementById('partnerAShare').value = accountingData.settings.profitSharing.partnerA;
  document.getElementById('partnerBShare').value = accountingData.settings.profitSharing.partnerB;
}

function initializeForms() {
  // Set initial sale ID
  document.getElementById('saleId').value = generateNextSaleId();
  document.getElementById('exchangeRate').value = accountingData.settings.defaultExchangeRate;
  document.getElementById('commission').value = accountingData.settings.defaultCommission;

  // Set default dates in reports
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

  document.getElementById('reportStartDate').value = firstDay;
  document.getElementById('reportEndDate').value = lastDay;
  document.getElementById('txnDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('expenseDate').value = new Date().toISOString().split('T')[0];

  // Initialize employee list
  renderEmployeeList();

  // Setup form listeners
  setupTransactionFormListeners();
}

function setupTransactionFormListeners() {
  const calcInputs = ['weight', 'purchasePrice', 'certCharges', 'exchangeRate', 'soldPriceRMB', 'commission'];
  calcInputs.forEach(id => {
    document.getElementById(id).addEventListener('input', updateCalculations);
  });
}

// ========== DB HELPER FUNCTIONS ========== //
function getObjectStore(storeName, mode = 'readonly') {
  const tx = db.transaction(storeName, mode);
  return tx.objectStore(storeName);
}

async function add(storeName, item) {
  return new Promise((resolve, reject) => {
    const store = getObjectStore(storeName, 'readwrite');
    const request = store.add(item);

    request.onsuccess = () => resolve(request.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

async function getAll(storeName) {
  return new Promise((resolve, reject) => {
    const store = getObjectStore(storeName);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (event) => reject(event.target.error);
  });
}

async function update(storeName, item) {
  return new Promise((resolve, reject) => {
    const store = getObjectStore(storeName, 'readwrite');
    const request = store.put(item);

    request.onsuccess = () => resolve(request.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

async function clearStore(storeName) {
  return new Promise((resolve, reject) => {
    const store = getObjectStore(storeName, 'readwrite');
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = (event) => reject(event.target.error);
  });
}

async function deleteExpense(id) {
  return new Promise((resolve, reject) => {
    const store = getObjectStore('expenses', 'readwrite');
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = (event) => reject(event.target.error);
  });
}

// ========== CORE FUNCTIONALITY ========== //
function generateNextSaleId() {
  const maxId = accountingData.transactions.reduce((max, t) => {
    const num = parseInt(t.saleId?.replace(/\D/g, '')) || 0;
    return num > max ? num : max;
  }, 0);
  return `GS-${String(maxId + 1).padStart(5, '0')}`;
}

// ========== TAB MANAGEMENT ========== //
function setupTabListeners() {
  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', (event) => {
      const tabName = event.currentTarget.dataset.tab;
      showTab(tabName);
    });
  });

  // Sub-tab switching
  document.querySelectorAll('.sub-tab').forEach(tab => {
    tab.addEventListener('click', (event) => {
      const tabName = event.currentTarget.dataset.subtab;
      showSubTab(tabName);
    });
  });
}

function showTab(tabName) {
  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(el => {
    el.classList.remove('active');
  });

  // Deactivate all tab buttons
  document.querySelectorAll('.tab').forEach(el => {
    el.classList.remove('active');
  });

  // Activate selected tab
  document.getElementById(tabName).classList.add('active');
  document.querySelector(`.tab[data-tab="${tabName}"]`).classList.add('active');

  // Load content if needed
  switch (tabName) {
    case 'reports':
      if (document.getElementById('reportResults').innerHTML === '') {
        generateReport();
      }
      break;
    case 'settings':
      if (document.getElementById('employeeList').innerHTML === '') {
        renderEmployeeList();
      }
      break;
    case 'expenses':
      loadRecentExpenses();
      break;
  }
}

function showSubTab(tabName) {
  // Deactivate all sub-tab buttons
  document.querySelectorAll('.sub-tab').forEach(el => {
    el.classList.remove('active');
  });

  // Activate selected sub-tab
  document.querySelector(`.sub-tab[data-subtab="${tabName}"]`).classList.add('active');

  // Generate report if needed
  if (document.getElementById('reports').classList.contains('active')) {
    generateReport();
  }
}

// ========== TRANSACTION MANAGEMENT ========== //
function updateCalculations() {
  const getValue = id => parseFloat(document.getElementById(id).value) || 0;

  const purchasePriceLKR = getValue('purchasePrice');
  const certChargesLKR = getValue('certCharges');
  const soldPriceRMB = getValue('soldPriceRMB');
  const exchangeRate = getValue('exchangeRate');
  const commissionRate = getValue('commission') / 100;

  const purchaseCommissionLKR = purchasePriceLKR * commissionRate;
  const netSoldPriceRMB = soldPriceRMB - (soldPriceRMB * commissionRate);
  const soldPriceLKR = netSoldPriceRMB * exchangeRate;
  const totalCostLKR = purchasePriceLKR + certChargesLKR + purchaseCommissionLKR;
  const profitLKR = soldPriceLKR - totalCostLKR;

  document.getElementById('totalcostDisplay').textContent = `Rs.${totalCostLKR.toFixed(2)}`;
  document.getElementById('convertedsaleDisplay').textContent = `Rs.${soldPriceLKR.toFixed(2)}`;

  const profitDisplay = document.getElementById('netprofitLossDisplay');
  profitDisplay.textContent = `Rs.${Math.abs(profitLKR).toFixed(2)} (${profitLKR >= 0 ? 'Profit' : 'Loss'})`;
  profitDisplay.className = profitLKR >= 0 ? 'profit' : 'loss';
}

async function saveTransaction() {
  const getValue = id => parseFloat(document.getElementById(id).value) || 0;
  
  const transaction = {
    date: document.getElementById('txnDate').value,
    saleId: document.getElementById('saleId').value,
    description: document.getElementById('description').value,
    weight: getValue('weight'),
    purchasePriceLKR: getValue('purchasePrice'),
    certChargesLKR: getValue('certCharges'),
    exchangeRate: getValue('exchangeRate'),
    soldPriceRMB: getValue('soldPriceRMB'),
    commissionRate: getValue('commission'),
    status: 'active',
    canceled: false,
    createdAt: new Date().toISOString()
  };

  // Calculate derived values
  const commissionAmount = transaction.purchasePriceLKR * (transaction.commissionRate / 100);
  const netSoldPriceRMB = transaction.soldPriceRMB - (transaction.soldPriceRMB * (transaction.commissionRate / 100));
  const soldPriceLKR = netSoldPriceRMB * transaction.exchangeRate;
  const totalCostLKR = transaction.purchasePriceLKR + transaction.certChargesLKR + commissionAmount;
  const profitLKR = soldPriceLKR - totalCostLKR;

  transaction.totalCostLKR = totalCostLKR;
  transaction.soldPriceLKR = soldPriceLKR;
  transaction.profitLKR = profitLKR;

  try {
    showLoader(true, 'Saving transaction...');
    const id = await add('transactions', transaction);
    transaction.id = id;
    accountingData.transactions.push(transaction);

    // Reset form and update UI
    clearTransactionForm();
    showToast(`Transaction ${transaction.saleId} saved successfully!`);
  } catch (error) {
    showError(`Failed to save transaction: ${error.message}`);
  } finally {
    showLoader(false);
  }
}

function clearTransactionForm() {
  document.getElementById('description').value = '';
  document.getElementById('weight').value = '';
  document.getElementById('purchasePrice').value = '';
  document.getElementById('certCharges').value = '';
  document.getElementById('soldPriceRMB').value = '';
  document.getElementById('saleId').value = generateNextSaleId();
  document.getElementById('txnDate').value = new Date().toISOString().split('T')[0];
  
  // Reset calculations
  document.getElementById('totalcostDisplay').textContent = 'Rs.0.00';
  document.getElementById('convertedsaleDisplay').textContent = 'Rs.0.00';
  document.getElementById('netprofitLossDisplay').textContent = 'Rs.0.00';
  document.getElementById('netprofitLossDisplay').className = '';
}

// ========== TRANSACTION CANCELLATION ========== //
async function loadCancellationDetails() {
  const saleId = document.getElementById('cancelSaleId').value.trim();
  if (!saleId) {
    showError('Please enter a Sale ID');
    return;
  }

  try {
    showLoader(true, 'Loading transaction details...');
    const transaction = accountingData.transactions.find(t =>
      t.saleId === saleId && !t.canceled
    );

    if (!transaction) {
      throw new Error('Active transaction not found');
    }

    // Update UI with transaction details
    document.getElementById('originalDate').textContent = transaction.date;
    document.getElementById('originalDescription').textContent = transaction.description;
    document.getElementById('originalPurchase').textContent =
      `Rs.${transaction.purchasePriceLKR.toFixed(2)}`;
    document.getElementById('originalSale').textContent =
      `Rs.${transaction.soldPriceLKR.toFixed(2)}`;
    document.getElementById('originalCertCharges').textContent =
      `Rs.${transaction.certChargesLKR.toFixed(2)}`;

    // Show the preview section
    document.getElementById('originalTransactionPreview').classList.remove('hidden');
  } catch (error) {
    showError(error.message);
    document.getElementById('originalTransactionPreview').classList.add('hidden');
  } finally {
    showLoader(false);
  }
}

async function confirmCancellation() {
  const saleId = document.getElementById('cancelSaleId').value.trim();
  const transaction = accountingData.transactions.find(t => t.saleId === saleId);

  if (!transaction) {
    showError('Transaction not found');
    return;
  }

  if (!confirm(`Permanently cancel ${saleId}? Certificate charges (Rs.${transaction.certChargesLKR.toFixed(2)}) will be recorded as loss.`)) {
    return;
  }

  try {
    showLoader(true, 'Processing cancellation...');

    // Create cancellation record
    const cancellationRecord = {
      ...transaction,
      canceled: true,
      status: 'canceled',
      cancellationDate: new Date().toISOString(),
      originalValues: {
        purchasePriceLKR: transaction.purchasePriceLKR,
        soldPriceLKR: transaction.soldPriceLKR
      },
      purchasePriceLKR: 0,
      soldPriceLKR: 0,
      profitLKR: -transaction.certChargesLKR
    };

    // Update in database
    await update('transactions', cancellationRecord);

    // Record cancellation as an expense
    const expense = {
      expenseId: `EXP-${String(accountingData.expenses.length + 1).padStart(5, '0')}`,
      type: 'Transaction Cancellation',
      amount: transaction.certChargesLKR,
      date: new Date().toISOString().split('T')[0],
      split: 50,
      relatedTransaction: saleId,
      createdAt: new Date().toISOString()
    };

    await add('expenses', expense);

    // Update local data
    const index = accountingData.transactions.findIndex(t => t.id === transaction.id);
    accountingData.transactions[index] = cancellationRecord;
    accountingData.expenses.push(expense);

    // Reset form
    document.getElementById('cancelSaleId').value = '';
    document.getElementById('originalTransactionPreview').classList.add('hidden');

    // Show success and update reports
    showToast(`Transaction ${saleId} canceled successfully`);
  } catch (error) {
    showError(`Cancellation failed: ${error.message}`);
  } finally {
    showLoader(false);
  }
}

// ========== EXPENSE MANAGEMENT ========== //
async function saveExpense() {
  const expense = {
    expenseId: `EXP-${String(accountingData.expenses.length + 1).padStart(5, '0')}`,
    date: document.getElementById('expenseDate').value,
    type: document.getElementById('expenseType').value,
    amount: parseFloat(document.getElementById('expenseAmount').value),
    split: 50,
    createdAt: new Date().toISOString()
  };

  if (!expense.amount || isNaN(expense.amount)) {
    showError("Please enter a valid amount");
    return;
  }

  try {
    showLoader(true, 'Saving expense...');
    const id = await add('expenses', expense);
    expense.id = id;
    accountingData.expenses.push(expense);

    // Reset form and update UI
    document.getElementById('expenseAmount').value = '';
    loadRecentExpenses();
    showToast('Expense saved successfully!');
  } catch (error) {
    showError(`Failed to save expense: ${error.message}`);
  } finally {
    showLoader(false);
  }
}

async function loadRecentExpenses() {
  try {
    showLoader(true, 'Loading expenses...');
    const expenses = await getAll('expenses');
    const html = expenses.slice(-5).reverse().map(e => `
      <div class="expense-item">
        <div class="expense-info">
          <strong>${e.type}</strong>
          <span class="expense-date">${e.date} (${e.expenseId})</span>
        </div>
        <div class="expense-amount">
          Rs.${e.amount.toFixed(2)}
        </div>
      </div>
    `).join('');

    document.getElementById('recentExpenses').innerHTML = html || '<p>No recent expenses</p>';
  } catch (error) {
    showError(`Failed to load expenses: ${error.message}`);
  } finally {
    showLoader(false);
  }
}

async function loadExpenseCancellationDetails() {
  const expenseId = document.getElementById('cancelExpenseId').value.trim();
  if (!expenseId) {
    showError('Please enter an Expense ID');
    return;
  }

  try {
    showLoader(true, 'Loading expense details...');
    const expense = accountingData.expenses.find(e =>
      e.expenseId === expenseId
    );

    if (!expense) {
      throw new Error('Expense not found');
    }

    // Update UI with expense details
    document.getElementById('originalExpenseDate').textContent = expense.date;
    document.getElementById('originalExpenseType').textContent = expense.type;
    document.getElementById('originalExpenseAmount').textContent =
      `Rs.${expense.amount.toFixed(2)}`;

    // Show the preview section
    document.getElementById('originalExpensePreview').classList.remove('hidden');
  } catch (error) {
    showError(error.message);
    document.getElementById('originalExpensePreview').classList.add('hidden');
  } finally {
    showLoader(false);
  }
}

async function confirmExpenseCancellation() {
  const expenseId = document.getElementById('cancelExpenseId').value.trim();
  const expense = accountingData.expenses.find(e => e.expenseId === expenseId);

  if (!expense) {
    showError('Expense not found');
    return;
  }

  if (!confirm(`Permanently cancel expense ${expenseId}?`)) {
    return;
  }

  try {
    showLoader(true, 'Processing expense cancellation...');

    // Remove from database
    await deleteExpense(expense.id);

    // Remove from local data
    accountingData.expenses = accountingData.expenses.filter(e => e.id !== expense.id);

    // Reset form
    document.getElementById('cancelExpenseId').value = '';
    document.getElementById('originalExpensePreview').classList.add('hidden');

    // Show success
    showToast(`Expense ${expenseId} canceled successfully`);
  } catch (error) {
    showError(`Cancellation failed: ${error.message}`);
  } finally {
    showLoader(false);
  }
}

// ========== EMPLOYEE MANAGEMENT ========== //
function renderEmployeeList() {
  const employeeList = document.getElementById('employeeList');
  employeeList.innerHTML = accountingData.employees.map(emp => `
    <div class="employee-card" data-id="${emp.id}">
      <input type="text" value="${emp.name}" placeholder="Employee Name">
      <input type="number" value="${emp.commission}" step="0.1" placeholder="Commission %">
      <button onclick="removeEmployeeCard(this)" class="danger small">
        <i class="fas fa-trash"></i>
      </button>
    </div>
  `).join('');
}

function addEmployeeCard() {
  const employeeList = document.getElementById('employeeList');
  const newCard = document.createElement('div');
  newCard.className = 'employee-card';
  newCard.setAttribute('data-id', Date.now());
  newCard.innerHTML = `
    <input type="text" placeholder="Employee Name">
    <input type="number" step="0.1" placeholder="Commission %">
    <button onclick="removeEmployeeCard(this)" class="danger small">
      <i class="fas fa-trash"></i>
    </button>
  `;
  employeeList.appendChild(newCard);
}

function removeEmployeeCard(button) {
  button.closest('.employee-card').remove();
}

async function saveEmployees() {
  const employeeCards = Array.from(document.querySelectorAll('.employee-card'));
  const employees = employeeCards.map(card => {
    const inputs = card.querySelectorAll('input');
    return {
      id: card.dataset.id || Date.now(),
      name: inputs[0].value.trim(),
      commission: parseFloat(inputs[1].value) || 0
    };
  }).filter(emp => emp.name && emp.commission > 0);

  try {
    showLoader(true, 'Saving employees...');
    await clearStore('employees');

    for (const emp of employees) {
      await add('employees', emp);
    }

    accountingData.employees = employees;
    showToast('Employee commissions saved successfully!');
  } catch (error) {
    showError(`Failed to save employees: ${error.message}`);
  } finally {
    showLoader(false);
  }
}

// ========== REPORTING SYSTEM ========== //
function generateReport() {
  const start = document.getElementById('reportStartDate').value;
  const end = document.getElementById('reportEndDate').value;
  const activeSubTab = document.querySelector('.sub-tab.active').dataset.subtab;

  try {
    showLoader(true, 'Generating report...');

    let reportHTML = '';
    switch (activeSubTab) {
      case 'transaction-report':
        reportHTML = generateTransactionReport(start, end);
        break;
      case 'canceled-report':
        reportHTML = generateCanceledReport(start, end);
        break;
      case 'purchase-commission-report':
        reportHTML = generatePurchaseCommissionReport(start, end);
        break;
      case 'expenses-report':
        reportHTML = generateExpensesReport(start, end);
        break;
      default:
        throw new Error('Invalid report type');
    }

    document.getElementById('reportResults').innerHTML = `
      <div class="report-card">
        <h3>${document.querySelector('.sub-tab.active').textContent} (${start} to ${end})</h3>
        ${reportHTML}
      </div>
    `;
  } catch (error) {
    showError(error.message);
  } finally {
    showLoader(false);
  }
}

function generateTransactionReport(start, end) {
  const transactions = accountingData.transactions
    .filter(t => !t.canceled && t.date >= start && t.date <= end);

  if (transactions.length === 0) {
    return '<p class="no-data">No transactions found for selected period</p>';
  }

  const totalProfit = transactions.reduce((sum, t) => sum + t.profitLKR, 0);
  const totalSales = transactions.reduce((sum, t) => sum + t.soldPriceLKR, 0);
  const totalCost = transactions.reduce((sum, t) => sum + t.totalCostLKR, 0);

  return `
    <div class="report-summary">
      <div class="summary-grid">
        <div class="summary-card">
          <h4>Total Transactions</h4>
          <div class="summary-item">
            <span>Count:</span>
            <span>${transactions.length}</span>
          </div>
        </div>
        <div class="summary-card">
          <h4>Sales Summary</h4>
          <div class="summary-item">
            <span>Total Sales:</span>
            <span>Rs.${totalSales.toFixed(2)}</span>
          </div>
          <div class="summary-item">
            <span>Total Cost:</span>
            <span>Rs.${totalCost.toFixed(2)}</span>
          </div>
          <div class="summary-item highlight ${totalProfit >= 0 ? 'profit' : 'loss'}">
            <span>Net Profit:</span>
            <span>Rs.${Math.abs(totalProfit).toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
    <div class="transaction-history">
      <h4>Transaction Details</h4>
      <div class="transaction-list">
        ${transactions.map(t => `
          <div class="transaction-item">
            <div class="transaction-header">
              <span class="transaction-id">${t.saleId}</span>
              <span class="transaction-date">${t.date}</span>
            </div>
            <div class="transaction-description">${t.description}</div>
            <div class="transaction-numbers">
              <div class="transaction-amount">
                <span>Purchase:</span>
                <span>Rs.${t.purchasePriceLKR.toFixed(2)}</span>
              </div>
              <div class="transaction-amount">
                <span>Sale:</span>
                <span>Rs.${t.soldPriceLKR.toFixed(2)}</span>
              </div>
              <div class="transaction-amount ${t.profitLKR >= 0 ? 'profit' : 'loss'}">
                <span>Profit:</span>
                <span>Rs.${Math.abs(t.profitLKR).toFixed(2)}</span>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function generateExpensesReport(start, end) {
  const expenses = accountingData.expenses
    .filter(e => e.date >= start && e.date <= end);

  if (expenses.length === 0) {
    return '<p class="no-data">No expenses found for selected period</p>';
  }

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const expenseByType = expenses.reduce((acc, e) => {
    acc[e.type] = (acc[e.type] || 0) + e.amount;
    return acc;
  }, {});

  return `
    <div class="report-summary">
      <div class="summary-grid">
        <div class="summary-card">
          <h4>Expenses Summary</h4>
          <div class="summary-item">
            <span>Total Expenses:</span>
            <span>Rs.${totalExpenses.toFixed(2)}</span>
          </div>
          <div class="summary-item">
            <span>Number of Expenses:</span>
            <span>${expenses.length}</span>
          </div>
        </div>
        <div class="summary-card">
          <h4>Expenses by Type</h4>
          ${Object.entries(expenseByType).map(([type, amount]) => `
            <div class="summary-item">
              <span>${type}:</span>
              <span>Rs.${amount.toFixed(2)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
    <div class="transaction-history">
      <h4>Expense Details</h4>
      <div class="transaction-list">
        ${expenses.map(e => `
          <div class="transaction-item">
            <div class="transaction-header">
              <span class="transaction-id">${e.expenseId || 'N/A'}</span>
              <span class="transaction-date">${e.date}</span>
            </div>
            <div class="transaction-description">${e.type}</div>
            <div class="transaction-numbers">
              <div class="transaction-amount">
                <span>Amount:</span>
                <span>Rs.${e.amount.toFixed(2)}</span>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ========== SETTINGS MANAGEMENT ========== //
async function saveSettings() {
  const partnerA = parseInt(document.getElementById('partnerAShare').value) || 0;
  const partnerB = parseInt(document.getElementById('partnerBShare').value) || 0;
  const appName = document.getElementById('appName').value.trim() || 'Gemstone Tracker';
  const titleFontWeight = parseInt(document.getElementById('titleFontWeight').value) || 600;
  const defaultExchangeRate = parseFloat(document.getElementById('defaultExchangeRate').value) || 50.00;
  const defaultCommission = parseFloat(document.getElementById('defaultCommission').value) || 2;

  if (partnerA + partnerB !== 100) {
    showError('Profit sharing must total 100%');
    return;
  }

  try {
    showLoader(true, 'Saving settings...');

    accountingData.settings = {
      ...accountingData.settings,
      defaultExchangeRate,
      defaultCommission,
      profitSharing: { partnerA, partnerB },
      appName,
      titleFontWeight
    };

    // Save to database
    await Promise.all([
      update('settings', { name: 'defaultExchangeRate', value: defaultExchangeRate }),
      update('settings', { name: 'defaultCommission', value: defaultCommission }),
      update('settings', { name: 'profitSharing', value: { partnerA, partnerB } }),
      update('settings', { name: 'appName', value: appName }),
      update('settings', { name: 'titleFontWeight', value: titleFontWeight })
    ]);

    // Update UI
    updateUIWithSettings();
    showToast('Settings saved successfully!');
  } catch (error) {
    showError(`Failed to save settings: ${error.message}`);
  } finally {
    showLoader(false);
  }
}

// ========== UTILITY FUNCTIONS ========== //
function showLoader(show, message = 'Loading...') {
  const overlay = document.getElementById('loadingOverlay');
  const messageElement = document.getElementById('loadingMessage');

  if (show) {
    messageElement.textContent = message;
    overlay.classList.remove('hidden');
  } else {
    overlay.classList.add('hidden');
  }
}

function showError(message, duration = 5000) {
  const toast = document.getElementById('errorToast');
  const messageElement = document.getElementById('errorMessage');

  messageElement.textContent = message;
  toast.classList.remove('hidden');

  if (duration > 0) {
    setTimeout(() => {
      toast.classList.add('hidden');
    }, duration);
  }
}

function hideError() {
  document.getElementById('errorToast').classList.add('hidden');
}

function showToast(message, duration = 3000) {
  const toast = document.createElement('div');
  toast.className = 'toast-message';
  toast.innerHTML = `
    <i class="fas fa-check-circle"></i>
    <span>${message}</span>
  `;

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function checkConnection() {
  const status = document.getElementById('connectionStatus');
  status.classList.toggle('online', navigator.onLine);
  status.classList.toggle('offline', !navigator.onLine);
  status.querySelector('.status-text').textContent =
    navigator.onLine ? 'Online' : 'Offline';
}

// ========== INITIALIZATION ========== //
document.addEventListener('DOMContentLoaded', async () => {
  try {
    showLoader(true, 'Initializing application...');

    // Initialize database
    await initDB();

    // Set up event listeners
    window.addEventListener('online', checkConnection);
    window.addEventListener('offline', checkConnection);
    setupTabListeners();

    // Initial UI setup
    checkConnection();
    showTab('transactions');
  } catch (error) {
    showError(`Initialization failed: ${error.message}`, 0);
  } finally {
    showLoader(false);
  }
});

// Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(registration => {
        console.log('ServiceWorker registered:', registration);
      })
      .catch(err => {
        console.log('ServiceWorker registration failed:', err);
      });
  });
}
