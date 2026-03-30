import React, { useState, useEffect, useRef } from 'react';
import { 
  TrendingUp, Search, ArrowUpRight, TrendingDown, RefreshCw, 
  AlertTriangle, Zap, ChevronDown
} from 'lucide-react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { fetchScreener } from './api';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const App = () => {
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [signals, setSignals] = useState<any[]>([]);
  const [activeMarket, setActiveMarket] = useState('MYR');
  const [scannedCount, setScannedCount] = useState(0);
  const [totalInMarket, setTotalInMarket] = useState(0);
  const [currentOffset, setCurrentOffset] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const isScanning = useRef(false);

  useEffect(() => {
    resetAndStartScan(activeMarket);
  }, [activeMarket]);

  const resetAndStartScan = async (market: string) => {
    setSignals([]);
    setScannedCount(0);
    setCurrentOffset(0);
    setTotalInMarket(0);
    setErrorMsg(null);
    await startScan(market, 0);
  };

  const startScan = async (market: string, offset: number) => {
    if (isScanning.current) return;
    try {
      isScanning.current = true;
      setErrorMsg(null);
      const data = await fetchScreener(market, offset, 200);
      
      if (data && data.error) throw new Error(data.error);
      if (data.total !== undefined) setTotalInMarket(data.total);
      
      const newOffset = offset + 200;
      setScannedCount(Math.min(newOffset, data.total || 9999));
      setCurrentOffset(newOffset);
      
      if (data.results) {
        setSignals(prev => [...prev, ...data.results]);
      }
    } catch (err: any) { 
        console.error('SCAN_ERROR:', err);
        setErrorMsg(err.message || 'Unknown network error');
        alert('POOOFF! Kenapa gagal?? Ralat: ' + err.message);
    } finally { isScanning.current = false; }
  };

  const handleRefreshTicker = async (ticker: string) => {
    setRefreshing(ticker);
    try {
        const baseUrl = 'http://localhost:8787';
        const res = await fetch(`${baseUrl}/api/market/quote/${ticker}`);
        const data = await res.json();
        if (data && !data.error) {
            setSignals(prev => prev.map(s => {
                if (s.ticker === ticker) {
                    return { ...s, price: data.price, isCaution: data.isCaution, reason: data.reason, isLive: true };
                }
                return s;
            }));
        }
    } catch (err: any) { 
        console.error('REFRESH_ERROR:', err);
    } finally { setRefreshing(null); }
  };

  return (
    <div className="main-layout">
      {errorMsg && (
          <div style={{position:'fixed', top: 20, left: '50%', transform: 'translateX(-50%)', background: '#e11d48', padding: '10px 20px', borderRadius: 10, zIndex: 10000, boxShadow: '0 10px 30px rgba(0,0,0,0.5)', fontWeight: 600, display:'flex', alignItems:'center', gap: 10}}>
              <AlertTriangle size={20} /> ALAMAK! ERROR: {errorMsg}
          </div>
      )}
      
      <div style={{position:'fixed', bottom: 10, right: 10, fontSize: 10, opacity: 0.3, zIndex: 9999}}>v1.5 STABLE</div>
      <div className="header">
        <div className="logo-group"><TrendingUp size={24} color="var(--accent-cyan)" /><h1 style={{fontSize: 22}}>MarketWise <span style={{fontWeight: 400, opacity: 0.6}}>Screener</span></h1></div>
        <div className="top-nav">
          <a className={`nav-link ${activeMarket === 'US' ? 'active' : ''}`} onClick={() => setActiveMarket('US')}>US Market</a>
          <a className={`nav-link ${activeMarket === 'MYR' ? 'active' : ''}`} onClick={() => setActiveMarket('MYR')}>Bursa Malaysia</a>
        </div>
        <div style={{display:'flex', gap:'20px', alignItems:'center'}}>
          <div className="search-box"><Search size={18} className="text-gray-500" /><input type="text" placeholder="Cari kaunter..." /></div>
          <div className="user-pill"><img src="https://i.pravatar.cc/150?u=ak" style={{width: 28, height: 28, borderRadius: '50%'}} alt="user" /><span>Akhmal K. <ChevronDown size={14} /></span></div>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-header"><div style={{background:'rgba(77,227,255,0.1)', padding:10, borderRadius:10}}><ArrowUpRight size={20} className="text-cyan-400" /></div><span>Signals Found</span></div>
          <div className="stat-card-value font-bold">{signals.length} Signals</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div style={{background:'rgba(124, 92, 252, 0.1)', padding:10, borderRadius:10}}><TrendingDown size={20} className="text-purple-400" /></div><span>DB Progress</span></div>
          <div className="stat-card-value">{scannedCount} <span style={{fontSize: 14, opacity: 0.5}}>/ {totalInMarket || '...'}</span></div>
        </div>
      </div>

      <div className="content-grid">
        <div className="screener-section">
          <div className="table-header"><h2>{activeMarket} Results</h2><div style={{display:'flex', gap: 10}}><button className="tab-btn" onClick={() => resetAndStartScan(activeMarket)}>Reset</button><button className="tab-btn active" onClick={() => startScan(activeMarket, currentOffset)}>Scan Next</button></div></div>
          <div style={{maxHeight:'600px', overflowY:'auto'}}>
          <table>
            <thead><tr><th style={{width:'20%'}}>SYMBOL</th><th style={{width:'15%'}}>SIGNAL</th><th style={{width:'15%'}}>PRICE</th><th style={{width:'45%'}}>DETAILED ANALYSIS</th><th style={{width:'5%'}}></th></tr></thead>
            <tbody>
              {signals.length > 0 ? (
                signals.map((s, i) => (
                  <tr key={i}>
                    <td><div className="symbol-cell"><div className="symbol-icon">{s.ticker[0]}</div><div style={{display:'flex',flexDirection:'column'}}><strong>{s.ticker}</strong><span style={{fontSize:11,opacity:0.6}}>{s.name}</span></div></div></td>
                    <td><div style={{display:'flex',alignItems:'center',gap:6}}><span className={`signal-badge signal-${s.signal.split('-')[0]}`}>{s.signal}</span>{s.isCaution && <AlertTriangle size={14} color="#FFD700" />}</div></td>
                    <td style={{fontWeight:600, color: s.isLive ? '#00FF41' : 'inherit'}}>{activeMarket==='US'?'$':'RM'} {s.price?.toFixed(s.price<1?3:2)}</td>
                    <td style={{fontSize:12, opacity: 0.8, lineHeight: 1.5}}>{s.reason}</td>
                    <td><button className="icon-btn-refresh" onClick={() => handleRefreshTicker(s.ticker)} disabled={refreshing === s.ticker}><Zap size={16} className={refreshing === s.ticker ? 'loading-spinner' : ''} /></button></td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={5} style={{textAlign:'center', padding: 100, opacity: 0.3}}>Klik Scan Next untuk memulakan...</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>

        <div className="analytics-sidebar">
          <div className="analytics-section">
            <h3>Scanning Summary</h3>
            <div style={{marginTop: 15, background: 'rgba(255,255,255,0.03)', padding: 15, borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)'}}>
                <div style={{fontSize: 22, fontWeight: '800', color: 'var(--accent-cyan)'}}>{totalInMarket ? ((scannedCount / totalInMarket) * 100).toFixed(1) : '0'}%</div>
                <div style={{height: 5, background: 'rgba(255,255,255,0.1)', borderRadius: 10, margin:'10px 0', overflow:'hidden'}}><div style={{width: `${(scannedCount/(totalInMarket || 1))*100}%`, height: '100%', background: 'var(--accent-cyan)'}}></div></div>
                <div style={{display:'flex', justifyContent:'space-between', fontSize: 11, opacity: 0.5}}><span>{scannedCount} Scanned</span><span>{totalInMarket} Total</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
