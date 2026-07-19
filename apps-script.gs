// 個人記帳 PWA - Google Apps Script 後端
// 部署為 Web App（存取權：任何人）。安全靠下方的共享密鑰 token 把關：
// 前端每次呼叫都要帶正確的 ?token=，不對就擋掉。
// ⚠️ 這是「自己資料、低風險」的輕量防護，能擋隨機掃描的機器人，
//    但 token 寫在公開前端原始碼裡仍看得到，不適合用在學員個資那種敏感系統。

// ── 共享密鑰（前端 js/api.js 的 API_TOKEN 必須一模一樣）──
const API_TOKEN = 'exp7k2m9qf4wx8vn3';

// ── 工作表名稱 ──────────────────────────────────
const SHEETS = {
  income:              'income',
  expense_personal:    'expense_personal',
  expense_shared:      'expense_shared',
  expense_family:      'expense_family',
  expense_installment: 'expense_installment',
  card_bills:          'card_bills'
};

// ── 各工作表欄位定義（新增欄位一律加在最後，避免打亂舊資料欄位順序）──
const HEADERS = {
  income:              ['date', 'description', 'amount', 'type'],
  expense_personal:    ['month', 'category', 'amount', 'payment', 'note', 'date'],
  expense_shared:      ['month', 'category', 'amount', 'payment', 'olan_amount', 'wei_amount', 'note', 'date'],
  expense_family:      ['month', 'category', 'amount', 'payment', 'olan_amount', 'wei_amount', 'note', 'date'],
  expense_installment: ['month', 'name', 'per_amount', 'total_amount', 'current_period', 'total_periods', 'payment', 'note', 'date'],
  card_bills:          ['month', 'date', 'bank', 'amount', 'note']
};

// 會出現在「最近記錄」時間軸與分類統計的支出類型（card_bills 屬於結算機制，不算個人消費分類）
const EXPENSE_TYPES = ['expense_personal', 'expense_shared', 'expense_family', 'expense_installment'];

// ── 路由 ────────────────────────────────────────
function doGet(e) {
  if (e.parameter.token !== API_TOKEN) return jsonErr('unauthorized');
  const action = e.parameter.action;
  try {
    if (action === 'getRecords')      return jsonOk(getRecords(e));
    if (action === 'getMonthSummary') return jsonOk(getMonthSummary(e));
    if (action === 'getMonthRecords') return jsonOk(getMonthRecords(e));
    return jsonErr('unknown action');
  } catch (err) {
    return jsonErr(err.message);
  }
}

function doPost(e) {
  if (e.parameter.token !== API_TOKEN) return jsonErr('unauthorized');
  const action = e.parameter.action;
  const data = JSON.parse(e.postData.contents);
  try {
    if (action === 'addRecord')    return jsonOk(addRecord(data));
    if (action === 'deleteRecord') return jsonOk(deleteRecord(data));
    return jsonErr('unknown action');
  } catch (err) {
    return jsonErr(err.message);
  }
}

// ── 新增記錄 ────────────────────────────────────
function addRecord(data) {
  const sheetName = SHEETS[data.sheet];
  if (!sheetName) throw new Error('invalid sheet: ' + data.sheet);

  const sheet = getOrCreateSheet(sheetName, HEADERS[data.sheet]);
  const headers = HEADERS[data.sheet];
  const row = headers.map(h => data[h] !== undefined ? data[h] : '');
  sheet.appendRow(row);
  return { ok: true };
}

// ── 刪除記錄（按 rowIndex，1-based，包含標題列）────
function deleteRecord(data) {
  const sheetName = SHEETS[data.sheet];
  if (!sheetName) throw new Error('invalid sheet: ' + data.sheet);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error('sheet not found');
  sheet.deleteRow(data.rowIndex);
  return { ok: true };
}

// ── 查詢記錄（單一工作表）────────────────────────
function getRecords(e) {
  const sheetName = SHEETS[e.parameter.sheet];
  if (!sheetName) throw new Error('invalid sheet: ' + e.parameter.sheet);

  const sheet = getOrCreateSheet(sheetName, HEADERS[e.parameter.sheet]);
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { records: [] };

  const headers = rows[0];
  const year  = e.parameter.year  ? parseInt(e.parameter.year)  : null;
  const month = e.parameter.month ? parseInt(e.parameter.month) : null;

  const records = rows.slice(1)
    .map((row, i) => {
      const obj = { _rowIndex: i + 2 }; // 1-based + 標題列
      headers.forEach((h, j) => { obj[h] = row[j]; });
      return obj;
    })
    .filter(r => {
      if (!year || !month) return true;
      // income 用 date 欄篩選，其他用 month 欄篩選
      if (e.parameter.sheet === 'income') {
        const d = new Date(r.date);
        return d.getFullYear() === year && d.getMonth() + 1 === month;
      } else {
        // month 欄格式：2026.07
        const [y, m] = String(r.month).split('.').map(Number);
        return y === year && m === month;
      }
    })
    .map(r => {
      // 格式化 date 欄（Sheets 讀出的日期值 instanceof Date 不穩定，一律用 toDateObj 保底）
      if (r.date) r.date = fmtDate(toDateObj(r.date));
      return r;
    });

  return { records };
}

// ── 月份總覽（for 結算頁）────────────────────────
function getMonthSummary(e) {
  const year  = parseInt(e.parameter.year);
  const month = parseInt(e.parameter.month);
  const ym    = `${year}.${String(month).padStart(2, '0')}`;

  function sumSheet(name, amtField) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
    if (!sheet) return 0;
    const rows = sheet.getDataRange().getValues();
    const hdr = rows[0];
    const monthIdx = hdr.indexOf('month');
    const amtIdx   = hdr.indexOf(amtField);
    if (monthIdx < 0 || amtIdx < 0) return 0;
    return rows.slice(1).reduce((sum, row) => {
      if (String(row[monthIdx]) === ym) sum += Number(row[amtIdx]) || 0;
      return sum;
    }, 0);
  }

  // 收入
  const incomeSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.income);
  let totalIncome = 0, cashIncome = 0, prepayIncome = 0, salaryIncome = 0;
  if (incomeSheet) {
    const rows = incomeSheet.getDataRange().getValues();
    const hdr = rows[0];
    const dateIdx = hdr.indexOf('date');
    const amtIdx  = hdr.indexOf('amount');
    const typeIdx = hdr.indexOf('type');
    rows.slice(1).forEach(row => {
      const d = new Date(row[dateIdx]);
      if (d.getFullYear() !== year || d.getMonth() + 1 !== month) return;
      const amt = Number(row[amtIdx]) || 0;
      totalIncome += amt;
      if (row[typeIdx] === '武士薪水') salaryIncome += amt;
      else if (row[typeIdx] === '預收款') prepayIncome += amt;
      else cashIncome += amt;
    });
  }

  // 卡費帳單
  const billsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.card_bills);
  let bills = [];
  if (billsSheet) {
    const rows = billsSheet.getDataRange().getValues();
    const hdr = rows[0];
    const monthIdx = hdr.indexOf('month');
    rows.slice(1).forEach((row, i) => {
      if (String(row[monthIdx]) !== ym) return;
      const obj = { _rowIndex: i + 2 };
      hdr.forEach((h, j) => { obj[h] = row[j]; });
      if (obj.date) obj.date = fmtDate(toDateObj(obj.date));
      bills.push(obj);
    });
  }
  const totalBills = bills.reduce((s, b) => s + (Number(b.amount) || 0), 0);

  // 各類支出
  const personalTotal    = sumSheet(SHEETS.expense_personal,    'amount');
  const sharedOlanTotal  = sumSheet(SHEETS.expense_shared,      'olan_amount');
  const familyOlanTotal  = sumSheet(SHEETS.expense_family,      'olan_amount');
  const installmentTotal = sumSheet(SHEETS.expense_installment, 'per_amount');

  return {
    income: { total: totalIncome, salary: salaryIncome, cash: cashIncome, prepay: prepayIncome },
    bills:  { total: totalBills, items: bills },
    expenses: {
      personal:    personalTotal,
      shared_olan: sharedOlanTotal,
      family_olan: familyOlanTotal,
      installment: installmentTotal
    },
    available: totalIncome - totalBills
  };
}

// ── 當月完整記錄（收入 + 各類支出合併，for 總覽頁時間軸 / 統計頁分類）──
function getMonthRecords(e) {
  const year  = parseInt(e.parameter.year);
  const month = parseInt(e.parameter.month);

  const records = [];
  collectIncome(year, month, records);
  EXPENSE_TYPES.forEach(type => collectExpense(type, year, month, records));

  records.sort((a, b) => new Date(b.date) - new Date(a.date));
  return { records };
}

function collectIncome(year, month, records) {
  const sheet = getOrCreateSheet(SHEETS.income, HEADERS.income);
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return;
  const hdr = rows[0];

  rows.slice(1).forEach(row => {
    const obj = {};
    hdr.forEach((h, j) => { obj[h] = row[j]; });
    if (!obj.date) return;
    const d = toDateObj(obj.date);
    if (isNaN(d) || d.getFullYear() !== year || d.getMonth() + 1 !== month) return;

    records.push({
      type: 'income',
      sheet: 'income',
      category: obj.type,          // 現金收入 / 預收款 / 武士薪水
      note: obj.description || '',
      amount: Number(obj.amount) || 0,
      date: fmtDate(d)
    });
  });
}

function collectExpense(sheetKey, year, month, records) {
  const sheet = getOrCreateSheet(SHEETS[sheetKey], HEADERS[sheetKey]);
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return;
  const hdr = rows[0];

  rows.slice(1).forEach(row => {
    const obj = {};
    hdr.forEach((h, j) => { obj[h] = row[j]; });
    if (!obj.date) return; // 舊資料沒有精確日期就不進時間軸
    const d = toDateObj(obj.date);
    if (isNaN(d) || d.getFullYear() !== year || d.getMonth() + 1 !== month) return;

    let amount;
    if (sheetKey === 'expense_installment') amount = Number(obj.per_amount) || 0;
    else if (sheetKey === 'expense_shared' || sheetKey === 'expense_family') amount = Number(obj.olan_amount) || 0;
    else amount = Number(obj.amount) || 0;

    records.push({
      type: 'expense',
      sheet: sheetKey,
      category: sheetKey === 'expense_installment' ? (obj.name || '分期') : (obj.category || '其他'),
      note: obj.note || '',
      amount,
      date: fmtDate(d)
    });
  });
}

// ── 工具函式 ────────────────────────────────────
function getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    return sheet;
  }
  // 自動補齊缺少的欄位（一律加在最後一欄，不動既有欄位順序，避免弄亂舊資料）
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const missing = headers.filter(h => existing.indexOf(h) === -1);
  if (missing.length > 0) {
    const startCol = existing.length + 1;
    sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
    sheet.getRange(1, startCol, 1, missing.length).setFontWeight('bold');
  }
  return sheet;
}

function toDateObj(v) {
  return v instanceof Date ? v : new Date(v);
}

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function jsonOk(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonErr(msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ error: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}
