// 部署 Apps Script 後填入網址
const API_URL = 'https://script.google.com/macros/s/AKfycbzDgpGZGLa81qEkhjZmpGhJaUcQvZ3SuD3tvNjMJi5WRMFQdce0rFGny-hbmW5dKjP1/exec';

async function apiGet(action, params = {}) {
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  return res.json();
}

async function apiPost(action, data) {
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  const res = await fetch(url.toString(), {
    method: 'POST',
    body: JSON.stringify(data)
  });
  return res.json();
}

window.API = { apiGet, apiPost };
