
// ═══════════════════════════════════════════════════════════
//  PORTFOLIO DASHBOARD — Integrated from portfolio-dashboard.html
// ═══════════════════════════════════════════════════════════

// getPortCryptoWL() is now dynamic — always reads the active watchlist from settings
function getPortCryptoWL() { return getWatchlist(); }

async function portApiFetch(url) {
  const r = await fetch(url, { headers: getHeaders() });
  if (!r.ok) throw new Error(r.status + " " + r.statusText + " (" + url + ")");
  return r.json();
}

// ── Port CAP helper (uses existing PORTFOLIO_CAPS from pro dashboard) ──
function portCapFor(sym) { return PORTFOLIO_CAPS[sym] || 5; }

// ── Port data stores ──
let portRawPositions = [];
const portPosSort = { key: null, dir: 1 };
let portRawDistTable = [];
let portRawDistCapData = [];
const portDistTableSort = { key: "market_value", dir: -1 };
const portDistCapSort = { key: "curPct", dir: -1 };
let portDistChartInst = null;
let portPortfolioChartInst = null;
let portChartPeriod = "1M", portChartTimeframe = "1D";

const DIST_COLORS = [
  "#58a6ff","#3fb950","#f0883e","#bc8cff","#d29922",
  "#ff7b72","#39d353","#79c0ff","#ffa657","#d2a8ff",
  "#8b949e",
];

// ── Port helpers ──
function portFmtVol(n) {
  if (!n || isNaN(n)) return "–";
  const v = parseFloat(n);
  if (v > 1e9) return fmt(v / 1e9, 1) + "B";
  if (v > 1e6) return fmt(v / 1e6, 1) + "M";
  if (v > 1e3) return fmt(v / 1e3, 1) + "K";
  return fmt(v, 0);
}
function portPctFmt(n, asDecimal) {
  if (n == null || isNaN(n)) return "–";
  const v = asDecimal ? parseFloat(n) * 100 : parseFloat(n);
  return (v >= 0 ? "+" : "") + fmt(Math.abs(v), 2) + "%";
}
function portChangeBar(pct, maxPct) {
  maxPct = maxPct || 10;
  const v = parseFloat(pct);
  if (isNaN(v)) return "–";
  const cls = v >= 0 ? "pos" : "neg";
  const w = Math.min(Math.abs(v) / maxPct * 100, 100).toFixed(1);
  return `<div class="bar-track"><div class="bar-fill ${cls}" style="width:${w}%"></div></div>`;
}
function portStatusBadge(s) {
  return `<span class="port-status-badge port-status-${s}">${s.replace(/_/g, " ")}</span>`;
}

// ── Port Overview: Account ──
async function portLoadAccount() {
  const a = await apiFetch("/v2/account");
  const equity = parseFloat(a.equity);
  const cash = parseFloat(a.cash);
  const bp = parseFloat(a.buying_power);
  const pv = parseFloat(a.portfolio_value ?? a.equity);
  const lastEq = parseFloat(a.last_equity);
  const dayPL = equity - lastEq;
  const dayPct = lastEq ? dayPL / lastEq : 0;
  const unrealPL = parseFloat(a.unrealized_pl ?? 0);
  const unrealPct = parseFloat(a.unrealized_plpc ?? 0);
  $("portStatEquity").textContent = "$" + fmt(equity);
  $("portStatCash").textContent = "$" + fmt(cash);
  $("portStatBP").textContent = "$" + fmt(bp);
  $("portStatPortfolio").textContent = "$" + fmt(pv);
  const uEl = $("portStatUnrealPL");
  uEl.textContent = plSign(unrealPL); uEl.className = "card-value " + plClass(unrealPL);
  $("portStatUnrealPct").textContent = portPctFmt(unrealPct, true);
  const dEl = $("portStatDayPL");
  dEl.textContent = plSign(dayPL); dEl.className = "card-value " + plClass(dayPL);
  $("portStatDayPct").textContent = portPctFmt(dayPct, true);
}

// ── Port Overview: Portfolio Chart ──
async function portLoadPortfolioChart(period, timeframe) {
  period = period || portChartPeriod;
  timeframe = timeframe || portChartTimeframe;
  const data = await apiFetch(
    "/v2/account/portfolio/history?period=" + period +
    "&timeframe=" + timeframe + "&intraday_reporting=continuous&extended_hours=true"
  );
  const timestamps = data.timestamp || [];
  const equities = data.equity || [];
  let end = equities.length - 1;
  while (end > 0 && !equities[end]) end--;
  const ts = timestamps.slice(0, end + 1);
  const eq = equities.slice(0, end + 1).map(v => v ?? 0);
  const labels = ts.map(t => {
    const d = new Date(t * 1000);
    if (timeframe === "5Min" || timeframe === "1H") return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  });
  const baseVal = data.base_value || eq[0] || 0;
  const lastVal = eq[eq.length - 1] || 0;
  const totalPL = lastVal - baseVal;
  const lineClr = totalPL >= 0 ? "#58a6ff" : "#f85149";
  $("portChartMeta").innerHTML = `Base <b>$${fmt(baseVal)}</b> &nbsp;·&nbsp; P&amp;L <span class="${plClass(totalPL)}" style="font-weight:700">${plSign(totalPL)}</span>`;
  const canvas = $("portPortfolioChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, 240);
  grad.addColorStop(0, totalPL >= 0 ? "rgba(88,166,255,.18)" : "rgba(248,81,73,.15)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  if (portPortfolioChartInst) portPortfolioChartInst.destroy();
  portPortfolioChartInst = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [{ label: "Portfolio Value", data: eq, borderColor: lineClr, backgroundColor: grad, fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: "rgba(48,54,61,.5)" }, ticks: { color: "#8b949e", maxTicksLimit: 8, maxRotation: 0 } }, y: { position: "right", grid: { color: "rgba(48,54,61,.5)" }, ticks: { color: "#8b949e", callback: v => "$" + fmt(v, 0) } } } }
  });
}

function portChangePeriod(btn) {
  document.querySelectorAll(".port-period-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  portChartPeriod = btn.dataset.p;
  portChartTimeframe = btn.dataset.tf;
  portLoadPortfolioChart(portChartPeriod, portChartTimeframe);
}

// ── Shared sort helpers ──
function numOrStr(v) { const n = parseFloat(v); return isNaN(n) ? String(v).toLowerCase() : n; }
function applySort(arr, key, dir) {
  if (!key) return [...arr];
  return [...arr].sort((a, b) => {
    const va = numOrStr(a[key] ?? ""), vb = numOrStr(b[key] ?? "");
    if (va < vb) return -dir; if (va > vb) return dir; return 0;
  });
}

// ── Port Overview: Positions ──
function portRenderPositions() {
  const tbody = $("portPositionsBody");
  const data = applySort(portRawPositions, portPosSort.key, portPosSort.dir);
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="placeholder">No open positions</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(p => {
    const unrPL = parseFloat(p.unrealized_pl);
    const unrPct = parseFloat(p.unrealized_plpc);
    const dayPL = parseFloat(p.unrealized_intraday_pl ?? 0);
    const mv = parseFloat(p.market_value);
    const qty = parseFloat(p.qty);
    const isShort = qty < 0;
    const sym = toSlash(p.symbol);
    const current = parseFloat(p.current_price) || 0;
    const orderSym = p.symbol;
    const dirBadge = isShort ? `<span style="font-size:9px;padding:1px 4px;border-radius:3px;background:rgba(248,81,73,.15);color:var(--red);font-weight:700;margin-left:4px">SHORT</span>` : "";
    return `<tr>
      <td><span class="symbol">${tvLink(sym)}</span>${dirBadge}</td>
      <td class="right">${fmt(Math.abs(qty), Math.abs(qty) % 1 === 0 ? 0 : 6)}</td>
      <td class="right mono">${fmtPrice(p.avg_entry_price)}</td>
      <td class="right mono">${fmtPrice(p.current_price)}</td>
      <td class="right mono">$${fmt(Math.abs(mv))}</td>
      <td class="right ${plClass(unrPL)}">${plSign(unrPL)}</td>
      <td class="right ${plClass(unrPct)}">${portPctFmt(unrPct, true)}</td>
      <td class="right ${plClass(dayPL)}">${plSign(dayPL)}</td>
      <td><div class="trade-actions">
        ${isShort
          ? `<button class="trade-close-btn" onclick="openTradeModal('${orderSym}','${sym}','buy','${Math.abs(qty)}',${current})">Buy / Cover</button>`
          : `<button class="trade-action-btn" onclick="openTradeModal('${orderSym}','${sym}','buy','',${current})">Buy</button>
             <button class="trade-close-btn" onclick="openTradeModal('${orderSym}','${sym}','sell','${qty}',${current})">Sell / Close</button>`
        }
      </div></td>
    </tr>`;
  }).join("");
}

function portSortPos(key) {
  if (portPosSort.key === key) portPosSort.dir *= -1; else { portPosSort.key = key; portPosSort.dir = 1; }
  setSortIcons("portPosHead", portPosSort.key, portPosSort.dir);
  portRenderPositions();
}

async function portLoadPositions() {
  const positions = await apiFetch("/v2/positions");
  portRawPositions = positions;
  $("portPosCount").textContent = positions.length;
  portRenderPositions();
}

async function portLoadOverview() {
  $("portErrorBox").style.display = "none";
  try {
    await Promise.all([portLoadAccount(), portLoadPositions(), portLoadPortfolioChart()]);
  } catch (e) {
    $("portErrorBox").style.display = "block";
    $("portErrorBox").textContent = "⚠ " + e.message;
    console.error(e);
  }
}

// ── Port TA engine ──
function portEmaSeries(values, period) {
  if (values.length < period) return [];
  const k = 2.0 / (period + 1);
  let val = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = [val];
  for (let i = period; i < values.length; i++) { val = val*(1-k) + values[i]*k; out.push(val); }
  return out;
}
function portEmaLast(values, period) { const s = portEmaSeries(values, period); return s.length ? s[s.length-1] : null; }
function portSmaN(values, n) { if (values.length < n) return null; return values.slice(-n).reduce((a,b)=>a+b,0)/n; }
function portEmaCrossState(closes, fast, slow) {
  fast = fast || 20; slow = slow || 50;
  if (closes.length < slow+1) return null;
  const f = portEmaLast(closes, fast), s = portEmaLast(closes, slow);
  if (!f||!s) return null;
  if (f > s*1.0005) return "golden";
  if (f < s*0.9995) return "death";
  return "neutral";
}
function portComputeRSI(values, period) {
  period = period || 14;
  if (values.length < period+1) return null;
  let ag=0, al=0;
  for (let i=1; i<=period; i++) { const d=values[i]-values[i-1]; if(d>0) ag+=d; else al-=d; }
  ag/=period; al/=period;
  for (let i=period+1; i<values.length; i++) {
    const d=values[i]-values[i-1];
    ag=(ag*(period-1)+Math.max(d,0))/period;
    al=(al*(period-1)+Math.max(-d,0))/period;
  }
  return al===0 ? (ag>0?100:50) : 100-100/(1+ag/al);
}
function portRsiRising(closes, period, lookback) {
  period = period || 14; lookback = lookback || 3;
  if (closes.length < period+1+lookback) return null;
  const rN=portComputeRSI(closes), rP=portComputeRSI(closes.slice(0,-lookback));
  return (rN!==null&&rP!==null) ? rN>rP : null;
}
function portComputeMACD(values, fast, slow, signal) {
  fast = fast||12; slow = slow||26; signal = signal||9;
  if (values.length < slow+signal) return null;
  const fs=portEmaSeries(values,fast), ss=portEmaSeries(values,slow);
  if (!fs.length||!ss.length) return null;
  const offset=slow-fast;
  const macdLine=fs.slice(offset).map((f,i)=>f-ss[i]);
  const sigLine=portEmaSeries(macdLine, signal);
  if (!sigLine.length) return null;
  const ml=macdLine[macdLine.length-1], sl=sigLine[sigLine.length-1], hist=ml-sl;
  const aligned=macdLine.slice(-sigLine.length);
  const histSeries=aligned.map((m,i)=>m-sigLine[i]);
  const rising=histSeries.length>=2 ? histSeries[histSeries.length-1]>histSeries[histSeries.length-2] : null;
  return {line:ml, signal:sl, hist, rising};
}
function portComputeBB(values, period) {
  period = period || 20;
  if (values.length < period) return null;
  const w=values.slice(-period), mid=w.reduce((a,b)=>a+b,0)/period;
  const sd=Math.sqrt(w.reduce((a,v)=>a+(v-mid)**2,0)/period);
  const upper=mid+2*sd, lower=mid-2*sd, bw=(upper-lower)/mid;
  const pb=upper===lower?0.5:(values[values.length-1]-lower)/(upper-lower);
  return {lower,mid,upper,bw,pb};
}
function portVolumeRatio(volumes, period) {
  period = period || 20;
  if (volumes.length < period+1) return null;
  const avg=volumes.slice(-(period+1),-1).reduce((a,b)=>a+b,0)/period;
  return avg===0?null:volumes[volumes.length-1]/avg;
}
function portConfluenceScore(closes, volumes, closes4h, closesDaily) {
  let score=0; const signals={};
  const cross=portEmaCrossState(closes);
  if (cross==="golden") { score+=1; signals.ema={val:"golden",pts:+1}; }
  else if (cross==="death") { score-=1; signals.ema={val:"death",pts:-1}; }
  else { signals.ema={val:cross||"n/a",pts:0}; }
  const m=portComputeMACD(closes);
  if (m) {
    if (m.hist>0&&m.rising)       { score+=1;   signals.macd={val:"green↑",pts:+1}; }
    else if (m.hist<0&&!m.rising) { score-=1;   signals.macd={val:"red↓",pts:-1}; }
    else if (m.hist>0)            { score+=0.5; signals.macd={val:"green→",pts:+0.5}; }
    else if (m.hist<0)            { score-=0.5; signals.macd={val:"red→",pts:-0.5}; }
    else                           { signals.macd={val:"flat",pts:0}; }
  } else { signals.macd={val:"n/a",pts:0}; }
  const r=portComputeRSI(closes), rRise=portRsiRising(closes);
  if (r!==null) {
    if (r<30)                      { score+=1;   signals.rsi={val:r.toFixed(1)+" OS",pts:+1}; }
    else if (r>70)                 { score-=1;   signals.rsi={val:r.toFixed(1)+" OB",pts:-1}; }
    else if (r>=40&&r<=65&&rRise)  { score+=1;   signals.rsi={val:r.toFixed(1)+"↑",pts:+1}; }
    else if (r<40&&rRise===false)  { score-=0.5; signals.rsi={val:r.toFixed(1)+"↓",pts:-0.5}; }
    else                            { signals.rsi={val:r.toFixed(1),pts:0}; }
  } else { signals.rsi={val:"n/a",pts:0}; }
  const bb=portComputeBB(closes);
  if (bb) {
    if (bb.pb<0.25)      { score+=1;  signals.bb={val:"%b "+bb.pb.toFixed(2)+"↓",pts:+1}; }
    else if (bb.pb>0.75) { score-=1;  signals.bb={val:"%b "+bb.pb.toFixed(2)+"↑",pts:-1}; }
    else                  { signals.bb={val:"%b "+bb.pb.toFixed(2),pts:0}; }
  } else { signals.bb={val:"n/a",pts:0}; }
  const vr=portVolumeRatio(volumes);
  if (vr!==null) {
    if (vr>=1.2)     { score+=1;    signals.vol={val:vr.toFixed(2)+"x",pts:+1}; }
    else if (vr<0.7) { score-=0.5; signals.vol={val:vr.toFixed(2)+"x↓",pts:-0.5}; }
    else              { signals.vol={val:vr.toFixed(2)+"x",pts:0}; }
  } else { signals.vol={val:"n/a",pts:0}; }
  if (closes4h&&closes4h.length>=51) {
    const c4=portEmaCrossState(closes4h);
    if (c4==="golden")     { score+=1; signals.tf4h={val:"golden",pts:+1}; }
    else if (c4==="death") { score-=1; signals.tf4h={val:"death",pts:-1}; }
    else                    { signals.tf4h={val:c4||"n/a",pts:0}; }
  } else { signals.tf4h={val:"n/a",pts:0}; }
  let dailyRegime="n/a";
  if (closesDaily&&closesDaily.length>=50) {
    const ma20=portSmaN(closesDaily,20), ma50=portSmaN(closesDaily,50);
    const last=closesDaily[closesDaily.length-1];
    if (last>ma50&&ma20>ma50) dailyRegime="uptrend";
    else if (last<ma50&&ma20<ma50) dailyRegime="downtrend";
    else dailyRegime="mixed";
  }
  return {score:Math.round(score*10)/10, signals, dailyRegime};
}

async function portFetchBars(symbol, timeframe, limitDays) {
  const start=new Date(Date.now()-limitDays*86400000).toISOString().slice(0,19)+"Z";
  const params=new URLSearchParams({symbols:symbol,timeframe,start,limit:300});
  const data=await portApiFetch("https://data.alpaca.markets/v1beta3/crypto/us/bars?"+params);
  return (data.bars||{})[symbol]||[];
}

// ── Port chip / score / action / regime helpers ──
function portChipFor(val, pts) {
  if (pts>0)       return `<span class="chip chip-green">${val}</span>`;
  if (pts<0)       return `<span class="chip chip-red">${val}</span>`;
  if (val==="n/a") return `<span class="chip chip-muted">${val}</span>`;
  return `<span class="chip chip-yellow">${val}</span>`;
}
function portScoreBar(score) {
  const pips=[];
  const full=Math.min(Math.max(Math.round(score),0),6);
  for(let i=0;i<6;i++) pips.push(`<div class="score-pip${i<full?" on":""}"></div>`);
  return `<div class="score-bar-pips">${pips.join("")}</div>`;
}
function portActionChip(score, dailyRegime) {
  const down = dailyRegime === "downtrend";
  if (!down && score >= SIGNAL_BUY_SCORE)  return `<span class="chip chip-green">BUY ≥3.5</span>`;
  if (!down && score >= SIGNAL_HALF_SCORE)  return `<span class="chip chip-yellow">½ BUY 2.5</span>`;
  if (down && score >= SIGNAL_DOWNTREND_LONG_SCORE)  return `<span class="chip chip-yellow">½ C-Trend ≥4</span>`;
  if (down && score >= SIGNAL_HALF_SCORE)   return `<span class="chip chip-red">Regime Block</span>`;
  if (down && score <= -4)  return `<span class="chip chip-red">SHORT ≤−4</span>`;
  if (score <= -2)          return `<span class="chip chip-red">TA SELL</span>`;
  return `<span class="chip chip-muted">HOLD</span>`;
}
function portRegimeChip(r) {
  if (r==="uptrend")   return `<span class="chip chip-green">uptrend</span>`;
  if (r==="downtrend") return `<span class="chip chip-red">downtrend</span>`;
  if (r==="mixed")     return `<span class="chip chip-yellow">mixed</span>`;
  return `<span class="chip chip-muted">n/a</span>`;
}

// ── Port Dist: sort & render ──
function portSortDistTable(key) {
  if (portDistTableSort.key === key) portDistTableSort.dir *= -1;
  else { portDistTableSort.key = key; portDistTableSort.dir = 1; }
  setSortIcons("portDistTableHead", portDistTableSort.key, portDistTableSort.dir);
  portRenderDistTable();
}
function portRenderDistTable() {
  const equity = portRawDistTable._equity || 0;
  const data = [...portRawDistTable].sort((a, b) => {
    const key = portDistTableSort.key, dir = portDistTableSort.dir;
    let va, vb;
    if (key === "pct") { va = parseFloat(a.market_value) / equity; vb = parseFloat(b.market_value) / equity; }
    else { va = numOrStr(a[key]); vb = numOrStr(b[key]); }
    if (va < vb) return -dir; if (va > vb) return dir; return 0;
  });
  $("portDistTableBody").innerHTML = !data.length
    ? `<tr><td colspan="8" class="placeholder">No open positions</td></tr>`
    : data.map(p => {
        const mv = parseFloat(p.market_value), pctV = equity ? mv / equity * 100 : 0;
        const qty = parseFloat(p.qty), entry = parseFloat(p.avg_entry_price);
        const cur = parseFloat(p.current_price);
        const unrPL = parseFloat(p.unrealized_pl), unrPct = parseFloat(p.unrealized_plpc);
        return `<tr>
          <td><span class="symbol">${tvLink(toSlash(p.symbol))}</span></td>
          <td class="right mono">$${fmt(mv)}</td>
          <td class="right" style="font-weight:700">${fmt(pctV, 1)}%</td>
          <td class="right">${fmt(qty, qty % 1 === 0 ? 0 : 6)}</td>
          <td class="right mono">${fmtPrice(entry)}</td>
          <td class="right mono">${fmtPrice(cur)}</td>
          <td class="right ${plClass(unrPL)}">${plSign(unrPL)}</td>
          <td class="right ${plClass(unrPct)}">${portPctFmt(unrPct, true)}</td>
        </tr>`;
    }).join("");
}
function portSortDistCap(key) {
  if (portDistCapSort.key === key) portDistCapSort.dir *= -1;
  else { portDistCapSort.key = key; portDistCapSort.dir = 1; }
  setSortIcons("portDistCapHead", portDistCapSort.key, portDistCapSort.dir);
  portRenderDistCap();
}
function portRenderDistCap() {
  const data = [...portRawDistCapData].sort((a, b) => {
    const key = portDistCapSort.key, dir = portDistCapSort.dir;
    let va, vb;
    if (key === "sym")       { va = a.sym.toLowerCase(); vb = b.sym.toLowerCase(); }
    else if (key === "curPct")   { va = a.curPct; vb = b.curPct; }
    else if (key === "capPct")   { va = a.capPct; vb = b.capPct; }
    else if (key === "headroom") { va = a.headroom; vb = b.headroom; }
    else { va = numOrStr(a[key]); vb = numOrStr(b[key]); }
    if (va < vb) return -dir; if (va > vb) return dir; return 0;
  });
  $("portDistCapBody").innerHTML = data.map(item => {
    const { sym, curPct, capPct, headroom, utilPct, isOver, hasPos } = item;
    const barFill = isOver ? `background:var(--red);width:100%` : `background:var(--green);width:${Math.min(utilPct, 100).toFixed(1)}%`;
    const badge = !hasPos
      ? `<span style="color:var(--muted);font-size:12px">No position</span>`
      : isOver
        ? `<span class="port-status-badge" style="background:rgba(248,81,73,.15);color:var(--red)">⚠ Over Cap</span>`
        : utilPct >= 80
          ? `<span class="port-status-badge" style="background:rgba(210,153,34,.15);color:var(--yellow)">Near Cap</span>`
          : `<span class="port-status-badge" style="background:rgba(63,185,80,.15);color:var(--green)">OK</span>`;
    return `<tr>
      <td><span class="symbol">${tvLink(sym)}</span></td>
      <td class="right" style="font-weight:${hasPos ? 700 : 400};color:${!hasPos ? "var(--muted)" : "var(--text)"}">${hasPos ? fmt(curPct, 1) + "%" : "–"}</td>
      <td class="right">${fmt(capPct, 0)}%</td>
      <td class="right ${headroom < 1 && hasPos ? "neg" : ""}">${hasPos ? fmt(headroom, 1) + "%" : fmt(capPct, 0) + "%"}</td>
      <td>
        <div style="height:8px;border-radius:4px;background:var(--surface2);overflow:hidden;position:relative">
          <div style="height:100%;border-radius:4px;position:absolute;top:0;left:0;${barFill}"></div>
        </div>
        ${hasPos ? `<div style="font-size:10px;color:var(--muted);margin-top:2px">${utilPct.toFixed(0)}% of cap used</div>` : ""}
      </td>
      <td>${badge}</td>
    </tr>`;
  }).join("");
}

async function portLoadDist() {
  $("portDistErrorBox").style.display = "none";
  try {
    const [acct, positions] = await Promise.all([
      apiFetch("/v2/account"),
      apiFetch("/v2/positions"),
    ]);
    const equity = parseFloat(acct.equity);
    const cash = parseFloat(acct.cash);
    const invested = positions.reduce((s, p) => s + parseFloat(p.market_value || 0), 0);
    const cashPct = equity ? (cash / equity * 100) : 0;
    const invPct = equity ? (invested / equity * 100) : 0;
    $("portDistEquity").textContent = "$" + fmt(equity);
    $("portDistInvested").textContent = "$" + fmt(invested);
    $("portDistInvestedPct").textContent = fmt(invPct, 1) + "% of equity";
    $("portDistCash").textContent = "$" + fmt(cash);
    $("portDistCashPct").textContent = fmt(cashPct, 1) + "% of equity";
    $("portDistPosCount").textContent = positions.length;
    $("portDistCenterVal").textContent = "$" + fmt(equity, 0);
    let largest = null;
    positions.forEach(p => {
      const mv = parseFloat(p.market_value);
      if (!largest || mv > parseFloat(largest.market_value)) largest = p;
    });
    if (largest) {
      $("portDistLargest").textContent = toSlash(largest.symbol);
      $("portDistLargestPct").textContent = fmt(parseFloat(largest.market_value) / equity * 100, 1) + "% of equity";
    } else {
      $("portDistLargest").textContent = "–";
      $("portDistLargestPct").textContent = "";
    }
    const sorted = [...positions].sort((a, b) => parseFloat(b.market_value) - parseFloat(a.market_value));
    const chartLabels = [...sorted.map(p => toSlash(p.symbol)), "Cash"];
    const chartValues = [...sorted.map(p => parseFloat(p.market_value)), cash];
    const chartColors = sorted.map((_, i) => DIST_COLORS[i % (DIST_COLORS.length - 1)]);
    chartColors.push(DIST_COLORS[DIST_COLORS.length - 1]);
    if (portDistChartInst) portDistChartInst.destroy();
    const ctx = $("portDistChart").getContext("2d");
    portDistChartInst = new Chart(ctx, {
      type: "doughnut",
      data: { labels: chartLabels, datasets: [{ data: chartValues, backgroundColor: chartColors, borderColor: "#0d1117", borderWidth: 3, hoverOffset: 8 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: "68%", plugins: { legend: { display: false }, tooltip: { backgroundColor: "#1c2333", borderColor: "#30363d", borderWidth: 1, titleColor: "#e6edf3", bodyColor: "#8b949e", callbacks: { label: ctx => `  $${fmt(ctx.parsed)}  (${equity ? (ctx.parsed / equity * 100).toFixed(1) : 0}%)` } } } }
    });
    $("portDistLegend").innerHTML = chartLabels.map((lbl, i) => {
      const pctV = equity ? (chartValues[i] / equity * 100).toFixed(1) : "0";
      return `<div style="display:flex;align-items:center;gap:8px;font-size:12px;">
        <div style="width:10px;height:10px;border-radius:2px;background:${chartColors[i]};flex-shrink:0"></div>
        <span style="color:var(--muted);flex:1">${lbl}</span>
        <span style="font-weight:600">${pctV}%</span>
        <span style="color:var(--muted);min-width:72px;text-align:right">$${fmt(chartValues[i], 0)}</span>
      </div>`;
    }).join("");
    portRawDistTable = sorted;
    portRawDistTable._equity = equity;
    setSortIcons("portDistTableHead", portDistTableSort.key, portDistTableSort.dir);
    portRenderDistTable();
    const allSyms = Array.from(new Set([...getPortCryptoWL(), ...sorted.map(p => toSlash(p.symbol))]));
    const posMap = {};
    sorted.forEach(p => { posMap[toSlash(p.symbol)] = p; });
    portRawDistCapData = allSyms.map(sym => {
      const p = posMap[sym];
      const mv = p ? parseFloat(p.market_value) : 0;
      const curPct = equity ? mv / equity * 100 : 0;
      const capPct = portCapFor(sym);
      const headroom = Math.max(capPct - curPct, 0);
      // True (un-clamped) utilisation so the displayed % matches the badge — a
      // position fractionally over cap used to read "100% of cap used" (clamped)
      // yet show "Over Cap", which looked contradictory. "Over Cap" now fires
      // only when the rounded utilisation actually exceeds 100%.
      const utilPct = capPct ? curPct / capPct * 100 : 0;
      const isOver = Math.round(utilPct) > 100;
      const hasPos = !!p;
      return { sym, curPct, capPct, headroom, utilPct, isOver, hasPos };
    });
    setSortIcons("portDistCapHead", portDistCapSort.key, portDistCapSort.dir);
    portRenderDistCap();
  } catch (e) {
    $("portDistErrorBox").style.display = "block";
    $("portDistErrorBox").textContent = "⚠ " + e.message;
    console.error(e);
  }
}

// ── Port sort-icon helper ──
function setSortIcons(headId, activeKey, dir) {
  document.querySelectorAll("#" + headId + " th[data-key]").forEach(th => {
    const icon = th.querySelector(".sort-icon");
    if (!icon) return;
    const isActive = th.dataset.key === activeKey;
    th.classList.toggle("port-sorted", isActive);
    icon.textContent = isActive ? (dir === 1 ? "↑" : "↓") : "⇅";
  });
}

// ── Port init ──
setSortIcons("portDistTableHead", portDistTableSort.key, portDistTableSort.dir);
setSortIcons("portDistCapHead", portDistCapSort.key, portDistCapSort.dir);
setInterval(function() {
  if (activeTab === "port-overview") portLoadOverview();
  else if (activeTab === "port-dist") portLoadDist();
}, 60000);

