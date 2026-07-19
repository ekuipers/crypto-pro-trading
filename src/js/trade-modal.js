
    function openTradeModal(orderSymbol, displaySymbol, side, qty, currentPrice) {
      const settings = getSettings();

      $("tradeSymbol").value = orderSymbol;
      $("tradeSide").value = side || "buy";
      $("tradeQty").value = qty || "";
      $("tradeLimitPrice").value = currentPrice || "";
      $("tradeModalSymbol").textContent = displaySymbol || orderSymbol;

      // R:R preview (roadmap item 8) — pre-filled from the last Signals scan
      // (4H swing-low stop vs BB-upper target). Display-only decision aid.
      const rrEl = $("tradeRrInfo");
      if (rrEl) {
        const rr = _signalRrMap[displaySymbol] || _signalRrMap[toSlash(orderSymbol)] || null;
        if (rr && rr.stop) {
          const stopStr = "$" + fmt(rr.stop, rr.stop < 1 ? 6 : 2);
          const tgtStr  = rr.target ? "$" + fmt(rr.target, rr.target < 1 ? 6 : 2) : "–";
          const rrStr   = rr.rr != null
            ? `<b style="color:${rr.rr >= STRAT_CFG.minRrFull ? "var(--green)" : rr.rr >= STRAT_CFG.minRrHalf ? "var(--yellow)" : "var(--red)"}">1:${fmt(rr.rr, 1)} net</b>${rr.grossRr != null ? ` <span style="color:var(--muted)">(1:${fmt(rr.grossRr, 1)} gross)</span>` : ""}`
            : '<span style="color:var(--muted)">n/a (price at/above BB-upper target)</span>';
          rrEl.style.display = "block";
          rrEl.innerHTML = `<b>Net R:R preview</b> (last Signals scan) — stop: 4H swing low ${stopStr} (−${fmt(rr.stopDistPct, 1)}%) · target: BB upper ${tgtStr} · round-trip cost ≈ ${fmt(rr.costPct != null ? rr.costPct : roundTripCostPct(null), 2)}% (2×${STRAT_CFG.feeBpsPerSide}bps fee + spread) · R:R ${rrStr}. Soft gate: &lt;${STRAT_CFG.minRrHalf} block · &lt;${STRAT_CFG.minRrFull} half-size.`;
        } else {
          rrEl.style.display = "none";
          rrEl.innerHTML = "";
        }
      }

      const warning = $("tradeModeWarning");

      if (settings.mode === "live") {
        warning.className = "trade-danger";
        warning.textContent = "Live mode is selected. This dashboard blocks live order execution. Switch to paper mode to submit a test order.";
      } else {
        warning.className = "trade-warning";
        warning.textContent = "Paper mode is active. This will submit a paper limit order to Alpaca.";
      }

      updateTradeSummary();
      $("tradeModalBackdrop").style.display = "flex";
    }


    function executeSignalTrade(orderSymbol, displaySymbol, side, qty, limitPrice) {
      const settings = getSettings();

      if (settings.mode === "live") {
        alert("Live order execution is blocked by this dashboard. Switch to Paper Trading mode to submit a test order.");
        return;
      }

      $("tradeSymbol").value = orderSymbol;
      $("tradeSide").value = side || "buy";
      $("tradeQty").value = qty || "";
      $("tradeLimitPrice").value = limitPrice || "";

      updateTradeSummary();
      submitPaperTrade();
    }
    function closeTradeModal() {
      $("tradeModalBackdrop").style.display = "none";
    }

    // Portfolio-cap projection for the manual trade ticket (Bug filed
    // 2026-07-18: the dialog let a user enter a qty that pushed a position
    // over its config.json/PORTFOLIO_CAPS limit, which then tripped the
    // Command tab's "STOP" trading-permission indicator after the fact.
    // scripts/trade.py enforces this hard rule in code for automated
    // orders — this mirrors that check client-side, before submission,
    // using the same PORTFOLIO_CAPS table and portCapFor().
    function tradeCapProjection(symbol, side, qty, price) {
      const equity = Number(window._lastEquity || 0);
      if (!equity || !qty || !price) return null;
      const slashSym = toSlash(symbol);
      const positions = window._lastPositions || [];
      const existing = positions.find(p => toSlash(p.symbol) === slashSym);
      const existingQty = existing ? Math.abs(Number(existing.qty || 0)) : 0;
      const existingPx  = existing ? Number(existing.current_price || existing.avg_entry_price || price) : price;
      const existingNotional = existingQty * existingPx;
      const orderNotional = qty * price;
      const projectedNotional = side === "buy"
        ? existingNotional + orderNotional
        : Math.max(0, existingNotional - orderNotional);
      const capPct = portCapFor(slashSym);
      const capNotional = equity * capPct / 100;
      return {
        equity, capPct, capNotional, existingNotional, orderNotional, projectedNotional,
        overCap: projectedNotional > capNotional * 1.0001,
        maxAdditionalNotional: Math.max(0, capNotional - existingNotional)
      };
    }

    function updateTradeSummary() {
      const qty = Number($("tradeQty").value || 0);
      const price = Number($("tradeLimitPrice").value || 0);
      const side = $("tradeSide").value;
      const symbol = $("tradeSymbol").value;
      const notional = qty * price;

      $("tradeSummary").innerHTML = `
        <b>Draft order:</b> ${side.toUpperCase()} ${qty || "—"} ${toSlash(symbol) || "—"}
        at ${price ? "$" + fmt(price, price < 1 ? 6 : 2) : "—"} limit.
        <br>
        <b>Estimated notional:</b> ${notional ? "$" + fmt(notional, 2) : "—"}.
      `;

      const capEl = $("tradeCapWarning");
      if (capEl) {
        const proj = side === "buy" ? tradeCapProjection(symbol, side, qty, price) : null;
        if (proj) {
          const projPct = proj.equity ? proj.projectedNotional / proj.equity * 100 : 0;
          if (proj.overCap) {
            capEl.style.display = "block";
            capEl.style.borderColor = "var(--red)";
            capEl.style.color = "var(--red)";
            capEl.innerHTML = `⚠ <b>Over portfolio cap:</b> ${toSlash(symbol)}'s cap is ${fmt(proj.capPct,1)}% of equity ($${fmt(proj.capNotional)}). ` +
              `This order would bring the position to $${fmt(proj.projectedNotional)} (${fmt(projPct,1)}% of equity). ` +
              `Max additional notional at this price: $${fmt(proj.maxAdditionalNotional)} (≈ ${fmt(proj.maxAdditionalNotional / price, 6)} qty).`;
          } else {
            capEl.style.display = "block";
            capEl.style.borderColor = "var(--border)";
            capEl.style.color = "";
            capEl.innerHTML = `Cap check: ${toSlash(symbol)} would be $${fmt(proj.projectedNotional)} (${fmt(projPct,1)}% of equity) vs. a ${fmt(proj.capPct,1)}% cap ($${fmt(proj.capNotional)}). OK.`;
          }
        } else {
          capEl.style.display = "none";
          capEl.innerHTML = "";
        }
      }
    }


    function calcSizer() {
      const equity = Number(document.getElementById("sizerEquity")?.value || 0);
      const atr    = Number(document.getElementById("sizerAtr")?.value || 0);
      const ask    = Number(document.getElementById("sizerAsk")?.value || 0);
      const capPct = Number(document.getElementById("sizerCap")?.value || 5);
      const out    = document.getElementById("sizerResult");
      if (!out) return;

      if (!equity || !atr || !ask) {
        out.textContent = "Enter equity, ATR and ask to calculate suggested quantity.";
        return;
      }

      const maxRisk   = equity * 0.01;
      const stopDist  = atr * 1.5;
      const rawQty    = maxRisk / stopDist;
      const capQty    = (equity * capPct / 100) / ask;
      const finalQty  = Math.min(rawQty, capQty);
      const notional  = finalQty * ask;
      const stopPrice = ask - stopDist;

      out.innerHTML = `
        <b>Max risk:</b> $${fmt(maxRisk)} &nbsp;|&nbsp;
        <b>Stop dist:</b> $${fmt(stopDist, ask < 1 ? 6 : 2)} &nbsp;|&nbsp;
        <b>Raw qty:</b> ${fmt(rawQty, 6)}<br>
        <b>Cap limit qty:</b> ${fmt(capQty, 6)} &nbsp;|&nbsp;
        <b>Suggested qty:</b> <span style="color:var(--green);font-weight:900">${fmt(finalQty, 6)}</span> &nbsp;|&nbsp;
        <b>Notional:</b> $${fmt(notional)}<br>
        <b>Stop price:</b> $${fmt(stopPrice, ask < 1 ? 6 : 2)} &nbsp;|&nbsp;
        <b>R:R (to +10%):</b> ${fmt((ask * 0.10) / stopDist, 2)}
      `;

      const qtyInput = document.getElementById("tradeQty");
      const priceInput = document.getElementById("tradeLimitPrice");
      if (qtyInput && !qtyInput.value) qtyInput.value = fmt(finalQty, 6).replace(/,/g,"");
      if (priceInput && !priceInput.value && ask) priceInput.value = ask;
      updateTradeSummary();
    }

    async function submitPaperTrade() {
      const settings = getSettings();

      if (settings.mode === "live") {
        alert("Live order execution is blocked by this dashboard. Switch to Paper Trading mode to submit a test order.");
        return;
      }

      const symbol = $("tradeSymbol").value;
      const side = $("tradeSide").value;
      const qty = Number($("tradeQty").value);
      const limitPrice = Number($("tradeLimitPrice").value);
      const tif = $("tradeTif").value;

      if (!symbol) {
        alert("Missing symbol.");
        return;
      }

      if (!qty || qty <= 0) {
        alert("Enter a valid quantity.");
        return;
      }

      if (!limitPrice || limitPrice <= 0) {
        alert("Enter a valid limit price.");
        return;
      }

      if (side === "buy") {
        const proj = tradeCapProjection(symbol, side, qty, limitPrice);
        if (proj && proj.overCap) {
          alert(
            "Blocked: this order exceeds " + toSlash(symbol) + "'s portfolio cap.\n\n" +
            "Cap: " + fmt(proj.capPct, 1) + "% of equity ($" + fmt(proj.capNotional) + ")\n" +
            "Existing position: $" + fmt(proj.existingNotional) + "\n" +
            "This order would bring it to: $" + fmt(proj.projectedNotional) + "\n\n" +
            "Max additional notional at this price: $" + fmt(proj.maxAdditionalNotional) +
            " (≈ " + fmt(proj.maxAdditionalNotional / limitPrice, 6) + " qty)."
          );
          return;
        }
      }

      const estimatedNotional = qty * limitPrice;

      const confirmed = confirm(
        "Submit PAPER limit order?\n\n" +
        side.toUpperCase() + " " + qty + " " + toSlash(symbol) + "\n" +
        "Limit: $" + limitPrice + "\n" +
        "Estimated notional: $" + estimatedNotional.toFixed(2)
      );

      if (!confirmed) return;

      try {
        const payload = {
          symbol: symbol,
          qty: String(qty),
          side: side,
          type: "limit",
          time_in_force: tif,
          limit_price: String(limitPrice)
        };

        const result = await apiPost("/v2/orders", payload);

        alert("Paper order submitted successfully: " + (result.id || "order accepted"));
        closeTradeModal();
        loadDashboard();
      } catch (err) {
        alert(err.message);
        console.error(err);
      }
    }

    document.addEventListener("input", e => {
      if (["tradeQty","tradeLimitPrice","tradeSide","tradeTif"].includes(e.target.id)) {
        updateTradeSummary();
      }
    });
