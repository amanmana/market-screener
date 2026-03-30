const API_BASE = import.meta.env.PROD 
  ? 'https://market-screener.amanmana.workers.dev/api'
  : (import.meta.env.VITE_API_URL || 'http://localhost:8787/api');

export async function fetchScreener(market: string = 'US', offset: number = 0, limit: number = 200) {
  const url = `${API_BASE}/screener/latest?market=${market}&offset=${offset}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('API request failed');
  return res.json();
}

export async function fetchHealth() {
  const res = await fetch(`${API_BASE}/health`);
  return res.json();
}

export async function fetchSymbol(ticker: string) {
  const res = await fetch(`${API_BASE}/symbol/${ticker}`);
  if (!res.ok) throw new Error('Symbol not found');
  return res.json();
}
