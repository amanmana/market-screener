import { Router } from 'itty-router';

const router = Router();

// Minimal health check
router.get('/api/health', () => {
  return new Response(JSON.stringify({ status: 'ok' }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

// Minimal screener (mock) to test UI connectivity
router.get('/api/screener/latest', () => {
  return new Response(JSON.stringify({ 
    count: 1, 
    results: [
      { ticker: 'TEST', name: 'Testing Connection', signal: 'BUY-T', price: 1.0, reason: 'Live Connection Success', date: '2024-03-30' }
    ] 
  }), {
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
  });
});

export default router;
