// 部署 Apps Script 後填入網址
const API_URL = 'https://script.google.com/macros/s/AKfycbzDgpGZGLa81qEkhjZmpGhJaUcQvZ3SuD3tvNjMJi5WRMFQdce0rFGny-hbmW5dKjP1/exec';

// 共享密鑰：必須跟後端 apps-script.gs 的 API_TOKEN 一模一樣，每次請求都帶上
const API_TOKEN = 'exp7k2m9qf4wx8vn3';

async function apiGet(action, params = {}) {
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  url.searchParams.set('token', API_TOKEN);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  return res.json();
}

async function apiPost(action, data) {
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  url.searchParams.set('token', API_TOKEN);
  const res = await fetch(url.toString(), {
    method: 'POST',
    body: JSON.stringify(data)
  });
  return res.json();
}

window.API = { apiGet, apiPost };
