import { useState, useEffect, useRef } from 'react';
import { 
  TrendingUp, Search,
  AlertTriangle, Zap, Play, Square, RotateCcw, LineChart, Star, Briefcase
} from 'lucide-react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { fetchScreener, fetchQuote, addToWatchlist, fetchWatchlist, removeFromWatchlist, fetchStockList } from './api';
import { X, ChevronRight, Info } from 'lucide-react';

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
  [...arr].sort((a, b) => {
    const rankMap: Record<string, number> = { 'A': 1, 'B': 2, 'C': 3, 'D': 4 };
    const rA = rankMap[a.setupRank || 'D'];
    const rB = rankMap[b.setupRank || 'D'];
    if (rA !== rB) return rA - rB;
    return (b.setupScore || 0) - (a.setupScore || 0);
  });

const formatVol = (val: number) => {
  if (!val) return '0';
  if (val >= 1000000) return (val / 1000000).toFixed(2) + 'M';
  if (val >= 1000) return (val / 1000).toFixed(0) + 'K';
  return val.toFixed(0);
};

const ActionBadge = ({ p }: { p: any }) => {
  const signal = (p?.signal || 'NONE').toUpperCase();
  const price = Number(p.current_price || p.price || 0);
  const entryLow = Number(p.entryRangeLow || p.entry_range_low || 0);
  const entryHigh = Number(p.entryRangeHigh || p.entry_range_high || 0);
  const haStatus = p.haStatus || 'UNKNOWN';
  const isExit = ['SELL', 'WARN', 'PRE-WARN'].includes(signal);

  if (isExit) return <span style={{display:'inline-block', background:'#ef4444', color:'white', padding:'2px 8px', borderRadius:4, fontSize:10, fontWeight:900, border:'1px solid #ff5252'}}>EXIT</span>;
  if (signal === 'NONE') return <span style={{background:'rgba(255,255,255,0.05)', color:'rgba(255,255,255,0.3)', padding:'2px 8px', borderRadius:4, fontSize:10}}>WAIT</span>;

  // Logic for Action with HA Confirmation
  // 2_GREEN means both current and previous HA candles are green.
  if (entryLow > 0 && entryHigh > 0) {
    if (price >= entryLow && price <= entryHigh) {
      if (haStatus === '2_GREEN') {
        return <span style={{background:'#10b981', color:'white', padding:'2px 8px', borderRadius:4, fontSize:10, fontWeight:900, boxShadow:'0 0 10px rgba(16,185,129,0.3)'}}>BUY NOW</span>;
      }
      return <span style={{background:'#40E0D0', color:'#0a0b14', padding:'2px 8px', borderRadius:4, fontSize:10, fontWeight:900, boxShadow:'0 0 8px rgba(64,224,208,0.3)'}}>WAIT (HA)</span>;
    }
    if (price < entryLow) {
      return <span style={{background:'rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', padding:'2px 8px', borderRadius:4, fontSize:10, fontWeight:900, border: '1px solid rgba(255,255,255,0.1)'}}>WAIT</span>;
    }
    if (price > entryHigh) {
      return <span style={{background:'rgba(255,255,255,0.05)', color:'rgba(255,255,255,0.4)', padding:'2px 8px', borderRadius:4, fontSize:10, fontWeight:900, border:'1px solid rgba(255,255,255,0.05)'}}>WATCH</span>;
    }
  }

  return <span style={{background:'rgba(255,255,255,0.05)', color:'rgba(255,255,255,0.4)', padding:'2px 8px', borderRadius:4, fontSize:10}}>WAIT</span>;
};

const RankBadge = ({ rank, score }: { rank: string, score: number }) => {
  const getRankColor = (r: string) => {
    if (r === 'A') return '#10b981';
    if (r === 'B') return '#6366f1';
    if (r === 'C') return '#40E0D0';
    return '#64748b';
  };
  
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4, 
      background: `${getRankColor(rank)}20`, padding: '2px 6px', borderRadius: 4,
      border: `1px solid ${getRankColor(rank)}40`
    }}>
      <span style={{ fontSize: 10, fontWeight: 900, color: getRankColor(rank) }}>{rank}</span>
      <div style={{ height: 8, width: 1, background: 'rgba(255,255,255,0.1)' }} />
      <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.9, color: 'white' }}>{Math.round(score)}</span>
    </div>
  );
};

const TradePlanCell = ({ p }: any) => {
  const signal = p?.signal || 'NONE';
  const isExit = (SIGNAL_RANK[signal] ?? 0) >= 4; 
  
  if (isExit) {
     return (
        <div style={{display:'flex', flexDirection:'column', gap: 4, alignItems: 'flex-start'}}>
            <ActionBadge p={p} />
            <span style={{color:'#ef4444', fontSize: 9, fontWeight: 700, opacity: 0.8}}>DANGER ZONE</span>
        </div>
     );
  }

  const tp = p.targetPrice || p.target_price || 0;
  const sl = p.stopLoss || p.stop_loss || 0;
  const entryHigh = p.entryRangeHigh || p.entry_range_high || 0;
  const entryLow = p.entryRangeLow || p.entry_range_low || 0;
  const rr = p.rrRatio || p.rr_ratio || p.currentRR || 0;
  const statusRaw = (p.entryStatus || p.entry_status || '').toLowerCase();
  
  const hasPlan = tp > 0 && sl > 0;
  const currency = 'RM';
  const dec = (v: number) => v < 1 ? 3 : 2;

  const getStatusColor = (s: string) => {
    if (['ideal', 'actionable'].includes(s)) return '#10b981';
    if (['acceptable'].includes(s)) return '#fbbf24';
    if (s === 'late_setup') return '#ff5252';
    if (s === 'waiting_confirmation') return '#60a5fa';
    if (s === 'incomplete_trade_plan') return '#94a3b8';
    if (s === 'insufficient_data') return '#64748b';
    return 'rgba(255,255,255,0.4)';
  };

  const getFriendlyStatus = (s: string) => {
    if (s === 'late_setup') return 'LATE SETUP';
    if (s === 'waiting_confirmation') return 'WAITING CONFIRMATION';
    if (s === 'incomplete_trade_plan') return 'TRADE PLAN INCOMPLETE';
    if (s === 'insufficient_data') return 'INSUFFICIENT DATA';
    if (s === 'ideal') return 'ACTIONABLE (IDEAL)';
    if (s === 'acceptable') return 'ACTIONABLE (ACCEPT)';
    if (s === 'invalid') return 'INVALID / BROKEN';
    return s.toUpperCase().replace(/_/g, ' ') || 'NO ACTIVE SETUP';
  };

  // If no plan fields but signal exists
  if (!hasPlan && signal !== 'NONE') {
    const fallbackStatus = statusRaw || 'incomplete_trade_plan';
    return (
      <div style={{display:'flex', flexDirection:'column', gap: 4}}>
        <span style={{
          fontSize: 9, padding: '2px 6px', borderRadius: 4, 
          background: `${getStatusColor(fallbackStatus)}15`, 
          color: getStatusColor(fallbackStatus), border: `1px solid ${getStatusColor(fallbackStatus)}33`,
          fontWeight: 800, textTransform: 'uppercase', width: 'fit-content'
        }}>
          {getFriendlyStatus(fallbackStatus)}
        </span>
        <span style={{fontSize: 9, opacity: 0.4}}>Price levels undetermined</span>
      </div>
    );
  }

  if (!hasPlan) {
    if (statusRaw && statusRaw !== 'no_active_setup') {
       return (
         <span style={{
            fontSize: 9, padding: '2px 6px', borderRadius: 4, 
            background: `${getStatusColor(statusRaw)}15`, 
            color: getStatusColor(statusRaw), border: `1px solid ${getStatusColor(statusRaw)}33`,
            fontWeight: 800, textTransform: 'uppercase', width: 'fit-content'
          }}>
            {getFriendlyStatus(statusRaw)}
          </span>
       );
    }
    return <span style={{opacity:0.3, fontSize:10, fontWeight: 600}}>NO ACTIVE SETUP</span>;
  }

  return (
    <div style={{display:'flex', flexDirection:'column', gap: 3, minWidth: 140}}>
      <div style={{fontSize: 12, fontWeight: 800, color: '#facc15'}}>
         <span style={{opacity:0.6, fontSize: 9, marginRight: 4}}>ENTRY</span>
         {p.suggestedEntry > 0 
           ? `${currency} ${p.suggestedEntry.toFixed(dec(p.suggestedEntry))}` 
           : (entryLow > 0 && entryHigh > entryLow 
             ? `${currency} ${entryLow.toFixed(dec(entryLow))} – ${entryHigh.toFixed(dec(entryHigh))}` 
             : `${currency} ${(entryLow || p.entry_price || 0).toFixed(dec(entryLow||p.entry_price))}`)}
      </div>
      <div style={{fontSize: 11, fontWeight: 700, color: '#4facfe'}}>
         <span style={{opacity:0.6, fontSize: 9, marginRight: 4}}>TP</span>
         {currency} {tp.toFixed(dec(tp))}
      </div>
      <div style={{fontSize: 11, fontWeight: 700, color: '#ff5252'}}>
         <span style={{opacity:0.6, fontSize: 9, marginRight: 4}}>SL</span>
         {currency} {sl.toFixed(dec(sl))}
      </div>
      <div style={{display:'flex', alignItems: 'center', gap: 8, marginTop: 5}}>
         <ActionBadge p={p} />
         <span style={{fontSize: 9, fontWeight: 700, opacity: 0.8}}>RR: <span style={{color: 'var(--accent-cyan)'}}>{rr > 0 ? rr.toFixed(2) : '-'}</span></span>
         <span style={{
            fontSize: 9, padding: '1px 5px', borderRadius: 4, 
            background: `${getStatusColor(statusRaw)}15`, 
            color: getStatusColor(statusRaw), border: `1px solid ${getStatusColor(statusRaw)}33`,
            fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.4px'
         }}>{getFriendlyStatus(statusRaw)}</span>
      </div>
    </div>
  );
};

// MARKET SCREENER COMPONENT (BURSA MALAYSIA ONLY)
const MarketScreener = ({ isActive, watchlist, handleToggleWatchlist }: any) => {
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const market = 'MYR';
  
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
  const [lastUpdated, setLastUpdated] = useState<string | null>(() => {
    return localStorage.getItem(`last_updated_${market}`);
  });

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
    if (lastUpdated) localStorage.setItem(`last_updated_${market}`, lastUpdated);
  }, [signals, scannedCount, totalInMarket, currentOffset, market, lastUpdated]);

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
    localStorage.removeItem(`last_updated_${market}`);
    setLastUpdated(null);
    
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
      
      if (data && data.results && data.results.length > 0) {
        // Update last updated timestamp from the first result if available
        const latestDate = data.results[0].timestamp;
        if (latestDate) {
          const dateObj = new Date(latestDate);
          const formatted = dateObj.toLocaleDateString('en-GB', { 
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
          });
          setLastUpdated(formatted);
        }

        const actionable = data.results.filter((r: any) => r.signal && r.signal !== 'NONE');
        setSignals(prev => sortBySignal([...prev, ...actionable]));
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
              avgVolumeRM: data.avgVolumeRM || s.avgVolumeRM,
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
          {lastUpdated && (
            <div style={{fontSize: 10, color: 'var(--text-muted)', marginTop: 8, display:'flex', alignItems:'center', gap: 4}}>
              <span style={{width: 6, height: 6, borderRadius: '50%', background: '#00FF41', display:'inline-block'}}></span>
              Data as of: <span style={{color: 'var(--text-main)', fontWeight: 600}}>{lastUpdated}</span>
            </div>
          )}
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
            <h2>Bursa Malaysia Results</h2>
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
                <th className="hide-mobile" style={{width:'22%'}}>SYMBOL</th>
                <th className="hide-mobile" style={{width:'11%'}}>SIGNAL</th>
                <th style={{width:'12%', textAlign:'center'}}>ACTION</th>
                <th style={{width:'10%'}}>PRICE</th>
                <th style={{width:'18%'}}>EP ZONE</th>
                <th style={{width:'27%', textAlign:'center'}}>TOOLS</th>
              </tr>
            </thead>
            <tbody>
              {signals.length > 0 ? (
                signals.map((s, i) => (
                  <tr key={i}>
                    <td className="hide-mobile">
                      <div className="symbol-cell">
                        <div className="symbol-icon" style={{background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)', color: 'white'}}>{(s.name || s.ticker)[0]}</div>
                        <div style={{display:'flex', flexDirection:'column', gap: 2, flex: 1}}>
                          <div style={{display:'flex', alignItems:'center', justifyContent: 'space-between'}}>
                             <strong style={{fontSize: 14, color: 'white'}}>{s.name}</strong>
                             {s.setupRank && <RankBadge rank={s.setupRank} score={s.setupScore || 0} />}
                          </div>
                          <span style={{fontSize: 11, opacity: 0.5, fontWeight: 500, letterSpacing: '0.5px'}}>{s.ticker}</span>
                          <span style={{fontSize: 9, opacity: 0.4, fontWeight: 700}}>VOL: {formatVol(s.avgVolumeRM)} RM</span>
                        </div>
                      </div>
                    </td>
                    <td className="hide-mobile">
                      <div style={{display:'flex', flexDirection: 'column', gap: 4}}>
                        <div style={{display:'flex', alignItems:'center', gap: 6, flexWrap: 'wrap'}}>
                          <span className={`signal-badge signal-${(s.signal || 'NONE').split('-')[0]}`}>{s.signal || 'NONE'}</span>
                          {s.isBTST && <span className="btst-badge">BTST</span>}
                          {s.signal === 'SWING' && <span className="swing-badge">SWING PRO</span>}
                          {s.previewOnly && <span className="preview-badge" style={{fontSize: 9, padding: '2px 5px', background: 'rgba(59,130,246,0.1)', color: '#60a5fa', borderRadius: 4, border: '1px solid rgba(59,130,246,0.2)'}}>LIVE PREVIEW</span>}
                          {s.exitRisk === 'HIGH' && (
                             <span style={{fontSize: 9, padding: '2px 5px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', borderRadius: 4, fontWeight: 800}}>EXIT RISK</span>
                          )}
                        </div>
                      
                      {['SWING','REBUY','BUY-T','BUY-R'].includes(s.signal) && s.targetPrice && s.stopLoss && (
                        <div style={{display:'flex', flexDirection:'column', gap: 2, marginTop: 6, padding: '4px 8px', background: 'rgba(255,255,255,0.02)', borderRadius: 4, borderLeft: '2px solid var(--accent-cyan)'}}>
                           <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                             <span style={{fontSize: 10, color: 'var(--accent-cyan)', fontWeight: 700}}>Target: RM {s.targetPrice.toFixed(3)}</span>
                             <span style={{fontSize: 9, opacity: 0.6}}>RR {s.rrRatio?.toFixed(1) || 'N/A'}</span>
                           </div>
                           <span style={{fontSize: 10, color: '#ff5252', fontWeight: 600}}>Stop: RM {s.stopLoss.toFixed(3)}</span>
                        </div>
                      )}

                      {s.isBTST && s.btstMetadata && (
                        <div style={{marginTop: 6, padding: '4px 8px', background: 'rgba(251,191,36,0.05)', borderRadius: 4, borderLeft: '2px solid #fbbf24'}}>
                            <div style={{fontSize: 10, fontWeight: 800, color: '#fbbf24'}}>BTST TP: {s.btstMetadata.target.toFixed(3)}</div>
                        </div>
                      )}
                    </div>
                  </td>
                  <td style={{textAlign:'center'}}>
                    <ActionBadge p={s} />
                  </td>
                  <td style={{fontWeight:600}}>RM {s.price?.toFixed(s.price<1?3:2)}</td>
                  <td style={{padding: '12px 8px'}}>
                      <TradePlanCell p={s} />
                  </td>
                  <td style={{textAlign:'center', paddingRight: 10}}>
                    <div style={{display:'flex', alignItems:'center', justifyContent:'center', gap: 10}}>
                      <button className="icon-btn-refresh" onClick={() => handleRefreshTicker(s.ticker)} disabled={refreshing === s.ticker}>
                        <Zap size={14} className={refreshing === s.ticker ? 'loading-spinner' : ''} />
                      </button>
                      <button 
                        className="icon-btn-refresh" 
                        style={{color: watchlist.some((p:any) => p.ticker === s.ticker) ? '#ffc107' : 'inherit'}} 
                        onClick={() => handleToggleWatchlist(s)}
                      >
                        <Star size={14} fill={watchlist.some((p:any) => p.ticker === s.ticker) ? "#ffc107" : "none"} />
                      </button>
                        <a
                          href={`https://www.tradingview.com/chart/?symbol=MYX:${s.ticker.replace('.KL','')}`}
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
  const [activeTab, setActiveTab] = useState<'SCREENS' | 'WATCHLIST'>('SCREENS');
  const [watchlist, setWatchlist] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  
  // Search & Health Check State
  const [searchTerm, setSearchTerm] = useState('');
  const [allStocks, setAllStocks] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedStock, setSelectedStock] = useState<any | null>(null);
  const [isHealthLoading, setIsHealthLoading] = useState(false);
  const [healthData, setHealthData] = useState<any | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const [scanningStatus, setScanningStatus] = useState<Record<string, number>>({});

  // Close suggestions on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Load all stocks for search
  // Load all stocks for search (Server-side from D1)
  useEffect(() => {
    const loadStocks = async () => {
      try {
        const data = await fetchStockList();
        if (data.results) {
            setAllStocks(data.results);
        }
      } catch (e) {
        console.error('Failed to load stock list:', e);
      }
    };
    loadStocks();
  }, []);

  // Handle Search Input
  useEffect(() => {
    if (searchTerm.length < 1) {
      setSuggestions([]);
      return;
    }
    const cleanSearch = searchTerm.toLowerCase().trim();
    const filtered = allStocks
      .filter(s => {
        const fullTicker = (s.ticker_full || '').toLowerCase();
        const shortCode = fullTicker.split('.')[0];
        const fullName = (s.company_name || '').toLowerCase();
        const shortName = (s.short_name || '').toLowerCase();
        
        return fullTicker.includes(cleanSearch) || 
               shortCode.includes(cleanSearch) ||
               fullName.includes(cleanSearch) || 
               shortName.includes(cleanSearch);
      })
      .slice(0, 15);
    setSuggestions(filtered);
  }, [searchTerm, allStocks]);

  const handleSelectStock = async (stock: any) => {
    setSearchTerm('');
    setShowSuggestions(false);
    setSelectedStock(stock);
    setIsHealthLoading(true);
    setHealthData(null);
    
    try {
      const data = await fetchQuote(stock.ticker_full);
      setHealthData(data);
    } catch (e) {
      console.error('Health check failed:', e);
    } finally {
      setIsHealthLoading(false);
    }
  };

  const hasAutoRefreshed = useRef(false);

  const loadWatchlist = async () => {
    try {
      const data = await fetchWatchlist();
      const list = data.results || [];
      setWatchlist(list);
      
      // Auto-refresh all items when entering Watchlist tab for the first time
      if (activeTab === 'WATCHLIST' && !hasAutoRefreshed.current && list.length > 0) {
        hasAutoRefreshed.current = true;
        const ids = list.map((p: any) => p.ticker);
        let i = 0;
        const next = () => {
          if (i < ids.length) {
            const item = list.find((p: any) => p.ticker === ids[i]);
            if (item) handleRefreshWatchlistTicker(item);
            i++;
            setTimeout(next, 500);
          }
        };
        next();
      }
    } catch (e) {
      console.error('Load Watchlist Error:', e);
    }
  };

  useEffect(() => {
    loadWatchlist();
  }, [activeTab]);

  const handleToggleWatchlist = async (s: any) => {
    const isSaved = watchlist.some(p => p.ticker === s.ticker);
    try {
      if (isSaved) {
        setWatchlist(prev => prev.filter(p => p.ticker !== s.ticker));
        await removeFromWatchlist(s.ticker);
      } else {
        const newItem = {
          ticker: s.ticker,
          name: s.name,
          entry_price: s.price || 0,
          target_price: s.targetPrice || s.target_price || 0,
          stop_loss: s.stopLoss || s.stop_loss || 0,
          signal: s.signal,
          reason: s.explanation || s.reason || '',
          isBTST: s.isBTST,
          isCaution: s.isCaution,
          suggested_entry: s.suggestedEntry || s.suggested_entry || 0,
          entry_range_low: s.entryRangeLow || s.entry_range_low || 0,
          entry_range_high: s.entryRangeHigh || s.entry_range_high || 0,
          rr_ratio: s.rrRatio || s.rr_ratio || 0,
          entry_status: s.entryStatus || s.entry_status || ''
        };
        setWatchlist(prev => [...prev, newItem]);
        await addToWatchlist(newItem);
      }
    } catch (e: any) {
      console.error('Toggle Watchlist Error:', e);
      alert(`Terdapat ralat teknikal semasa menyimpan Watchlist: ${e.message}`);
      loadWatchlist();
    }
  };

  const handleRefreshWatchlistTicker = async (p: any) => {
    if (!p || refreshing === p.ticker) return;
    setRefreshing(p.ticker);
    
    // Start visual percentage simulation
    let pct = 0;
    const interval = setInterval(() => {
      pct += Math.random() * 15;
      if (pct > 92) pct = 92; 
      setScanningStatus(prev => ({ ...prev, [p.ticker]: Math.floor(pct) }));
    }, 150);

    const startTime = Date.now();

    try {
      const data = await fetchQuote(p.ticker);
      
      // Ensure UI shows scanning for at least 1.5s for professional feel
      const elapsed = Date.now() - startTime;
      if (elapsed < 1500) await new Promise(resolve => setTimeout(resolve, 1500 - elapsed));
      
      if (data && !data.error) {
        setWatchlist(prev => {
          const exists = prev.find(item => item.ticker === p.ticker);
          if (!exists) return prev;

          const updatedItem = { 
              ...exists, 
              current_price: Number(data.price),
              target_price: data.targetPrice || data.target_price || exists.target_price,
              stop_loss: data.stopLoss || data.stop_loss || exists.stop_loss,
              signal: (data.signal && data.signal !== 'NONE') ? data.signal : (exists.signal || 'RESCAN'),
              reason: data.explanation || data.reason || exists.reason,
              isBTST: data.isBTST !== undefined ? data.isBTST : exists.isBTST,
              isCaution: data.isCaution !== undefined ? data.isCaution : exists.isCaution,
              suggested_entry: data.suggestedEntry || data.suggested_entry || exists.suggested_entry,
              entry_range_low: data.entryRangeLow || data.entry_range_low || exists.entry_range_low,
              entry_range_high: data.entryRangeHigh || data.entry_range_high || exists.entry_range_high,
              rr_ratio: data.currentRR || data.rrRatio || data.rr_ratio || exists.rr_ratio,
              entry_status: data.entryStatus || data.entry_status || exists.entry_status,
              avg_volume_rm: data.avgVolumeRM || data.avg_volume_rm || exists.avg_volume_rm
          };

          // Persist to D1 only after state is ready
          addToWatchlist(updatedItem).catch(console.error);

          return prev.map(item => item.ticker === p.ticker ? updatedItem : item);
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      clearInterval(interval);
      setScanningStatus(prev => {
        const next = { ...prev };
        delete next[p.ticker];
        return next;
      });
      setRefreshing(null);
    }
  };

  return (
    <div className="main-layout">
      <div style={{position:'fixed', bottom: 10, right: 10, fontSize: 10, opacity: 0.3, zIndex: 9999}}>v4.1 · Bursa Swing Engine</div>
      <div className="header">
        <div className="logo-group"><TrendingUp size={24} color="var(--accent-cyan)" /><h1 style={{fontSize: 22}}>MarketWise <span style={{fontWeight: 400, opacity: 0.6}}>Bursa</span></h1></div>
        <div className="top-nav">
          <a className={`nav-link ${activeTab === 'SCREENS' ? 'active' : ''}`} onClick={() => { setActiveTab('SCREENS'); }}>Screener</a>
          <a className={`nav-link ${activeTab === 'WATCHLIST' ? 'active' : ''}`} onClick={() => setActiveTab('WATCHLIST')}>
            <Briefcase size={16} style={{marginRight: 8}} /> My Watchlist
          </a>
        </div>
        <div style={{display:'flex', gap:'20px', alignItems:'center'}}>
          <div className="search-box" style={{position:'relative'}} ref={searchRef}>
            <Search size={18} />
            <input 
              type="text" 
              placeholder="Cari mana-mana kaunter..." 
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setShowSuggestions(false);
              }}
              style={{ paddingRight: '12px' }}
            />
            {showSuggestions && searchTerm.length >= 1 && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 8px)', left: 0, right: 0, 
                background: '#1a1b2e', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 12, zIndex: 10000, overflow: 'hidden',
                boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
                minWidth: '280px'
              }}>
                {suggestions.length > 0 ? suggestions.map((s, idx) => (
                  <div 
                    key={idx}
                    className="suggestion-item"
                    onClick={() => handleSelectStock(s)}
                    style={{
                      padding: '12px 16px', color: 'white', cursor: 'pointer',
                      borderBottom: idx === suggestions.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.05)',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      transition: 'background 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ display:'flex', flexDirection:'column', gap: 2 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'white', display:'flex', alignItems:'center', gap: 6 }}>
                        {s.company_name}
                        {s.shariah_status === 'S' && <Star size={10} fill="#10b981" color="#10b981" />}
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', display:'flex', gap: 8 }}>
                        <span>{s.ticker_full}</span>
                        {s.short_name && <span>• {s.short_name}</span>}
                      </div>
                    </div>
                    <ChevronRight size={14} opacity={0.3} />
                  </div>
                )) : (
                  <div style={{padding: '20px', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13}}>
                    Tiada kaunter dijumpai...
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <MarketScreener market="MYR" isActive={activeTab === 'SCREENS'} watchlist={watchlist} handleToggleWatchlist={handleToggleWatchlist} />

      <div style={{display: activeTab === 'WATCHLIST' ? 'block' : 'none', width: '100%'}}>
        <div className="screener-section">
          <div className="table-header">
            <div style={{display:'flex', alignItems:'center', gap: 15}}>
               <h2>My Watchlist</h2>
               <button 
                 className="tab-btn" 
                 onClick={() => {
                   const ids = watchlist.map(p => p.ticker);
                   let i = 0;
                   const next = () => {
                     if (i < ids.length) {
                       handleRefreshWatchlistTicker(watchlist.find(p => p.ticker === ids[i]));
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
                  <th className="hide-mobile" style={{width:'18%'}}>SYMBOL</th>
                  <th className="hide-mobile" style={{width:'12%'}}>SIGNAL</th>
                  <th style={{width:'12%', textAlign:'center'}}>ACTION</th>
                  <th style={{width:'13%'}}>WATCH PRICE</th>
                  <th style={{width:'20%'}}>TRADE PLAN</th>
                  <th style={{width:'15%', textAlign:'center'}}>TOOLS</th>
                </tr>
              </thead>
              <tbody>
                {watchlist.length > 0 ? (
                  watchlist.map((p: any) => (
                    <tr key={p.ticker} style={{borderLeft: '4px solid #6366f1', background: 'rgba(99,102,241,0.03)'}}>
                      <td className="hide-mobile">
                        <div className="symbol-cell">
                          <div className="symbol-icon" style={{background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)', color: 'white'}}>{(p.name || p.ticker)[0]}</div>
                          <div style={{display:'flex', flexDirection:'column', gap: 2}}>
                            <strong style={{fontSize: 14, color: 'white'}}>{p.name}</strong>
                            <span style={{fontSize: 11, opacity: 0.5, fontWeight: 500}}>{p.ticker}</span>
                            <span style={{fontSize: 9, opacity: 0.4, fontWeight: 700}}>VOL: {formatVol(p.avgVolumeRM || p.avg_volume_rm || 0)} RM</span>
                          </div>
                        </div>
                      </td>
                      <td className="hide-mobile">
                        <div style={{display:'flex', flexDirection: 'column', gap: 4}}>
                           <div style={{display:'flex', alignItems:'center', gap: 6, flexWrap: 'wrap'}}>
                              {scanningStatus[p.ticker] ? (
                                <div style={{display:'flex', alignItems:'center', gap: 6}}>
                                  <span className="signal-badge" style={{
                                    background: 'rgba(99,102,241,0.1)', 
                                    color: '#818cf8',
                                    border: '1px solid rgba(99,102,241,0.2)',
                                    animation: 'pulse 1.5s infinite'
                                  }}>
                                    SCANNING {scanningStatus[p.ticker]}%
                                  </span>
                                </div>
                              ) : (p.signal && p.signal !== 'NONE' && p.signal !== 'RESCAN') ? (
                                <>
                                  <span className={`signal-badge signal-${p.signal.split('-')[0]}`}>{p.signal}</span>
                                  {p.isBTST && <span className="btst-badge">BTST</span>}
                                  {p.signal === 'SWING' && <span className="swing-badge">SWING PRO</span>}
                                  {p.confidence !== undefined && <span style={{fontSize: 9, padding: '2px 4px', background: 'rgba(16,185,129,0.1)', color:'#10b981', borderRadius: 4, fontWeight: 600}}>{p.confidence}%</span>}
                                  {p.isCaution && <AlertTriangle size={14} color="#FFD700" />}
                                </>
                              ) : (
                                <span className="signal-badge" style={{background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.3)'}}>WAIT</span>
                              )}
                           </div>
                        </div>
                      </td>
                      <td style={{textAlign:'center'}}>
                        <ActionBadge p={p} />
                      </td>
                      <td style={{fontWeight: 700}}>
                          <span style={{fontSize: 10, opacity: 0.5, display:'block', marginBottom: 2}}>Avg: {Number(p.entry_price || 0).toFixed(3)}</span>
                          <span style={{color: (p.current_price || p.price) > p.entry_price ? '#00FF41' : '#ff5252'}}>
                            Live: RM {Number(p.current_price || p.entry_price || p.price || 0).toFixed(3)}
                          </span>
                      </td>
                      <td style={{padding: '12px 0'}}>
                        <TradePlanCell p={p} />
                      </td>
                      <td style={{textAlign:'center'}}>
                        <div style={{display:'flex', alignItems:'center', justifyContent:'center', gap: 12}}>
                          <button className={`icon-btn-refresh ${refreshing === p.ticker ? 'active' : ''}`} onClick={() => handleRefreshWatchlistTicker(p)} disabled={refreshing === p.ticker} title="Refresh Live Price">
                            <Zap size={14} className={refreshing === p.ticker ? 'loading-spinner' : ''} />
                          </button>
                          <button 
                            className="icon-btn-refresh" 
                            style={{borderColor: 'rgba(239, 68, 68, 0.3)', color: '#ef4444'}} 
                            onClick={() => handleToggleWatchlist(p)}
                            title="Buang dari Watchlist"
                          >
                            <Star size={14} fill="#ef4444" />
                          </button>
                          <a
                            href={`https://www.tradingview.com/chart/?symbol=MYX:${p.ticker.replace('.KL','')}`}
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
                  <tr><td colSpan={6} style={{textAlign:'center', padding: 60, opacity: 0.5}}>Watchlist kosong. Klik ⭐ pada screening untuk simpan.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {/* HEALTH CHECK MODAL */}
      {selectedStock && (
        <div style={{
          position:'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.2)', 
          display:'flex', alignItems:'center', justifyContent:'center', zIndex: 10000,
          backdropFilter: 'blur(8px)'
        }}>
          <div style={{
            width: '90%', maxWidth: 500, background: '#0a0b14', 
            borderRadius: 24, border: '1px solid rgba(255,255,255,0.1)',
            overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)'
          }}>
            <div style={{
                padding: '24px', background: 'linear-gradient(to bottom, rgba(99,102,241,0.1), transparent)',
                borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'
            }}>
                <div>
                    <h2 style={{margin: 0, fontSize: 20, color: 'white'}}>{selectedStock.company_name}</h2>
                    <div style={{fontSize: 12, opacity: 0.5, marginTop: 4}}>{selectedStock.ticker_full} · Bursa Malaysia</div>
                </div>
                <button onClick={() => setSelectedStock(null)} style={{background:'rgba(255,255,255,0.05)', border:0, color:'white', padding: 8, borderRadius: 12, cursor:'pointer'}}>
                    <X size={20} />
                </button>
            </div>
            
            <div style={{padding: 24}}>
                {isHealthLoading ? (
                    <div style={{padding: '40px 0', textAlign:'center', display:'flex', flexDirection:'column', alignItems:'center', gap: 15}}>
                        <Zap size={32} className="loading-spinner" color="var(--accent-cyan)" />
                        <span style={{fontSize: 14, opacity: 0.6}}>Menganalisa data pasaran terkini...</span>
                    </div>
                ) : healthData ? (
                    <div style={{display:'flex', flexDirection:'column', gap: 24}}>
                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding: '16px', background:'rgba(255,255,255,0.03)', borderRadius: 16}}>
                            <div>
                                <div style={{fontSize: 10, opacity: 0.5, textTransform:'uppercase'}}>Market Price</div>
                                <div style={{display: 'flex', alignItems: 'baseline', gap: 10}}>
                                    <div style={{fontSize: 24, fontWeight: 800, color: 'white'}}>RM {healthData.price?.toFixed(3)}</div>
                                    <div style={{
                                        fontSize: '13px', 
                                        fontWeight: 700, 
                                        color: (healthData.change || 0) >= 0 ? '#4ade80' : '#f87171',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 2
                                    }}>
                                        {(healthData.change || 0) >= 0 ? '+' : ''}{healthData.changePercent?.toFixed(2)}%
                                    </div>
                                </div>
                            </div>
                            <div style={{textAlign:'right'}}>
                                <div style={{fontSize: 10, opacity: 0.5, textTransform:'uppercase', marginBottom: 4}}>Signal Status</div>
                                <ActionBadge p={healthData} />
                            </div>
                        </div>

                        {/* Details Grid */}
                        <div style={{display:'grid', gridTemplateColumns: '1fr 1fr', gap: 16}}>
                            <div style={{padding: 16, background:'rgba(16,185,129,0.03)', border:'1px solid rgba(16,185,129,0.1)', borderRadius: 16}}>
                                <div style={{fontSize: 10, color:'#10b981', fontWeight: 700, marginBottom: 8}}>LIQUIDITY</div>
                                <div style={{fontSize: 16, fontWeight: 700, color: 'white'}}>{formatVol(healthData.avgVolumeRM)} RM</div>
                                <div style={{fontSize: 10, opacity: 0.5, marginTop: 4}}>Avg Daily Value (20D)</div>
                            </div>
                            <div style={{padding: 16, background: healthData.exitRisk === 'HIGH' ? 'rgba(239,68,68,0.03)' : 'rgba(16,185,129,0.03)', border: healthData.exitRisk === 'HIGH' ? '1px solid rgba(239,68,68,0.1)' : '1px solid rgba(16,185,129,0.1)', borderRadius: 16}}>
                                <div style={{fontSize: 10, color: healthData.exitRisk === 'HIGH' ? '#ef4444' : '#10b981', fontWeight: 700, marginBottom: 8}}>EXIT RISK</div>
                                <div style={{fontSize: 16, fontWeight: 700, color: 'white'}}>{healthData.exitRisk || 'LOW'}</div>
                                <div style={{fontSize: 10, opacity: 0.5, marginTop: 4}}>Ease of Liquidation</div>
                            </div>
                        </div>

                        {/* Trade Plan Analysis */}
                        <div style={{padding: 20, background:'rgba(99,102,241,0.05)', border:'1px solid rgba(99,102,241,0.1)', borderRadius: 20}}>
                            <div style={{display:'flex', alignItems:'center', gap: 8, marginBottom: 16}}>
                                <Info size={16} color="var(--accent-cyan)" />
                                <span style={{fontSize: 13, fontWeight: 700, color: 'white'}}>Trade Plan Insight</span>
                            </div>
                            <TradePlanCell p={healthData} />
                            <div style={{marginTop: 16, padding: 12, background:'rgba(0,0,0,0.2)', borderRadius: 12, fontSize: 11, lineHeight: 1.5, color: 'rgba(255,255,255,0.7)'}}>
                                {healthData.explanation || healthData.reason || 'Tiada analisa tambahan untuk kaunter ini.'}
                            </div>
                        </div>

                        <div style={{display:'flex', gap: 12}}>
                            <button 
                                onClick={() => handleToggleWatchlist({
                                    ticker: healthData.ticker,
                                    name: healthData.name,
                                    price: healthData.price,
                                    suggestedEntry: healthData.suggestedEntry,
                                    targetPrice: healthData.targetPrice,
                                    stopLoss: healthData.stopLoss,
                                    signal: healthData.signal,
                                    explanation: healthData.explanation,
                                    isBTST: healthData.isBTST
                                })}
                                style={{
                                    flex: 1, padding: '14px', borderRadius: 16, border: 0,
                                    background: watchlist.some(p => p.ticker === healthData.ticker) ? 'rgba(239,68,68,0.1)' : 'var(--accent-cyan)',
                                    color: watchlist.some(p => p.ticker === healthData.ticker) ? '#ef4444' : '#0a0b14',
                                    fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                                }}
                            >
                                <Star size={18} fill={watchlist.some(p => p.ticker === healthData.ticker) ? "currentColor" : "none"} />
                                {watchlist.some(p => p.ticker === healthData.ticker) ? 'Remove Watchlist' : 'Add to Watchlist'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div style={{padding: '40px 0', textAlign:'center', opacity: 0.5}}>Gagal memuatkan data. Sila cuba lagi.</div>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
