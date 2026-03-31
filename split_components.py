import re

with open('webapp/src/App.tsx', 'r') as f:
    content = f.read()

# I will just write a whole new App.tsx replacing the entire file.

new_app_tsx = """import { useState, useEffect, useRef } from 'react';
import { 
  TrendingUp, Search, ArrowUpRight, TrendingDown,
  AlertTriangle, Zap, Play, Square, RotateCcw, LineChart, Star, Briefcase
} from 'lucide-react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { fetchScreener, fetchQuote, addToPortfolio, fetchPortfolio, removeFromPortfolio } from './api';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const BATCH_SIZE = 200;
const AUTO_SCAN_DELAY_MS = 1500;

const SIGNAL_RANK: Record<string, number> = {
  'SWING':    0,
  'BUY-T':    1,
  'BUY-R':    2,
  'REBUY':    3,
  'PRE-WARN': 4,
  'WARN':     5,
  'SELL':     6,
};

const sortBySignal = (arr: any[]) =>
  [...arr].sort((a, b) => (SIGNAL_RANK[a.signal] ?? 9) - (SIGNAL_RANK[b.signal] ?? 9));

const BuyZoneBar = ({ lo, hi, cur }: { lo: number; hi: number; cur: number }) => {
  const range = hi - lo;
  const pct = range > 0 ? Math.max(0, Math.min(100, ((cur - lo) / range) * 100)) : 50;
  const dec = (v: number) => (v < 1 ? 3 : 2);
  const inZone = cur >= lo && cur <= hi;
  return (
    <div style={{ minWidth: 130, padding: '2px 0' }}>
      <div style={{ position: 'relative', height: 5, borderRadius: 4, background: 'rgba(255,255,255,0.07)', margin: '10px 0 4px' }}>
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 4,
          background: 'linear-gradient(90deg, rgba(74,222,128,0.2), rgba(74,222,128,0.65))'
        }} />
        <div style={{
          position: 'absolute',
          left: `calc(${pct}% - 4px)`,
          top: -10,
          fontSize: 10,
          color: inZone ? '#facc15' : '#f87171',
          lineHeight: 1,
          userSelect: 'none',
          filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))'
        }}>▼</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>
          L <span style={{ color: '#4ade80', fontWeight: 700 }}>{lo.toFixed(dec(lo))}</span>
        </span>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>
          <span style={{ color: '#86efac', fontWeight: 700 }}>{hi.toFixed(dec(hi))}</span> H
        </span>
      </div>
    </div>
  );
};

// MARKET SCREENER COMPONENT (ISOLATED STATE PER MARKET)
const MarketScreener = ({ market, isActive, portfolio, handleTogglePortfolio }: any) => {
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [signals, setSignals] = useState<any[]>([]);
  const [scannedCount, setScannedCount] = useState(0);
  const [totalInMarket, setTotalInMarket] = useState(0);
  const [currentOffset, setCurrentOffset] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isAutoScanning, setIsAutoScanning] = useState(false);
  const [autoScanStatus, setAutoScanStatus] = useState('');

  const isScanning = useRef(false);
  const autoScanActive = useRef(false);
  const offsetRef = useRef(0);
  const totalRef = useRef(0);

  useEffect(() => {
    resetAndStartScan();
  }, [market]);

  const resetAndStartScan = async () => {
    autoScanActive.current = false;
    setIsAutoScanning(false);
    setSignals([]);
    setScannedCount(0);
    setCurrentOffset(0);
    setTotalInMarket(0);
    setErrorMsg(null);
    offsetRef.current = 0;
    totalRef.current = 0;
    await startScan(0);
  };

  const startScan = async (offset: number): Promise<number> => {
    if (isScanning.current) return offset;
    try {
      isScanning.current = true;
      setErrorMsg(null);
      const data = await fetchScreener(market, offset, BATCH_SIZE);
      
      if (data && data.error) throw new Error(data.error);
      
      const total = data.total || 0;
      if (total) {
        setTotalInMarket(total);
        totalRef.current = total;
      }
      
      const newOffset = offset + BATCH_SIZE;
      const scanned = Math.min(newOffset, total || 9999);
      setScannedCount(scanned);
      setCurrentOffset(newOffset);
      offsetRef.current = newOffset;
      
      if (data.results && data.results.length > 0) {
        setSignals(prev => sortBySignal([...prev, ...data.results]));
      }
      return newOffset;
    } catch (err: any) { 
      console.error('SCAN_ERROR:', err);
      setErrorMsg(err.message || 'Network error');
      return offset;
    } finally { 
      isScanning.current = false; 
    }
  };

  const startAutoScan = async () => {
    if (isAutoScanning) return;
    autoScanActive.current = true;
    setIsAutoScanning(true);
    
    let offset = offsetRef.current;
    const total = totalRef.current;

    if (total > 0 && offset >= total) {
      setSignals([]);
      setScannedCount(0);
      setCurrentOffset(0);
      offsetRef.current = 0;
      offset = 0;
    }

    while (autoScanActive.current) {
      const currentTotal = totalRef.current;
      
      if (currentTotal > 0 && offsetRef.current >= currentTotal) {
        setAutoScanStatus('✅ Imbasan selesai!');
        break;
      }

      const batchNum = Math.floor(offsetRef.current / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil((currentTotal || 1110) / BATCH_SIZE);
      setAutoScanStatus(`Mengimbas batch ${batchNum}/${totalBatches}...`);

      await startScan(offsetRef.current);
      
      if (!autoScanActive.current) break;

      if (offsetRef.current < (totalRef.current || 9999)) {
        await new Promise(resolve => setTimeout(resolve, AUTO_SCAN_DELAY_MS));
      }
    }

    autoScanActive.current = false;
    setIsAutoScanning(false);
    if (autoScanStatus !== '✅ Imbasan selesai!') {
      setAutoScanStatus('');
    }
  };

  const stopAutoScan = () => {
    autoScanActive.current = false;
    setIsAutoScanning(false);
    setAutoScanStatus('');
  };

  const handleRefreshTicker = async (ticker: string) => {
    setRefreshing(ticker);
    try {
      const data = await fetchQuote(ticker);
      if (data && !data.error) {
        setSignals(prev => prev.map(s => {
          if (s.ticker === ticker) {
            return { 
              ...s, 
              price: data.price, 
              signal: (data.signal && data.signal !== 'NONE') ? data.signal : s.signal,
              isCaution: data.isCaution !== undefined ? data.isCaution : s.isCaution, 
              reason: data.reason || s.reason, 
              entryRangeLow: data.entryRangeLow || s.entryRangeLow,
              entryRangeHigh: data.entryRangeHigh || s.entryRangeHigh,
              isBTST: data.isBTST !== undefined ? data.isBTST : s.isBTST,
              btstTarget: data.btstTarget || s.btstTarget,
              stopLoss: data.stopLoss || s.stopLoss,
              isLive: true 
            };
          }
          return s;
        }));
      }
    } catch (err: any) { 
      console.error('REFRESH_ERROR:', err);
    } finally { setRefreshing(null); }
  };

  const progress = totalInMarket ? Math.min((scannedCount / totalInMarket) * 100, 100) : 0;
  const isComplete = totalInMarket > 0 && scannedCount >= totalInMarket;

  return (
    <div style={{ display: isActive ? 'block' : 'none', width: '100%' }}>
      {errorMsg && (
        <div style={{position:'fixed', top: 20, left: '50%', transform: 'translateX(-50%)', background: '#e11d48', padding: '10px 20px', borderRadius: 10, zIndex: 10000, boxShadow: '0 10px 30px rgba(0,0,0,0.5)', fontWeight: 600, display:'flex', alignItems:'center', gap: 10}}>
          <AlertTriangle size={20} /> ERROR: {errorMsg}
        </div>
      )}

      <div className="stats-grid" style={{gridTemplateColumns: 'repeat(3, 1fr)'}}>
        <div className="stat-card">
          <div className="stat-card-header"><div style={{background:'rgba(77,227,255,0.1)', padding:10, borderRadius:10}}><ArrowUpRight size={20} /></div><span>Signals Found</span></div>
          <div className="stat-card-value font-bold">{signals.length} Signals</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-header"><div style={{background:'rgba(124, 92, 252, 0.1)', padding:10, borderRadius:10}}><TrendingDown size={20} /></div><span>DB Progress</span></div>
          <div className="stat-card-value">
            {scannedCount} <span style={{fontSize: 14, opacity: 0.5}}>/ {totalInMarket || '...'}</span>
            {isComplete && <span style={{fontSize: 12, color: '#00FF41', marginLeft: 8}}>✅ Lengkap</span>}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-header"><div style={{background:'rgba(0,255,65,0.08)', padding:10, borderRadius:10}}><TrendingUp size={20} color={isComplete ? '#00FF41' : 'var(--accent-cyan)'} /></div><span>Scanning Summary</span></div>
          <div style={{display:'flex', alignItems:'center', gap: 16, marginTop: 6}}>
            <div style={{fontSize: 26, fontWeight: 800, color: isComplete ? '#00FF41' : 'var(--accent-cyan)', lineHeight:1}}>
              {progress.toFixed(1)}%
            </div>
            <div style={{flex: 1}}>
              <div style={{height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 10, overflow:'hidden'}}>
                <div style={{width:`${progress}%`, height:'100%', background: isComplete ? '#00FF41' : 'linear-gradient(90deg, var(--accent-cyan), #7c5cfc)', transition:'width 0.5s ease', borderRadius:10}} />
              </div>
              <div style={{display:'flex', justifyContent:'space-between', fontSize: 11, opacity: 0.5, marginTop: 5}}>
                <span>{scannedCount} Scanned</span>
                <span>{totalInMarket || 1110} Total</span>
              </div>
            </div>
          </div>
          {isAutoScanning && (
            <div style={{fontSize: 11, color: 'var(--accent-cyan)', marginTop: 6}}>🔄 {autoScanStatus}</div>
          )}
          {isComplete && !isAutoScanning && (
            <div style={{fontSize: 11, color: '#00FF41', marginTop: 6}}>✅ Semua {totalInMarket} kaunter telah diimbas</div>
          )}
        </div>
      </div>

      <div className="screener-section">
        <div className="table-header">
          <h2>{market} Results</h2>
          <div style={{display:'flex', gap: 8, alignItems: 'center'}}>
            {isAutoScanning && (
              <span style={{fontSize: 11, color: 'var(--accent-cyan)', animation: 'pulse 1.5s infinite'}}>
                {autoScanStatus}
              </span>
            )}
            {autoScanStatus === '✅ Imbasan selesai!' && !isAutoScanning && (
              <span style={{fontSize: 11, color: '#00FF41'}}>{autoScanStatus}</span>
            )}

            <button className="tab-btn" onClick={() => resetAndStartScan()} disabled={isAutoScanning} title="Reset & mula semula">
              <RotateCcw size={14} />
            </button>

            <button 
              className="tab-btn" 
              onClick={() => startScan(currentOffset)} 
              disabled={isAutoScanning || isComplete}
            >
              Scan Next
            </button>

            {!isAutoScanning ? (
              <button 
                className="tab-btn active" 
                onClick={startAutoScan}
                disabled={isComplete}
                style={{display:'flex', alignItems:'center', gap: 6}}
                title="Imbas semua kaunter secara automatik"
              >
                <Play size={14} /> Auto Scan
              </button>
            ) : (
              <button 
                className="tab-btn" 
                onClick={stopAutoScan}
                style={{display:'flex', alignItems:'center', gap: 6, background: 'rgba(239, 68, 68, 0.2)', borderColor: '#ef4444', color: '#ef4444'}}
              >
                <Square size={14} /> Stop
              </button>
            )}
          </div>
        </div>

        {totalInMarket > 0 && (
          <div style={{height: 3, background: 'rgba(255,255,255,0.05)', marginBottom: 1}}>
            <div style={{
              height: '100%', width: `${progress}%`, background: isComplete ? '#00FF41' : 'var(--accent-cyan)',
              transition: 'width 0.5s ease', borderRadius: 2
            }} />
          </div>
        )}

        <div style={{maxHeight:'600px', overflowY:'auto'}}>
          <table>
            <thead>
              <tr>
                <th style={{width:'23%'}}>SYMBOL</th>
                <th style={{width:'12%'}}>SIGNAL</th>
                <th style={{width:'11%'}}>PRICE</th>
                <th style={{width:'23%'}}>ANALYSIS</th>
                <th style={{width:'18%'}}>BUY ZONE</th>
                <th style={{width:'13%', textAlign:'center'}}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {signals.length > 0 ? (
                signals.map((s, i) => (
                  <tr key={i}>
                    <td>
                      <div className="symbol-cell">
                        <div className="symbol-icon">{s.ticker[0]}</div>
                        <div style={{display:'flex', flexDirection:'column', gap: 2}}>
                          <strong style={{fontSize: 14, color: 'white'}}>{s.name}</strong>
                          <span style={{fontSize: 11, opacity: 0.5, fontWeight: 500, letterSpacing: '0.5px'}}>{s.ticker}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div style={{display:'flex', flexDirection: 'column', gap: 4}}>
                        <div style={{display:'flex', alignItems:'center', gap: 6, flexWrap: 'wrap'}}>
                          <span className={`signal-badge signal-${s.signal.split('-')[0]}`}>{s.signal}</span>
                          {s.isBTST && <span className="btst-badge">BTST</span>}
                          {s.signal === 'SWING' && <span className="swing-badge">SWING PRO</span>}
                          {s.isCaution && <AlertTriangle size={14} color="#FFD700" />}
                        </div>
                        {s.isBTST && s.btstTarget && (
                          <div style={{fontSize: 10, fontWeight: 700, color: '#fbbf24', letterSpacing: '0.3px', opacity: 0.9}}>
                            BTST TP: {market==='US'?'$':'RM'} {s.btstTarget.toFixed(s.btstTarget<1?3:2)}
                          </div>
                        )}
                        {s.signal === 'SWING' && (
                          <div style={{display:'flex', flexDirection:'column', gap: 2, marginTop: 2}}>
                            <div style={{fontSize: 10, fontWeight: 700, color: '#4facfe'}}>
                              Target (Resistance): {market==='US'?'$':'RM'} {s.btstTarget?.toFixed(s.btstTarget<1?3:2)}
                            </div>
                            <div style={{fontSize: 10, fontWeight: 700, color: '#ff5252', opacity: 0.8}}>
                              Stop Loss: {market==='US'?'$':'RM'} {s.stopLoss?.toFixed(s.stopLoss<1?3:2)}
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                    <td style={{fontWeight:600, color: s.isLive ? '#00FF41' : 'inherit'}}>{market==='US'?'$':'RM'} {s.price?.toFixed(s.price<1?3:2)}</td>
                    <td style={{fontSize:11, opacity: 0.75, lineHeight: 1.5}}>{s.reason}</td>
                    <td style={{paddingRight: 8}}>
                      {['BUY-T','BUY-R','REBUY','SWING'].includes(s.signal) && s.entryRangeLow && s.entryRangeHigh
                        ? <BuyZoneBar lo={Number(s.entryRangeLow)} hi={Number(s.entryRangeHigh)} cur={s.price || 0} />
                        : <span style={{opacity:0.2, fontSize:12}}>—</span>
                      }
                    </td>
                    <td style={{textAlign:'center'}}>
                      <div style={{display:'flex', alignItems:'center', justifyContent:'center', gap: 12}}>
                        <button className="icon-btn-refresh" onClick={() => handleRefreshTicker(s.ticker)} disabled={refreshing === s.ticker} title="Refresh Price">
                          <Zap size={16} className={refreshing === s.ticker ? 'loading-spinner' : ''} />
                        </button>
                        <button 
                          className="icon-btn-refresh" 
                          style={{borderColor: 'rgba(255,193,7,0.3)', color: '#ffc107'}} 
                          onClick={() => handleTogglePortfolio(s)}
                          title="Simpan/Padam Portfolio"
                        >
                          {portfolio.some((p:any) => p.ticker === s.ticker) ? <Star size={16} fill="#ffc107" /> : <Star size={16} />}
                        </button>
                        <a
                          href={market === 'MYR'
                            ? `https://www.tradingview.com/chart/?symbol=MYX:${s.ticker.replace('.KL','')}`
                            : `https://www.tradingview.com/chart/?symbol=${s.ticker}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Buka di TradingView"
                          style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 32, height: 32, borderRadius: 8,
                            background: 'rgba(37,99,235,0.15)', border: '1px solid rgba(37,99,235,0.4)',
                            color: '#3b82f6', textDecoration: 'none',
                            fontSize: 11, transition: 'all 0.2s',
                          }}
                          onMouseOver={e => (e.currentTarget.style.background = 'rgba(37,99,235,0.35)')}
                          onMouseOut={e => (e.currentTarget.style.background = 'rgba(37,99,235,0.15)')}
                        ><LineChart size={16} /></a>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={7} style={{textAlign:'center', padding: 80, opacity: 0.3}}>
                  {isAutoScanning ? '⏳ Mengimbas...' : 'Klik Auto Scan untuk imbas semua kaunter secara automatik'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};


const App = () => {
  const [activeMarket, setActiveMarket] = useState<'US' | 'MYR'>('MYR');
  const [activeTab, setActiveTab] = useState<'SCREENS' | 'PORTFOLIO'>('SCREENS');
  const [portfolio, setPortfolio] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState<string | null>(null);

  const loadPortfolio = async () => {
    try {
      const data = await fetchPortfolio();
      setPortfolio(data.results || []);
    } catch (e) {
      console.error('Load Portfolio Error:', e);
    }
  };

  useEffect(() => {
    loadPortfolio();
  }, [activeTab]);

  const handleTogglePortfolio = async (s: any) => {
    const isSaved = portfolio.some(p => p.ticker === s.ticker);
    try {
      if (isSaved) {
        await removeFromPortfolio(s.ticker);
        setPortfolio(prev => prev.filter(p => p.ticker !== s.ticker));
        alert(`❌ ${s.ticker} dikeluarkan dari Portfolio.`);
      } else {
        await addToPortfolio({
          ticker: s.ticker,
          name: s.name,
          entry_price: s.price || s.entry_price,
          target_price: s.swingTP || s.btstTarget || s.target_price,
          stop_loss: s.stopLoss || s.stop_loss
        });
        await loadPortfolio();
        alert(`✅ ${s.ticker} ditambahkan ke Portfolio anda!`);
      }
    } catch (e) {
      alert('Ada masalah semasa menghubungi pelayan Portfolio.');
    }
  };

  const handleRefreshPortfolioTicker = async (p: any) => {
    try {
      setRefreshing(p.ticker);
      const data = await fetchQuote(p.ticker);
      setPortfolio(prev => prev.map(item => {
        if (item.ticker === p.ticker) {
          return { ...item, current_price: data.c };
        }
        return item;
      }));
    } catch (e) {
      console.error(e);
    } finally {
      setRefreshing(null);
    }
  };

  return (
    <div className="main-layout">
      <div style={{position:'fixed', bottom: 10, right: 10, fontSize: 10, opacity: 0.3, zIndex: 9999}}>v2.2 · Memory Split</div>
      <div className="header">
        <div className="logo-group"><TrendingUp size={24} color="var(--accent-cyan)" /><h1 style={{fontSize: 22}}>MarketWise <span style={{fontWeight: 400, opacity: 0.6}}>Screener</span></h1></div>
        <div className="top-nav">
          <a className={`nav-link ${activeTab === 'SCREENS' && activeMarket === 'US' ? 'active' : ''}`} onClick={() => { setActiveTab('SCREENS'); setActiveMarket('US'); }}>US Market</a>
          <a className={`nav-link ${activeTab === 'SCREENS' && activeMarket === 'MYR' ? 'active' : ''}`} onClick={() => { setActiveTab('SCREENS'); setActiveMarket('MYR'); }}>Bursa Malaysia</a>
          <a className={`nav-link ${activeTab === 'PORTFOLIO' ? 'active' : ''}`} onClick={() => setActiveTab('PORTFOLIO')}>
            <Briefcase size={16} style={{marginRight: 6}} /> My Portfolio
          </a>
        </div>
        <div style={{display:'flex', gap:'20px', alignItems:'center'}}>
          <div className="search-box"><Search size={18} /><input type="text" placeholder="Cari kaunter..." /></div>
        </div>
      </div>

      <MarketScreener market="MYR" isActive={activeTab === 'SCREENS' && activeMarket === 'MYR'} portfolio={portfolio} handleTogglePortfolio={handleTogglePortfolio} />
      <MarketScreener market="US" isActive={activeTab === 'SCREENS' && activeMarket === 'US'} portfolio={portfolio} handleTogglePortfolio={handleTogglePortfolio} />

      <div style={{display: activeTab === 'PORTFOLIO' ? 'block' : 'none', width: '100%'}}>
        <div className="screener-section">
          <div className="table-header"><h2>My Portfolio</h2></div>
          <div style={{maxHeight:'600px', overflowY:'auto'}}>
            <table>
              <thead>
                <tr>
                  <th style={{width:'25%'}}>SYMBOL</th>
                  <th style={{width:'15%'}}>STATUS</th>
                  <th style={{width:'15%'}}>ENTRY AVG</th>
                  <th style={{width:'20%'}}>TARGET / SL</th>
                  <th style={{width:'15%'}}>NOTES</th>
                  <th style={{width:'10%', textAlign:'center'}}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.length > 0 ? (
                  portfolio.map((p, i) => (
                    <tr key={i} style={{borderLeft: '4px solid #ffc107', background: 'rgba(255,193,7,0.02)'}}>
                      <td>
                        <div className="symbol-cell">
                          <div className="symbol-icon" style={{background: 'linear-gradient(135deg, #ffc107, #ff9800)'}}>{p.ticker[0]}</div>
                          <div style={{display:'flex', flexDirection:'column', gap: 2}}>
                            <strong style={{fontSize: 14, color: 'white'}}>{p.name}</strong>
                            <span style={{fontSize: 11, opacity: 0.5, fontWeight: 500}}>{p.ticker}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="signal-badge" style={{background: 'rgba(255,193,7,0.1)', color: '#ffc107', borderColor: 'rgba(255,193,7,0.3)'}}>
                            HOLDING
                        </span>
                      </td>
                      <td style={{fontWeight: 700}}>
                          <span style={{fontSize: 10, opacity: 0.5, display:'block', marginBottom: 2}}>Avg: {p.entry_price?.toFixed(3)}</span>
                          Live: {(activeMarket as any)==='US'?'$':'RM'} {(p.current_price || p.entry_price)?.toFixed(3)}
                      </td>
                      <td>
                        <div style={{display:'flex', flexDirection:'column', gap: 4}}>
                          <div style={{fontSize: 11, fontWeight: 700, color: '#4facfe'}}>🎯 TP (Res): {p.target_price?.toFixed(3)}</div>
                          <div style={{fontSize: 11, fontWeight: 700, color: '#ff5252'}}>�� SL (Sup): {p.stop_loss?.toFixed(3)}</div>
                        </div>
                      </td>
                      <td>
                          <span style={{opacity:0.3, fontSize:10}}>Monitoring Support...</span>
                      </td>
                      <td style={{textAlign:'center'}}>
                        <div style={{display:'flex', alignItems:'center', justifyContent:'center', gap: 12}}>
                          <button className="icon-btn-refresh" onClick={() => handleRefreshPortfolioTicker(p)} disabled={refreshing === p.ticker} title="Refresh Live Price">
                            <Zap size={14} className={refreshing === p.ticker ? 'loading-spinner' : ''} />
                          </button>
                          <button 
                            className="icon-btn-refresh" 
                            style={{borderColor: 'rgba(239, 68, 68, 0.3)', color: '#ef4444'}} 
                            onClick={() => handleTogglePortfolio(p)}
                            title="Buang dari Portfolio"
                          >
                            <Star size={14} fill="#ef4444" />
                          </button>
                          <a
                            href={activeMarket === 'MYR'
                              ? `https://www.tradingview.com/chart/?symbol=MYX:${p.ticker.replace('.KL','')}`
                              : `https://www.tradingview.com/chart/?symbol=${p.ticker}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Buka di TradingView"
                            style={{
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              width: 28, height: 28, borderRadius: 8,
                              background: 'rgba(37,99,235,0.15)',
                              border: '1px solid rgba(37,99,235,0.4)',
                              color: '#3b82f6'
                            }}
                          >
                            <LineChart size={14} />
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={6} style={{textAlign:'center', padding: 60, opacity: 0.5}}>Portfolio kosong. Klik ⭐ pada screening untuk simpan.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
"""

with open('webapp/src/App.tsx', 'w') as f:
    f.write(new_app_tsx)

print('Successfully split App.tsx into multiple components')
