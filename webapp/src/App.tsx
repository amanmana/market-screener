import { useState, useEffect, useRef } from 'react';
import { 
  TrendingUp, Search, ArrowUpRight, TrendingDown,
  AlertTriangle, Zap, ChevronDown, Play, Square, RotateCcw
} from 'lucide-react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { fetchScreener, fetchQuote } from './api';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const BATCH_SIZE = 200;
const AUTO_SCAN_DELAY_MS = 1500;

// Ranking: nombor kecil = lebih baik (paling atas)
const SIGNAL_RANK: Record<string, number> = {
  'BUY-T':    1,
  'BUY-R':    2,
  'REBUY':    3,
  'PRE-WARN': 4,
  'WARN':     5,
  'SELL':     6,
};

const sortBySignal = (arr: any[]) =>
  [...arr].sort((a, b) => (SIGNAL_RANK[a.signal] ?? 9) - (SIGNAL_RANK[b.signal] ?? 9));

const App = () => {
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [signals, setSignals] = useState<any[]>([]);
  const [activeMarket, setActiveMarket] = useState('MYR');
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
    resetAndStartScan(activeMarket);
  }, [activeMarket]);

  // Hentikan auto scan bila tukar market
  useEffect(() => {
    autoScanActive.current = false;
    setIsAutoScanning(false);
  }, [activeMarket]);

  const resetAndStartScan = async (market: string) => {
    autoScanActive.current = false;
    setIsAutoScanning(false);
    setSignals([]);
    setScannedCount(0);
    setCurrentOffset(0);
    setTotalInMarket(0);
    setErrorMsg(null);
    offsetRef.current = 0;
    totalRef.current = 0;
    await startScan(market, 0);
  };

  const startScan = async (market: string, offset: number): Promise<number> => {
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

    // Jika dah habis scan, reset dan mula dari awal
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
        // Selesai scan semua
        setAutoScanStatus('✅ Imbasan selesai!');
        break;
      }

      const batchNum = Math.floor(offsetRef.current / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil((currentTotal || 1110) / BATCH_SIZE);
      setAutoScanStatus(`Mengimbas batch ${batchNum}/${totalBatches}...`);

      await startScan(activeMarket, offsetRef.current);
      
      if (!autoScanActive.current) break;

      // Jeda antara batch supaya tidak overload
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
            return { ...s, price: data.price, isCaution: data.isCaution, reason: data.reason, isLive: true };
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
    <div className="main-layout">
      {errorMsg && (
        <div style={{position:'fixed', top: 20, left: '50%', transform: 'translateX(-50%)', background: '#e11d48', padding: '10px 20px', borderRadius: 10, zIndex: 10000, boxShadow: '0 10px 30px rgba(0,0,0,0.5)', fontWeight: 600, display:'flex', alignItems:'center', gap: 10}}>
          <AlertTriangle size={20} /> ERROR: {errorMsg}
        </div>
      )}
      
      <div style={{position:'fixed', bottom: 10, right: 10, fontSize: 10, opacity: 0.3, zIndex: 9999}}>v2.1 · CF Production</div>
      
      <div className="header">
        <div className="logo-group"><TrendingUp size={24} color="var(--accent-cyan)" /><h1 style={{fontSize: 22}}>MarketWise <span style={{fontWeight: 400, opacity: 0.6}}>Screener</span></h1></div>
        <div className="top-nav">
          <a className={`nav-link ${activeMarket === 'US' ? 'active' : ''}`} onClick={() => setActiveMarket('US')}>US Market</a>
          <a className={`nav-link ${activeMarket === 'MYR' ? 'active' : ''}`} onClick={() => setActiveMarket('MYR')}>Bursa Malaysia</a>
        </div>
        <div style={{display:'flex', gap:'20px', alignItems:'center'}}>
          <div className="search-box"><Search size={18} /><input type="text" placeholder="Cari kaunter..." /></div>
          <div className="user-pill"><img src="https://i.pravatar.cc/150?u=ak" style={{width: 28, height: 28, borderRadius: '50%'}} alt="user" /><span>Akhmal K. <ChevronDown size={14} /></span></div>
        </div>
      </div>

      <div className="stats-grid">
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
      </div>

      <div className="content-grid">
        <div className="screener-section">
          <div className="table-header">
            <h2>{activeMarket} Results</h2>
            <div style={{display:'flex', gap: 8, alignItems: 'center'}}>
              {/* Status Auto Scan */}
              {isAutoScanning && (
                <span style={{fontSize: 11, color: 'var(--accent-cyan)', animation: 'pulse 1.5s infinite'}}>
                  {autoScanStatus}
                </span>
              )}
              {autoScanStatus === '✅ Imbasan selesai!' && !isAutoScanning && (
                <span style={{fontSize: 11, color: '#00FF41'}}>{autoScanStatus}</span>
              )}

              {/* Reset */}
              <button className="tab-btn" onClick={() => resetAndStartScan(activeMarket)} disabled={isAutoScanning} title="Reset & mula semula">
                <RotateCcw size={14} />
              </button>

              {/* Scan Next (manual) */}
              <button 
                className="tab-btn" 
                onClick={() => startScan(activeMarket, currentOffset)} 
                disabled={isAutoScanning || isComplete}
              >
                Scan Next
              </button>

              {/* Auto Scan / Stop */}
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

          {/* Progress bar bawah table header */}
          {totalInMarket > 0 && (
            <div style={{height: 3, background: 'rgba(255,255,255,0.05)', marginBottom: 1}}>
              <div style={{
                height: '100%', 
                width: `${progress}%`, 
                background: isComplete ? '#00FF41' : 'var(--accent-cyan)',
                transition: 'width 0.5s ease',
                borderRadius: 2
              }} />
            </div>
          )}

          <div style={{maxHeight:'600px', overflowY:'auto'}}>
            <table>
              <thead>
                <tr>
                  <th style={{width:'20%'}}>SYMBOL</th>
                  <th style={{width:'15%'}}>SIGNAL</th>
                  <th style={{width:'15%'}}>PRICE</th>
                  <th style={{width:'45%'}}>DETAILED ANALYSIS</th>
                  <th style={{width:'5%'}}></th>
                </tr>
              </thead>
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
                  <tr><td colSpan={5} style={{textAlign:'center', padding: 80, opacity: 0.3}}>
                    {isAutoScanning ? '⏳ Mengimbas...' : 'Klik Auto Scan untuk imbas semua kaunter secara automatik'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="analytics-sidebar">
          <div className="analytics-section">
            <h3>Scanning Summary</h3>
            <div style={{marginTop: 15, background: 'rgba(255,255,255,0.03)', padding: 15, borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)'}}>
              <div style={{fontSize: 28, fontWeight: '800', color: isComplete ? '#00FF41' : 'var(--accent-cyan)'}}>
                {progress.toFixed(1)}%
              </div>
              <div style={{height: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 10, margin:'12px 0', overflow:'hidden'}}>
                <div style={{
                  width: `${progress}%`, 
                  height: '100%', 
                  background: isComplete ? '#00FF41' : 'linear-gradient(90deg, var(--accent-cyan), #7c5cfc)',
                  transition: 'width 0.5s ease',
                  borderRadius: 10
                }} />
              </div>
              <div style={{display:'flex', justifyContent:'space-between', fontSize: 11, opacity: 0.6}}>
                <span>{scannedCount} Scanned</span>
                <span>{totalInMarket} Total</span>
              </div>
            </div>

            {/* Status box */}
            <div style={{marginTop: 12, padding: '10px 14px', borderRadius: 10, background: isAutoScanning ? 'rgba(77,227,255,0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${isAutoScanning ? 'rgba(77,227,255,0.3)' : 'rgba(255,255,255,0.05)'}`, fontSize: 12}}>
              {isAutoScanning ? (
                <div style={{color: 'var(--accent-cyan)'}}>
                  🔄 Auto Scan berjalan...<br/>
                  <span style={{opacity: 0.7, fontSize: 11}}>Jeda 1.5s antara setiap batch</span>
                </div>
              ) : isComplete ? (
                <div style={{color: '#00FF41'}}>✅ Semua {totalInMarket} kaunter telah diimbas</div>
              ) : (
                <div style={{opacity: 0.5, fontSize: 11}}>
                  Klik <strong>Auto Scan</strong> untuk imbas semua {totalInMarket || 1110} kaunter secara automatik
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
