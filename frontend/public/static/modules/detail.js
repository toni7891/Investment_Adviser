// Ref: [[formatters.js]] [[app.js]] [[routes.py]] [[PROJECT_MAP.md]]
import { formatCurrency, formatPercent, escapeHtml } from "./formatters.js";

let _chart = null;

export function openDetailPanel(ticker) {
  const panel = document.getElementById("stockDetailPanel");
  if (!panel) return;
  panel.classList.add("open");
  document.getElementById("detailTicker").textContent = ticker;
  document.getElementById("detailBody").innerHTML = '<div class="detail-loading">Loading…</div>';

  fetch(`/api/market/stock-detail/${encodeURIComponent(ticker)}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((data) => _renderDetail(data))
    .catch(() => {
      document.getElementById("detailBody").innerHTML =
        '<div class="detail-error">Failed to load data.</div>';
    });
}

export function closeDetailPanel() {
  const panel = document.getElementById("stockDetailPanel");
  if (panel) panel.classList.remove("open");
  if (_chart) { _chart.destroy(); _chart = null; }
}

function _renderDetail(data) {
  const stats  = data.stats  || {};
  const prices = data.prices || [];
  const news   = data.news   || [];
  const dayPct = stats.day_change_pct || 0;

  document.getElementById("detailBody").innerHTML = `
    <div class="detail-stats">
      <div class="ds-item">
        <span class="ds-lbl">PRICE</span>
        <span class="ds-val">${formatCurrency(stats.current_price || 0)}</span>
      </div>
      <div class="ds-item">
        <span class="ds-lbl">DAY CHG</span>
        <span class="ds-val ${dayPct >= 0 ? "success" : "negative"}">${formatPercent(dayPct)}</span>
      </div>
      <div class="ds-item">
        <span class="ds-lbl">MKT CAP</span>
        <span class="ds-val">${_fmtCap(stats.market_cap || 0)}</span>
      </div>
      <div class="ds-item">
        <span class="ds-lbl">52W HIGH</span>
        <span class="ds-val">${formatCurrency(stats.week_52_high || 0)}</span>
      </div>
      <div class="ds-item">
        <span class="ds-lbl">52W LOW</span>
        <span class="ds-val">${formatCurrency(stats.week_52_low || 0)}</span>
      </div>
      <div class="ds-item">
        <span class="ds-lbl">VOLUME</span>
        <span class="ds-val">${(stats.volume || 0).toLocaleString()}</span>
      </div>
      <div class="ds-item">
        <span class="ds-lbl">P/E</span>
        <span class="ds-val">${stats.pe_ratio != null ? stats.pe_ratio.toFixed(2) : "N/A"}</span>
      </div>
    </div>
    <div class="detail-chart-wrap">
      <canvas id="detailChart"></canvas>
    </div>
    <div class="detail-news">
      <div class="detail-section-lbl">// LATEST NEWS</div>
      ${
        news.length
          ? news
              .map(
                (n) => `
          <a class="news-item" href="${escapeHtml(n.url).replace(/^javascript:/i, "#")}" target="_blank" rel="noopener noreferrer">
            <div class="news-headline">${escapeHtml(n.title)}</div>
            <div class="news-snippet">${escapeHtml(n.snippet)}</div>
          </a>`
              )
              .join("")
          : '<div class="news-empty">No news found.</div>'
      }
    </div>
  `;

  if (prices.length) {
    const ctx = document.getElementById("detailChart")?.getContext("2d");
    if (!ctx) return;
    if (_chart) { _chart.destroy(); _chart = null; }

    const labels = prices.map((p) => p.date);
    const values = prices.map((p) => p.close);
    const isUp   = values[values.length - 1] >= values[0];
    const color  = isUp ? "#10b981" : "#ef4444";

    _chart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{
          data: values,
          borderColor: color,
          borderWidth: 1.5,
          pointRadius: 0,
          fill: true,
          backgroundColor: `${color}18`,
          tension: 0.2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: (c) => `$${c.parsed.y.toFixed(2)}` },
          },
        },
        scales: {
          x: { display: false },
          y: {
            display: true,
            grid: { color: "rgba(255,255,255,0.04)" },
            ticks: {
              color: "#555",
              font: { size: 9 },
              callback: (v) => `$${v}`,
            },
          },
        },
      },
    });
  }
}

function _fmtCap(cap) {
  if (cap >= 1e12) return `$${(cap / 1e12).toFixed(2)}T`;
  if (cap >= 1e9)  return `$${(cap / 1e9).toFixed(2)}B`;
  if (cap >= 1e6)  return `$${(cap / 1e6).toFixed(2)}M`;
  if (cap > 0)     return `$${cap.toLocaleString()}`;
  return "──";
}
