
    // ===================== Markov Chain Analysis =====================
    // Classifies each daily close-to-close return into one of three states
    // (Up / Flat / Down) using a ±MK_THRESH band, then builds a first-order
    // transition matrix P(next state | current state), its stationary
    // distribution (via power iteration), and a one-step-ahead forecast from
    // the current (most recent) state.
    const MK_SYMBOLS   = ["BTC/USD", "ETH/USD"];
    const MK_INTERVALS = [30, 60, 90, 180, 365];
    const MK_THRESH    = 0.01;                 // ±1% daily-return band
    const MK_STATES    = ["Up", "Flat", "Down"];

    function mkClassify(ret) {
      if (ret >  MK_THRESH) return 0;          // Up
      if (ret < -MK_THRESH) return 2;          // Down
      return 1;                                // Flat
    }

    // closes: ascending daily closes. windowDays: number of trailing returns to use.
    function mkBuild(closes, windowDays) {
      const rets = [];
      for (let i = 1; i < closes.length; i++) rets.push(closes[i] / closes[i - 1] - 1);
      const used   = rets.slice(-windowDays);
      const states = used.map(mkClassify);

      const counts = [[0,0,0],[0,0,0],[0,0,0]];
      for (let i = 1; i < states.length; i++) counts[states[i-1]][states[i]]++;
      const rowSums = counts.map(r => r[0] + r[1] + r[2]);
      const P = counts.map((r, i) => rowSums[i] ? r.map(c => c / rowSums[i]) : [0,0,0]);

      // Stationary distribution via power iteration on P.
      let pi = [1/3, 1/3, 1/3];
      for (let k = 0; k < 500; k++) {
        const next = [0,0,0];
        for (let i = 0; i < 3; i++)
          for (let j = 0; j < 3; j++)
            next[j] += pi[i] * (rowSums[i] ? P[i][j] : (i === j ? 1 : 0));
        const s = next[0] + next[1] + next[2];
        if (s > 0) for (let j = 0; j < 3; j++) next[j] /= s;
        pi = next;
      }

      const currentState = states.length ? states[states.length - 1] : 1;
      const nextDist = rowSums[currentState] ? P[currentState] : pi.slice();
      const meanRet  = used.length ? used.reduce((a,b) => a + b, 0) / used.length : 0;
      const freq = [0,0,0];
      states.forEach(st => freq[st]++);
      const freqPct = freq.map(f => states.length ? f / states.length : 0);

      return { P, counts, rowSums, pi, currentState, nextDist, meanRet, n: states.length, freqPct };
    }

    function mkCell(p, stateIdx) {
      const colors = ["63,185,80", "139,148,158", "248,81,73"]; // green / muted / red
      const a = (0.10 + 0.55 * p).toFixed(2);
      return `<td class="right" style="background:rgba(${colors[stateIdx]},${a})">${(p*100).toFixed(0)}%</td>`;
    }

    function mkMatrixTable(m) {
      let rows = "";
      for (let i = 0; i < 3; i++) {
        let cells = "";
        for (let j = 0; j < 3; j++) cells += mkCell(m.P[i][j], j);
        rows += `<tr><td>${MK_STATES[i]}</td>${cells}<td class="right small">${m.rowSums[i]}</td></tr>`;
      }
      return `<table class="mk-matrix" style="width:100%;font-size:12px"><thead><tr>
          <th style="text-align:left">from \\ to</th>
          <th class="right">Up</th><th class="right">Flat</th><th class="right">Down</th><th class="right">n</th>
        </tr></thead><tbody>${rows}</tbody></table>`;
    }

    function mkIntervalCard(days, m) {
      if (!m || m.n < 3) {
        return `<div class="panel"><div class="panel-title">${days}-Day Window</div>
          <div class="small" style="color:var(--muted)">Insufficient data (${m ? m.n : 0} transitions).</div></div>`;
      }
      const nd = m.nextDist;
      const fcIdx = nd.indexOf(Math.max(...nd));
      const fc = MK_STATES[fcIdx];
      const fcColor = fcIdx === 0 ? "var(--green)" : fcIdx === 2 ? "var(--red)" : "var(--muted)";
      return `
        <div class="panel">
          <div class="panel-title">${days}-Day Window · ${m.n} transitions</div>
          ${mkMatrixTable(m)}
          <div class="small" style="margin-top:9px;line-height:1.8">
            Current state: <b>${MK_STATES[m.currentState]}</b><br>
            Next-day forecast: <b style="color:${fcColor}">${fc}</b>
            <span style="color:var(--muted)">(↑${(nd[0]*100).toFixed(0)}% · →${(nd[1]*100).toFixed(0)}% · ↓${(nd[2]*100).toFixed(0)}%)</span><br>
            Stationary: <span style="color:var(--muted)">↑${(m.pi[0]*100).toFixed(0)}% · →${(m.pi[1]*100).toFixed(0)}% · ↓${(m.pi[2]*100).toFixed(0)}%</span><br>
            Mean daily return: <b style="color:${m.meanRet >= 0 ? 'var(--green)' : 'var(--red)'}">${(m.meanRet*100).toFixed(2)}%</b>
          </div>
        </div>`;
    }

    async function loadMarkov() {
      const s = getSettings();
      $("mkThreshLabel").textContent = (MK_THRESH * 100).toFixed(1);
      if (!s.apiKey || !s.apiSecret) {
        $("markovContent").innerHTML = '<div class="placeholder">Configure API credentials in Settings first.</div>';
        return;
      }
      $("markovContent").innerHTML = '<div class="placeholder">Fetching daily bars…</div>';
      $("markovKpis").innerHTML = kpi("Status", "Computing…", "Fetching daily bars from Alpaca");

      const maxDays = Math.max(...MK_INTERVALS);
      const bars = await fetchBars(MK_SYMBOLS, "1Day", maxDays + 5);
      if (!bars) {
        $("markovContent").innerHTML = '<div class="placeholder">Failed to fetch bars. Check API keys / network.</div>';
        $("markovKpis").innerHTML = "";
        return;
      }

      let html = "";
      const kpis = [];
      for (const sym of MK_SYMBOLS) {
        const symBars = bars[sym] || [];
        const closes  = symBars.map(b => b.c).filter(c => typeof c === "number");
        const models  = {};
        MK_INTERVALS.forEach(d => models[d] = mkBuild(closes, d));

        const m90 = models[90];
        if (m90 && m90.n >= 3) {
          const up = m90.nextDist[0] * 100;
          kpis.push(kpi(sym + " next-day ↑ (90d)", up.toFixed(0) + "%",
            "from " + MK_STATES[m90.currentState] + " state", up >= 50 ? "good" : ""));
        }

        let cards = "";
        MK_INTERVALS.forEach(d => cards += mkIntervalCard(d, models[d]));
        html += `<div class="section-title" style="margin-top:18px">${tvLink(sym)} <span class="small" style="color:var(--muted)">— ${closes.length} daily bars</span></div>
          <div class="grid-3">${cards}</div>`;
      }

      $("markovKpis").innerHTML = kpis.join("");
      $("markovContent").innerHTML = html;
      $("markovLastUpdated").textContent = "Last updated: " + new Date().toLocaleString();
    }

    // Shared 6-point Score Distribution tile — used by both the Signals tab
    // (#scoreDist) and the Market → Scanner sub-tab (#msScoreDist) so the two
    // render identically. Buckets match the score-pill thresholds (≥4 BUY,
    // 3–3.9 HALF, 0.5–2.9 / −2.9–0 HOLD, ≤−3 BEAR) and handle fractional scores.
    function renderScoreDist(elId, scores) {
      const el = document.getElementById(elId);
      if (!el) return;
      const dist = {"-6to-3": 0, "-2to0": 0, "1to3": 0, "3": 0, "4plus": 0};
      scores.forEach(s => {
        if (s <= -3) dist["-6to-3"]++;
        else if (s <= 0) dist["-2to0"]++;
        else if (s < SIGNAL_HALF_SCORE) dist["1to3"]++;          // below 2.5 = HOLD
        else if (s < SIGNAL_BUY_SCORE) dist["3"]++;              // 2.5–3.49 = half-size
        else dist["4plus"]++;                                    // ≥ 3.5 = full BUY
      });
      const total = scores.length || 1;
      el.innerHTML = `
        <div style="display:grid;gap:6px;margin-top:8px">
          ${[
            ["≥ 3.5 (BUY)", dist["4plus"], "#3fb950"],
            ["2.5–3.4 (HALF)", dist["3"], "#d29922"],
            ["0.5–2.4 (HOLD)", dist["1to3"], "#58a6ff"],
            ["−2.9–0 (HOLD)", dist["-2to0"], "#8b949e"],
            ["≤ −3 (BEAR)", dist["-6to-3"], "#f85149"]
          ].map(([label, count, color]) => `
            <div style="display:flex;align-items:center;gap:8px">
              <span style="width:90px;font-size:11px;color:var(--muted)">${label}</span>
              <span style="flex:1;height:8px;background:rgba(255,255,255,.08);border-radius:4px">
                <span style="display:block;height:100%;width:${count/total*100}%;background:${color};border-radius:4px"></span>
              </span>
              <span style="font-size:11px;width:16px;text-align:right">${count}</span>
            </div>
          `).join("")}
        </div>
      `;
    }
