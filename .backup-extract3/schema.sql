-- Table to mirror historical prices for fast access and SMA50/200 calculations
CREATE TABLE IF NOT EXISTS prices_mirror (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    price_date TEXT NOT NULL,
    open REAL,
    high REAL,
    low REAL,
    close REAL,
    volume INTEGER,
    UNIQUE(ticker, price_date)
);

-- Table to track your active swing trades and portfolio
CREATE TABLE IF NOT EXISTS swing_portfolio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    name TEXT,
    entry_price REAL,
    entry_date TEXT DEFAULT CURRENT_TIMESTAMP,
    target_price REAL,
    stop_loss REAL,
    is_btst INTEGER DEFAULT 0,
    status TEXT DEFAULT 'ACTIVE', -- ACTIVE, CLOSED, WIN, LOSS
    notes TEXT,
    signal TEXT,
    reason TEXT
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_prices_ticker ON prices_mirror(ticker);
CREATE INDEX IF NOT EXISTS idx_prices_date ON prices_mirror(price_date);
