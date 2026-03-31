import { useState, useEffect, useRef } from 'react';
import { 
  TrendingUp, Search,
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
          Min <span style={{ color: '#4ade80', fontWeight: 700 }}>{lo.toFixed(dec(lo))}</span>
        </span>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>
          <span style={{ color: '#86efac', fontWeight: 700 }}>{hi.toFixed(dec(hi))}</span> Max
        </span>
      </div>
    </div>
  );
};

// MARKET SCREENER COMPONENT (ISOLATED STATE PER MARKET)
const MarketScreener = ({ market, isActive, portfolio, handleTogglePortfolio }: any) => {
  const [refreshing, setRefreshing] = useState<string | null>(null);
  
  const [signals, setSignals] = useState<any[]>(() => {
    const s = localStorage.getItem(`signals_${market}`);
    return s ? JSON.parse(s) : [];
  });
  const [scannedCount, setScannedCount] = useState(() => {
    const s = localStorage.getItem(`scanned_${market}`);
    return s ? parseInt(s) : 0;
  });
  const [totalInMarket, setTotalInMarket] = useState(() => {
    const s = localStorage.getItem(`total_${market}`);
    return s ? parseInt(s) : 0;
  });
  const [currentOffset, setCurrentOffset] = useState(() => {
    const s = localStorage.getItem(`offset_${market}`);
    return s ? parseInt(s) : 0;
  });

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isAutoScanning, setIsAutoScanning] = useState(false);
  const [autoScanStatus, setAutoScanStatus] = useState('');

  const isScanning = useRef(false);
  const autoScanActive = useRef(false);
  const offsetRef = useRef(currentOffset);
  const totalRef = useRef(totalInMarket);

  // Sync to local storage
  useEffect(() => {
    localStorage.setItem(`signals_${market}`, JSON.stringify(signals));
    localStorage.setItem(`scanned_${market}`, scannedCount.toString());
    localStorage.setItem(`total_${market}`, totalInMarket.toString());
    localStorage.setItem(`offset_${market}`, currentOffset.toString());
  }, [signals, scannedCount, totalInMarket, currentOffset, market]);

  useEffect(() => {
    // Only auto-start if there's no saved history
    if (signals.length === 0 && offsetRef.current === 0) {
      resetAndStartScan();
    }
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
    
    // Clear storage explicitely
    localStorage.removeItem(`signals_${market}`);
    localStorage.removeItem(`scanned_${market}`);
    localStorage.removeItem(`total_${market}`);
    localStorage.removeItem(`offset_${market}`);
    
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

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-header"><span>Signals Found</span></div>
          <div className="stat-card-value font-bold">{signals.length} Signals</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-header"><span>DB Progress</span></div>
          <div className="stat-card-value">
            {scannedCount} <span style={{fontSize: 14, opacity: 0.5}}>/ {totalInMarket || '...'}</span>
            {isComplete && <span style={{fontSize: 12, color: 'var(--accent-cyan)', marginLeft: 8}}>✅</span>}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-header"><span>Scanning Summary</span></div>
          <div style={{display:'flex', alignItems:'center', gap: 16, marginTop: 6}}>
            <div style={{fontSize: 26, fontWeight: 800, color: isComplete ? 'var(--accent-cyan)' : 'var(--text-main)', lineHeight:1}}>
              {progress.toFixed(1)}%
            </div>
            <div style={{flex: 1}}>
              <div style={{height: 6, background: 'var(--input-bg)', borderRadius: 10, overflow:'hidden'}}>
                <div style={{width:`${progress}%`, height:'100%', background: isComplete ? 'var(--accent-cyan)' : 'var(--text-main)', transition:'width 0.5s ease', borderRadius:10}} />
              </div>
              <div style={{display:'flex', justifyContent:'space-between', fontSize: 11, color: 'var(--text-muted)', marginTop: 5}}>
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

        <div className="table-container" style={{maxHeight:'600px', overflowY:'auto'}}>
          <table>
            <thead>
              <tr>
                <th style={{width:'23%'}}>SYMBOL</th>
                <th style={{width:'12%'}}>SIGNAL</th>
                <th style={{width:'11%'}}>PRICE</th>
                <th style={{width:'23%'}}>ANALYSIS</th>
                <th style={{width:'18%'}}>EP ZONE</th>
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
                          <div style={{display:'flex', flexDirection:'column', gap: 2, marginTop: 2}}>
                            <div style={{fontSize: 10, fontWeight: 700, color: '#fbbf24'}}>BTST TP: {market==='US'?'$':'RM'} {s.btstTarget.toFixed(3)}</div>
                            {s.stopLoss && <div style={{fontSize: 10, fontWeight: 700, color: '#ff5252'}}>BTST CL: {market==='US'?'$':'RM'} {s.stopLoss.toFixed(3)}</div>}
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
      const list = data.results || [];
      setPortfolio(list);
      
      // Auto-refresh items with missing signal data when entering Portfolio tab
      if (activeTab === 'PORTFOLIO') {
        const needsUpdate = list.filter((p: any) => !p.signal || p.signal === 'HOLD' || p.signal === 'HOLDING' || p.signal === 'RESCAN');
        if (needsUpdate.length > 0) {
          needsUpdate.forEach((p: any) => handleRefreshPortfolioTicker(p));
        }
      }
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
        setPortfolio(prev => prev.filter(p => p.ticker !== s.ticker));
        await removeFromPortfolio(s.ticker);
      } else {
        const newItem = {
          ticker: s.ticker,
          name: s.name,
          entry_price: s.price || s.entry_price || 0,
          target_price: s.swingTP || s.btstTarget || s.target_price || 0,
          stop_loss: s.stopLoss || s.stop_loss || 0,
          signal: s.signal,
          reason: s.reason,
          isBTST: s.isBTST,
          isCaution: s.isCaution
        };
        setPortfolio(prev => [...prev, newItem]);
        await addToPortfolio(newItem);
      }
    } catch (e) {
      console.error('Toggle Portfolio Error:', e);
      alert('Terdapat ralat teknikal semasa menyimpan Portfolio.');
      loadPortfolio();
    }
  };

  const handleRefreshPortfolioTicker = async (p: any) => {
    if (refreshing === p.ticker) return;
    try {
      setRefreshing(p.ticker);
      const data = await fetchQuote(p.ticker);
      if (data && !data.error) {
        setPortfolio(prev => {
          const newList = prev.map(item => {
            if (item.ticker === p.ticker) {
              const updated = { 
                  ...item, 
                  current_price: Number(data.price),
                  target_price: data.btstTarget || data.targetPrice || item.target_price || data.target_price,
                  stop_loss: data.stopLoss || item.stop_loss || data.stop_loss,
                  signal: (data.signal && data.signal !== 'NONE' && data.signal !== 'HOLD' && data.signal !== 'HOLDING') ? data.signal : (item.signal || 'RESCAN'),
                  reason: data.reason || item.reason || 'Screener update complete.',
                  isBTST: data.isBTST !== undefined ? data.isBTST : item.isBTST,
                  isCaution: data.isCaution !== undefined ? data.isCaution : item.isCaution
              };
              // Persist to D1
              addToPortfolio(updated).catch(console.error);
              return updated;
            }
            return item;
          });
          return newList;
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setRefreshing(null);
    }
  };

  return (
    <div className="main-layout">
      <div style={{position:'fixed', bottom: 10, right: 10, fontSize: 10, opacity: 0.3, zIndex: 9999}}>v3.7 · BTST Pro Engine</div>
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
          <div className="table-header">
            <div style={{display:'flex', alignItems:'center', gap: 15}}>
               <h2>My Portfolio</h2>
               <button 
                 className="tab-btn" 
                 style={{background: 'var(--accent-cyan)', color: 'var(--bg-dark)', fontWeight: 700, border: 'none'}}
                 onClick={() => {
                   const ids = portfolio.map(p => p.ticker);
                   let i = 0;
                   const next = () => {
                     if (i < ids.length) {
                       handleRefreshPortfolioTicker(portfolio.find(p => p.ticker === ids[i]));
                       i++;
                       setTimeout(next, 500);
                     }
                   };
                   next();
                 }}
               >
                 <RotateCcw size={14} style={{marginRight: 8}}/> Refresh All
               </button>
            </div>
          </div>
          <div className="table-container" style={{maxHeight:'600px', overflowY:'auto'}}>
            <table>
              <thead>
                <tr>
                  <th style={{width:'20%'}}>SYMBOL</th>
                  <th style={{width:'15%'}}>SIGNAL</th>
                  <th style={{width:'15%'}}>ENTRY AVG</th>
                  <th style={{width:'20%'}}>TARGET / SL</th>
                  <th style={{width:'20%'}}>ANALYSIS</th>
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
                        <div style={{display:'flex', flexDirection: 'column', gap: 4}}>
                           <div style={{display:'flex', alignItems:'center', gap: 6, flexWrap: 'wrap'}}>
                             {(!p.signal || p.signal === 'NONE' || p.signal === 'HOLD' || p.signal === 'HOLDING' || p.signal === 'RESCAN') ? (
                               <span className="signal-badge" style={{background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.3)'}}>SCANNING...</span>
                             ) : (
                               <>
                                 <span className={`signal-badge signal-${p.signal.split('-')[0]}`}>{p.signal}</span>
                                 {p.isBTST && <span className="btst-badge">BTST</span>}
                                 {p.signal === 'SWING' && <span className="swing-badge">SWING PRO</span>}
                                 {p.isCaution && <AlertTriangle size={14} color="#FFD700" />}
                               </>
                             )}
                           </div>
                        </div>
                      </td>
                      <td style={{fontWeight: 700}}>
                          <span style={{fontSize: 10, opacity: 0.5, display:'block', marginBottom: 2}}>Avg: {Number(p.entry_price || 0).toFixed(3)}</span>
                          <span style={{color: (p.current_price || p.price) > p.entry_price ? '#00FF41' : '#ff5252'}}>
                            Live: {(activeMarket as any)==='US'?'$':'RM'} {Number(p.current_price || p.entry_price || p.price || 0).toFixed(3)}
                          </span>
                      </td>
                      <td>
                        {(!p.signal || (SIGNAL_RANK[p.signal] ?? 0) < 4) ? (
                          <div style={{display:'flex', flexDirection:'column', gap: 4}}>
                            {p.isBTST ? (
                              <>
                                <div style={{fontSize: 10, fontWeight: 700, color: '#fbbf24'}}>BTST TP: {Number(p.target_price || 0).toFixed(3)}</div>
                                <div style={{fontSize: 10, fontWeight: 700, color: '#ff5252'}}>BTST CL: {Number(p.stop_loss || 0).toFixed(3)}</div>
                              </>
                            ) : (
                              <>
                                {p.target_price > 0 && <div style={{fontSize: 11, fontWeight: 700, color: '#4facfe'}}>🎯 TP (Res): {Number(p.target_price).toFixed(3)}</div>}
                                {p.stop_loss > 0 && <div style={{fontSize: 11, fontWeight: 700, color: '#ff5252'}}>🛑 SL (Sup): {Number(p.stop_loss).toFixed(3)}</div>}
                                {(!p.target_price && !p.stop_loss) && <span style={{opacity:0.2, fontSize:12}}>—</span>}
                              </>
                            )}
                          </div>
                        ) : (
                          <div style={{background: 'rgba(239, 68, 68, 0.1)', padding: '4px 8px', borderRadius: 4, display:'inline-block'}}>
                            <span style={{color:'#ef4444', fontSize: 10, fontWeight: 700, letterSpacing: '0.5px'}}>EXIT STRATEGY</span>
                          </div>
                        )}
                      </td>
                      <td>
                          <span style={{fontSize:11, opacity: 0.8, lineHeight: 1.5}}>{p.reason || p.analysis || 'Fetching intelligence...'}</span>
                      </td>
                      <td style={{textAlign:'center'}}>
                        <div style={{display:'flex', alignItems:'center', justifyContent:'center', gap: 12}}>
                          <button className={`icon-btn-refresh ${refreshing === p.ticker ? 'active' : ''}`} onClick={() => handleRefreshPortfolioTicker(p)} disabled={refreshing === p.ticker} title="Refresh Live Price">
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
