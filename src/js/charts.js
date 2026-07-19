
    function renderEquityChart(c) {
      const ctx = $("equityChart");
      if (!ctx || typeof Chart === "undefined") return;

      if (equityChart) equityChart.destroy();

      const labels = c.timestamps.map(t => {
        const d = new Date(t * 1000);
        return d.toLocaleDateString([], { month:"short", day:"numeric" });
      });

      equityChart = new Chart(ctx, {
        type:"line",
        data:{
          labels,
          datasets:[{
            data:c.equitySeries,
            borderColor:"#58a6ff",
            backgroundColor:"rgba(88,166,255,.12)",
            fill:true,
            tension:.25,
            pointRadius:0,
            borderWidth:2
          }]
        },
        options:chartOptions(v => "$" + fmt(v,0))
      });
    }

    function renderReturnsChart(c) {
      const ctx = $("returnsChart");
      if (!ctx || typeof Chart === "undefined") return;

      if (returnsChart) returnsChart.destroy();

      const data = c.returns.map(r => r * 100);

      returnsChart = new Chart(ctx, {
        type:"bar",
        data:{
          labels:data.map((_,i) => String(i + 1)),
          datasets:[{
            data,
            backgroundColor:data.map(v => v >= 0 ? "#3fb950" : "#f85149"),
            borderWidth:0
          }]
        },
        options:chartOptions(v => fmt(v,2) + "%", false)
      });
    }

    function renderDrawdownChart(c) {
      const ctx = $("drawdownChart");
      if (!ctx || typeof Chart === "undefined") return;

      if (drawdownChart) drawdownChart.destroy();

      drawdownChart = new Chart(ctx, {
        type:"line",
        data:{
          labels:c.dd.series.map((_,i) => String(i + 1)),
          datasets:[{
            data:c.dd.series,
            borderColor:"#f85149",
            backgroundColor:"rgba(248,81,73,.12)",
            fill:true,
            tension:.25,
            pointRadius:0,
            borderWidth:2
          }]
        },
        options:chartOptions(v => fmt(v,2) + "%")
      });
    }

    function chartOptions(tickCallback, line = true) {
      return {
        responsive:true,
        maintainAspectRatio:false,
        plugins:{
          legend:{ display:false },
          tooltip:{
            backgroundColor:"#1c2333",
            borderColor:"#30363d",
            borderWidth:1,
            titleColor:"#8b949e",
            bodyColor:"#e6edf3"
          }
        },
        scales:{
          x:{
            grid:{ color: line ? "rgba(48,54,61,.45)" : "transparent" },
            ticks:{ color:"#8b949e", maxTicksLimit:8, font:{ size:11 } }
          },
          y:{
            position:"right",
            grid:{ color:"rgba(48,54,61,.45)" },
            ticks:{
              color:"#8b949e",
              font:{ size:11 },
              callback:tickCallback
            }
          }
        }
      };
    }
