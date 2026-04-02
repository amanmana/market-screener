const API_BASE = window.location.hostname === 'localhost' 
  ? 'http://localhost:8787/api' 
  : 'https://market-screener.amanmana.workers.dev/api';

export async function fetchScreener(market: string = 'MYR', offset: number = 0, limit: number = 200) {
  const url = `${API_BASE}/screener/latest?market=${market}&offset=${offset}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API request failed: ${res.status}`);
  return res.json();
}

export async function fetchHealth() {
  const res = await fetch(`${API_BASE}/health`);
  return res.json();
}

export async function fetchStockList() {
  const res = await fetch(`${API_BASE}/market/list`);
  if (!res.ok) throw new Error('Stock list fetch failed');
  return res.json();
}

export async function fetchStarStockList() {
  const res = await fetch(`${API_BASE}/market/sync-star`);
  if (!res.ok) throw new Error('Star stock list fetch failed');
  return res.json();
}

export async function fetchQuote(ticker: string) {
  const res = await fetch(`${API_BASE}/market/quote/${ticker}`);
  if (!res.ok) throw new Error('Quote fetch failed');
  return res.json();
}

export async function addToWatchlist(payload: any) {
  const res = await fetch(`${API_BASE}/portfolio/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Add failed: ${res.status}`);
  return res.json();
}

export async function removeFromWatchlist(ticker: string) {
  const res = await fetch(`${API_BASE}/portfolio/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticker })
  });
  if (!res.ok) throw new Error(`Remove failed: ${res.status}`);
  return res.json();
}

export async function fetchWatchlist() {
  const res = await fetch(`${API_BASE}/portfolio/list`);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchRiskSettings() {
  const res = await fetch(`${API_BASE}/risk/settings`);
  if (!res.ok) throw new Error(`Fetch risk failed: ${res.status}`);
  return res.json();
}

export async function updateRiskSettings(payload: any) {
  const res = await fetch(`${API_BASE}/risk/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Update risk failed: ${res.status}`);
  return res.json();
}
