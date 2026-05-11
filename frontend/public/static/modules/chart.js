// Ref: [[state.js]] [[formatters.js]] [[portfolio.js]] [[app.js]] [[PROJECT_MAP.md]]
import { state, authedFetch } from "./state.js";
import { formatCurrency, escapeHtml } from "./formatters.js";

// ─── Heartrate chart ──────────────────────────────────────────────────────────
export async function loadHeartrate(period) {
  if (!state.currentPortfolioId) return;
  state.currentPeriod = period;

  document.querySelectorAll(".period-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.period === period);
  });

  const chartEmptyEl     = document.getElementById("chartEmpty");
  const portfolioChartEl = document.getElementById("portfolioChart");
  const heartrateChange  = document.getElementById("heartrateChange");

  try {
    const fetchBenchmark = state.benchmarkEnabled
      ? fetch(`/api/market/benchmark?symbol=SPY&period=${period}`).then((r) => r.ok ? r.json() : null).catch(() => null)
      : Promise.resolve(null);

    const [resp, benchData] = await Promise.all([
      authedFetch(`/api/portfolios/${encodeURIComponent(state.currentPortfolioId)}/snapshots?period=${period}`),
      fetchBenchmark,
    ]);

    if (!resp.ok) return;
    const data      = await resp.json();
    const snapshots = data.snapshots || [];

    if (snapshots.length < 2) {
      if (chartEmptyEl)     chartEmptyEl.style.display    = "flex";
      if (portfolioChartEl) portfolioChartEl.style.display = "none";
      if (heartrateChange)  heartrateChange.textContent   = "";
      if (state.portfolioChart) { state.portfolioChart.destroy(); state.portfolioChart = null; }
      return;
    }

    if (chartEmptyEl)     chartEmptyEl.style.display    = "none";
    if (portfolioChartEl) portfolioChartEl.style.display = "block";

    if (heartrateChange) {
      const pct = data.pct_change || 0;
      heartrateChange.textContent = `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
      heartrateChange.style.color = pct >= 0 ? "var(--gain)" : "var(--loss)";
    }

    const dateCounts = {};
    snapshots.forEach((s) => { dateCounts[s.date] = (dateCounts[s.date] || 0) + 1; });
    const SLOT_LABEL = { open: "open", midday: "mid", close: "cls", eod: "" };
    const labels = snapshots.map((s) => {
      const suffix = dateCounts[s.date] > 1 && s.slot ? ` ${SLOT_LABEL[s.slot] || s.slot}` : "";
      return s.date + suffix;
    });
    const rawValues = snapshots.map((s) => s.total_value);
    const portStart = rawValues[0] || 0;
    const isPnlMode = state.chartMode === "pnl";
    const values    = isPnlMode ? rawValues.map((v) => parseFloat((v - portStart).toFixed(2))) : rawValues;
    const lastVal   = values[values.length - 1] || 0;
    const isUp      = lastVal >= 0;
    const lineColor = isUp ? "#00d97e" : "#ff4560";
    const fillColor = isUp ? "rgba(0,217,126,0.07)" : "rgba(255,69,96,0.07)";

    const fmtTooltip = (v) => {
      if (!isPnlMode) return formatCurrency(v);
      const sign = v >= 0 ? "+" : "";
      return `${sign}${formatCurrency(v)}`;
    };

    const datasets = [{
      label:                     "Portfolio",
      data:                      values,
      borderColor:               lineColor,
      backgroundColor:           fillColor,
      borderWidth:               1.5,
      fill:                      true,
      tension:                   0.3,
      pointRadius:               0,
      pointHoverRadius:          4,
      pointHoverBackgroundColor: lineColor,
    }];

    if (benchData && benchData.data && benchData.data.length > 0 && portStart > 0) {
      const spyByDate   = {};
      benchData.data.forEach((d) => { spyByDate[d.date] = d.close; });
      const sortedDates = Object.keys(spyByDate).sort();
      const spyStart    = sortedDates.length > 0 ? spyByDate[sortedDates[0]] : null;

      if (spyStart) {
        const benchValues = snapshots.map((s) => {
          const candidates = sortedDates.filter((d) => d <= s.date);
          const nearest    = candidates.length > 0 ? candidates[candidates.length - 1] : sortedDates[0];
          const spyPrice   = spyByDate[nearest];
          const scaled     = spyPrice ? parseFloat((portStart * (spyPrice / spyStart)).toFixed(2)) : null;
          return scaled !== null && isPnlMode ? parseFloat((scaled - portStart).toFixed(2)) : scaled;
        });
        datasets.push({
          label:           "SPY",
          data:            benchValues,
          borderColor:     "#f0b429",
          backgroundColor: "transparent",
          borderWidth:     1.5,
          borderDash:      [5, 4],
          fill:            false,
          tension:         0.3,
          pointRadius:     0,
          pointHoverRadius: 3,
          pointHoverBackgroundColor: "#f0b429",
        });
      }
    }

    if (state.portfolioChart) state.portfolioChart.destroy();
    const ctx = portfolioChartEl.getContext("2d");
    state.portfolioChart = new Chart(ctx, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        interaction:         { intersect: false, mode: "index" },
        plugins: {
          legend: {
            display: datasets.length > 1,
            labels: { color: "#6b879e", font: { family: "'IBM Plex Mono', monospace", size: 10 }, boxWidth: 20, usePointStyle: true },
          },
          tooltip: {
            backgroundColor: "#1b2a38", borderColor: "rgba(255,255,255,0.07)", borderWidth: 1,
            titleColor: "#6b879e", bodyColor: "#d8e4ee",
            titleFont: { family: "'IBM Plex Mono', monospace", size: 10 },
            bodyFont:  { family: "'IBM Plex Mono', monospace", size: 12 },
            callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmtTooltip(ctx.raw)}` },
          },
        },
        scales: {
          x: {
            grid: { color: "rgba(255,255,255,0.03)" }, border: { display: false },
            ticks: { color: "#2e4a60", font: { family: "'IBM Plex Mono', monospace", size: 9 }, maxTicksLimit: 8, maxRotation: 0 },
          },
          y: {
            grid: { color: "rgba(255,255,255,0.03)" }, border: { display: false },
            ticks: {
              color: "#2e4a60", font: { family: "'IBM Plex Mono', monospace", size: 9 },
              callback: (v) => {
                if (!isPnlMode) return "$" + Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
                const sign = v >= 0 ? "+" : "";
                return sign + "$" + Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
              },
            },
          },
        },
      },
    });
  } catch (err) {
    console.error("Heartrate chart error:", err);
  }
}

// ─── Sector donut chart (#8) ──────────────────────────────────────────────────
const SECTOR_COLORS = [
  "#3d9cf0","#00d97e","#f0b429","#ff4560","#a855f7","#06b6d4",
  "#f97316","#84cc16","#ec4899","#14b8a6","#6b879e","#e879f9",
];

export async function loadSectors() {
  if (!state.currentPortfolioId) return;
  const wrapEl   = document.getElementById("sectorChartWrap");
  const canvasEl = document.getElementById("sectorChart");
  const listEl   = document.getElementById("sectorList");
  if (!wrapEl || !canvasEl) return;

  try {
    const resp = await authedFetch(`/api/portfolios/${encodeURIComponent(state.currentPortfolioId)}/sectors`);
    if (!resp.ok) return;
    const data    = await resp.json();
    const sectors = data.sectors || [];
    if (!sectors.length) return;

    const labels = sectors.map((s) => s.sector);
    const values = sectors.map((s) => s.value);
    const colors = sectors.map((_, i) => SECTOR_COLORS[i % SECTOR_COLORS.length]);

    if (state.sectorChart) state.sectorChart.destroy();
    const ctx = canvasEl.getContext("2d");
    state.sectorChart = new Chart(ctx, {
      type: "doughnut",
      data: { labels, datasets: [{ data: values, backgroundColor: colors, borderColor: "#10181f", borderWidth: 2, hoverOffset: 6 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "65%",
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#1b2a38", borderColor: "rgba(255,255,255,0.07)", borderWidth: 1,
            titleColor: "#6b879e", bodyColor: "#d8e4ee",
            titleFont: { family: "'IBM Plex Mono', monospace", size: 10 },
            bodyFont:  { family: "'IBM Plex Mono', monospace", size: 12 },
            callbacks: {
              label: (ctx) => ` ${formatCurrency(ctx.raw)} (${sectors[ctx.dataIndex]?.pct ?? 0}%)`,
            },
          },
        },
      },
    });

    if (listEl) {
      listEl.innerHTML = sectors.map((s, i) => `
        <div class="sector-item">
          <span class="sector-dot" style="background:${colors[i]}"></span>
          <span class="sector-name">${escapeHtml(s.sector)}</span>
          <span class="sector-pct">${s.pct.toFixed(1)}%</span>
          <span class="sector-val">${formatCurrency(s.value)}</span>
        </div>
      `).join("");
    }
  } catch (err) {
    console.error("Sector chart error:", err);
  }
}

// ─── Ticker tape ──────────────────────────────────────────────────────────────
export async function updateTickerTape() {
  try {
    const resp  = await fetch("/api/market/ticker-tape");
    if (!resp.ok) return;
    const data  = await resp.json();
    const items = data.items || [];
    if (!items.length) return;

    const tape  = document.querySelector(".ticker-tape");
    const track = document.querySelector(".ticker-track");
    if (!tape || !track) return;

    const fmtPrice = (price, sym) => {
      if (sym === "EURUSD=X") return price.toFixed(4);
      if (price >= 10000)     return price.toLocaleString(undefined, { maximumFractionDigits: 0 });
      return price.toFixed(2);
    };

    const itemHtml = items.map((it) => {
      const cls   = it.direction === "up" ? "tick--gain" : (it.direction === "down" ? "tick--loss" : "tick--neutral");
      const arrow = it.direction === "up" ? "▲" : (it.direction === "down" ? "▼" : "─");
      const sign  = it.change_pct >= 0 ? "+" : "";
      return `<span class="tick ${cls}">${it.display}&nbsp;${fmtPrice(it.price, it.symbol)}&nbsp;${arrow}&nbsp;${sign}${it.change_pct.toFixed(2)}%</span><span class="tick-sep">◆</span>`;
    }).join("");

    if (state.tickerAnimId !== null) { cancelAnimationFrame(state.tickerAnimId); state.tickerAnimId = null; }

    track.style.transform = "translateX(0)";
    track.innerHTML = itemHtml;

    const startAnimation = (attempt = 1) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const tapeW   = tape.offsetWidth;
          const singleW = track.scrollWidth;
          if (!singleW) {
            if (attempt < 3) startAnimation(attempt + 1);
            return;
          }
          const copies = Math.max(2, Math.ceil((tapeW * 2) / singleW) + 1);
          track.innerHTML = Array.from({ length: copies }, () => itemHtml).join("");
          let pos = 0;
          const step = () => {
            pos -= 0.8;
            if (pos <= -singleW) pos += singleW;
            track.style.transform = `translateX(${pos}px)`;
            state.tickerAnimId = requestAnimationFrame(step);
          };
          state.tickerAnimId = requestAnimationFrame(step);
        });
      });
    };
    startAnimation();
  } catch (e) {
    console.error("[TickerTape] error:", e);
  }
}

// ─── Fear & Greed widget ──────────────────────────────────────────────────────
function fngColor(score) {
  if (score <= 24) return "#ff4560";
  if (score <= 44) return "#ff7043";
  if (score <= 55) return "#f0b429";
  if (score <= 75) return "#52c41a";
  return "#00d97e";
}

export async function loadFearGreed() {
  try {
    const resp  = await fetch("/api/market/fear-greed");
    if (!resp.ok) return;
    const data  = await resp.json();
    const score = data.score || 0;
    const color = fngColor(score);
    const scoreEl  = document.getElementById("fngScore");
    const ratingEl = document.getElementById("fngRating");
    const ringEl   = document.getElementById("fngRing");
    if (scoreEl)  { scoreEl.textContent = Math.round(score); scoreEl.style.color = color; }
    if (ratingEl) { ratingEl.textContent = (data.rating || "").toUpperCase(); ratingEl.style.color = color; }
    if (ringEl)   { ringEl.style.borderColor = color; ringEl.style.boxShadow = `0 0 10px ${color}50`; }
  } catch (e) {
    console.error("Fear & Greed error:", e);
  }
}
