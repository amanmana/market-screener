# Market Screener Engine

Clean, modular stock screener engine using **Cloudflare Workers** and **Supabase** (Read-only data source).

## Project Structure

- `src/config/`: Configuration (Supabase client init, constants).
- `src/lib/`: Library wrappers (Supabase, KV).
- `src/services/`: Core logic (Screener engine).
- `src/indicators/`: Technical indicators (SMA, ATR, Stochastic, Volume).
- `src/signals/`: Signal detection logic (BUY-R, BUY-T, REBUY, PRE-WARN, WARN, SELL).
- `src/utils/`: General utilities.
- `src/routes/`: API endpoint handlers.
- `src/types/`: TypeScript definitions.
- `src/jobs/`: Potential scheduled worker tasks.

## Getting Started

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment**:
   Rename `.env.example` to `.dev.vars` (for local development) or update `wrangler.toml`:
   ```bash
   cp .env.example .dev.vars
   ```
   *Fill in your Supabase credentials in `.dev.vars`*.

3. **Run Local Dev Server**:
   ```bash
   npm run dev
   ```

4. **Health Check**:
   Open `http://localhost:8787/api/health`

## API Endpoints

- `GET /api/health`: Check if worker is alive.
- `GET /api/eod/latest-date`: Get the last price date in Supabase.
- `GET /api/symbol/:ticker`: Get signal and current candle for a symbol.
- `GET /api/screener/latest?signal=BUY-R`: Screen for current signals.

## Signal Priorities

1. **SELL** - Exit confirmation (Overwrites all)
2. **WARN** - Clearer warning
3. **PRE-WARN** - Early alert
4. **BUY-R** - Early reversal
5. **REBUY** - Pullback in trend
6. **BUY-T** - Trend continuation
7. **NONE** - No active signal

## Development & Maintenance

This system is designed to be **read-only** from Supabase. All calculations are performed on the fly or cached in Cloudflare KV.

To add new signals, create a new file in `src/signals/strategies/` and register it in `src/signals/engine.ts`.
