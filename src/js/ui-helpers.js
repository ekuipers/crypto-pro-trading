
    function parseCellValue(text) {
      if (!text) return "";

      const cleaned = text
        .replace(/[$,%]/g, "")
        .replace(/[+]/g, "")
        .replace(/,/g, "")
        .trim();

      const n = Number(cleaned);
      if (!isNaN(n) && cleaned !== "") return n;

      const date = Date.parse(text);
      if (!isNaN(date) && /\d/.test(text)) return date;

      return text.toLowerCase();
    }

    function enhanceTables() {
      document.querySelectorAll("table").forEach(table => {
        const headers = table.querySelectorAll("thead th");

        headers.forEach((th, index) => {
          if (th.dataset.sortReady === "1") return;
          th.dataset.sortReady = "1";

          th.addEventListener("click", () => {
            sortTable(table, index, th);
          });
        });
      });
    }

    function sortTable(table, columnIndex, th) {
      const tbody = table.querySelector("tbody");
      if (!tbody) return;

      const rows = Array.from(tbody.querySelectorAll("tr"));
      if (!rows.length) return;

      const direction = th.dataset.sortDirection === "asc" ? "desc" : "asc";
      th.dataset.sortDirection = direction;

      rows.sort((a, b) => {
        const av = parseCellValue((a.children[columnIndex] || {}).textContent || "");
        const bv = parseCellValue((b.children[columnIndex] || {}).textContent || "");

        if (av < bv) return direction === "asc" ? -1 : 1;
        if (av > bv) return direction === "asc" ? 1 : -1;
        return 0;
      });

      tbody.innerHTML = "";
      rows.forEach(row => tbody.appendChild(row));

      table.querySelectorAll("th").forEach(header => {
        header.classList.remove("sorted");
        const s = header.querySelector(".sort");
        if (s) s.textContent = "⇅";
      });

      th.classList.add("sorted");
      const indicator = th.querySelector(".sort");
      if (indicator) indicator.textContent = direction === "asc" ? "↑" : "↓";
    }

    const tooltip = $("tooltip");
    let tooltipTarget = null;

    document.addEventListener("mouseover", e => {
      const el = e.target.closest("[data-tip]");
      if (!el) return;

      tooltipTarget = el;
      tooltip.textContent = el.dataset.tip;
      tooltip.style.opacity = "1";
      tooltip.style.transform = "translateY(0)";
      positionTooltip(e);
    });

    document.addEventListener("mousemove", e => {
      if (!tooltipTarget) return;
      positionTooltip(e);
    });

    document.addEventListener("mouseout", e => {
      const el = e.target.closest("[data-tip]");
      if (!el) return;

      tooltipTarget = null;
      tooltip.style.opacity = "0";
      tooltip.style.transform = "translateY(4px)";
    });

    function positionTooltip(e) {
      const pad = 14;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      tooltip.style.left = "0px";
      tooltip.style.top = "0px";

      const tw = tooltip.offsetWidth;
      const th = tooltip.offsetHeight;

      let left = e.clientX + pad;
      let top = e.clientY + pad;

      if (left + tw > vw - 10) left = e.clientX - tw - pad;
      if (top + th > vh - 10) top = e.clientY - th - pad;

      tooltip.style.left = Math.max(8, left) + "px";
      tooltip.style.top = Math.max(8, top) + "px";
    }

