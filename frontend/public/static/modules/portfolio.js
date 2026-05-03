// Ref: [[state.js]] [[formatters.js]] [[ui.js]] [[chart.js]] [[modals.js]] [[app.js]] [[PROJECT_MAP.md]]
import { state } from "./state.js";
import { formatCurrency, formatPercent, setSignedStatus } from "./formatters.js";
import { showToast, showConfirm } from "./ui.js";
import { loadHeartrate, loadSectors } from "./chart.js";
// openPositionModal and openSellModal are imported lazily via modals.js to avoid circular deps
import { openPositionModal, openSellModal } from "./modals.js";

// ─── Sort helpers ─────────────────────────────────────────────────────────────
export function sortPositions(positions) {
  const augmented = positions.map((p) => {
    const price     = Number(p.current_price || 0);
    const cost      = Number(p.average_cost  || 0);
    const mv        = Number(p.market_value  || price * Number(p.shares || 0));
    const dayPct    = Number(p.daily_change  || 0);
    const dayDollar = mv - mv / (1 + dayPct / 100);
    return { ...p, total_pnl: Number(p.pl || 0), total_pnl_pct: cost > 0 ? ((price - cost) / cost) * 100 : 0, daily_change_dollar: dayDollar };
  });
  return augmented.sort((a, b) => {
    if (state.sortKey === "ticker") {
      const ta = (a.ticker || "").toLowerCase();
      const tb = (b.ticker || "").toLowerCase();
      return state.sortDir * (ta < tb ? -1 : ta > tb ? 1 : 0);
    }
    return state.sortDir * (Number(a[state.sortKey] || 0) - Number(b[state.sortKey] || 0));
  });
}

export function updateSortHeaders() {
  document.querySelectorAll(".holdings-table th[data-sort]").forEach((th) => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.sort === state.sortKey) {
      th.classList.add(state.sortDir === 1 ? "sort-asc" : "sort-desc");
    }
  });
}

// ─── Holdings renderer ────────────────────────────────────────────────────────
export function renderHoldings(data) {
  const totalValue   = Number(data.total_balance || 0);
  const holdingsBody = document.getElementById("holdingsBody");
  if (!holdingsBody) return;
  holdingsBody.innerHTML = "";

  let bestStock = null;
  const sorted  = sortPositions(data.positions || []);

  sorted.forEach((stock) => {
    const dayChangePct    = Number(stock.daily_change         || 0);
    const dayChangeDollar = Number(stock.daily_change_dollar  || 0);
    const currentPrice    = Number(stock.current_price        || 0);
    const shares          = Number(stock.shares               || 0);
    const marketValue     = Number(stock.market_value         || currentPrice * shares);
    const totalPnL        = Number(stock.total_pnl            || 0);
    const totalPnLPct     = Number(stock.total_pnl_pct        || 0);
    const allocPct        = totalValue > 0 ? (marketValue / totalValue) * 100 : 0;

    if (!bestStock || dayChangePct > Number(bestStock.daily_change || 0)) bestStock = stock;

    const row = document.createElement("tr");
    row.innerHTML = `
      <td class="col-ticker"><button class="ticker-link" data-ticker="${stock.ticker ?? ""}">${stock.ticker ?? ""}</button></td>
      <td class="col-num">${shares}</td>
      <td class="col-num">${formatCurrency(currentPrice)}</td>
      <td class="col-num">${formatCurrency(marketValue)}</td>
      <td class="col-alloc">
        <div class="alloc-wrap">
          <div class="alloc-track"><div class="alloc-fill" style="width:${Math.min(allocPct, 100).toFixed(1)}%"></div></div>
          <span class="alloc-num">${allocPct.toFixed(1)}%</span>
        </div>
      </td>
      <td class="col-num ${dayChangePct    >= 0 ? "success" : "negative"}">${formatPercent(dayChangePct)}</td>
      <td class="col-num ${dayChangeDollar >= 0 ? "success" : "negative"}">${formatCurrency(dayChangeDollar)}</td>
      <td class="col-num ${totalPnLPct     >= 0 ? "success" : "negative"}">${formatPercent(totalPnLPct)}</td>
      <td class="col-num ${totalPnL    >= 0 ? "success" : "negative"}">${formatCurrency(totalPnL)}</td>
      <td class="col-ops">
        <button class="btn-edit" data-ticker="${stock.ticker}" title="Edit ${stock.ticker}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
          Edit
        </button>
        <button class="btn-sell" data-ticker="${stock.ticker}" data-shares="${shares}" data-price="${currentPrice}" title="Sell ${stock.ticker}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="1" x2="12" y2="23"></line>
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
          </svg>
          Sell
        </button>
      </td>
    `;
    holdingsBody.appendChild(row);
  });

  holdingsBody.querySelectorAll(".ticker-link").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ticker = btn.dataset.ticker;
      if (ticker && ticker !== "CASH" && window._openDetailPanel) window._openDetailPanel(ticker);
    });
  });

  holdingsBody.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const stock = data.positions.find((p) => p.ticker === btn.dataset.ticker);
      if (stock) openPositionModal(true, stock);
    });
  });

  holdingsBody.querySelectorAll(".btn-sell").forEach((btn) => {
    btn.addEventListener("click", () => {
      openSellModal(btn.dataset.ticker, parseFloat(btn.dataset.shares) || 0, parseFloat(btn.dataset.price) || 0);
    });
  });

  const highestGrowthEl = document.getElementById("highestGrowth");
  if (highestGrowthEl && bestStock) {
    const bestChange = Number(bestStock.daily_change || 0);
    highestGrowthEl.textContent = `${bestStock.ticker} (${formatPercent(bestChange)})`;
    setSignedStatus(highestGrowthEl, bestChange);
  }
}

// ─── Summary loader ───────────────────────────────────────────────────────────
export function loadSummary() {
  if (!state.currentPortfolioId) return;

  fetch(`/api/portfolios/${state.currentPortfolioId}`)
    .then((resp) => { if (!resp.ok) throw new Error(`HTTP ${resp.status}`); return resp.json(); })
    .then((data) => {
      state.lastPortfolioData = data;

      const totalBalance      = Number(data.total_balance    || 0);
      const totalProfit       = Number(data.total_profit     || 0);
      const dailyChangePct    = Number(data.daily_change_pct || 0);
      const dailyChangeDollar = totalBalance - totalBalance / (1 + dailyChangePct / 100);
      const investedValue     = Number(data.invested_value   || 0);
      const cashValue         = Number(data.cash_value       || 0);

      const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
      set("totalBalance",   formatCurrency(totalBalance));
      set("investedAmount", formatCurrency(investedValue));
      set("cashAmount",     formatCurrency(cashValue));
      set("currentPortfolio", state.currentPortfolioId);

      const totalProfitEl = document.getElementById("totalProfit");
      if (totalProfitEl) {
        totalProfitEl.textContent = `${totalProfit >= 0 ? "+" : ""}${formatCurrency(totalProfit)}`;
        setSignedStatus(totalProfitEl, totalProfit);
      }
      const dailyChangeEl = document.getElementById("dailyChange");
      if (dailyChangeEl) { dailyChangeEl.textContent = formatPercent(dailyChangePct); setSignedStatus(dailyChangeEl, dailyChangePct); }
      const dailyChangeDollarEl = document.getElementById("dailyChangeDollar");
      if (dailyChangeDollarEl) {
        dailyChangeDollarEl.textContent = `${dailyChangeDollar >= 0 ? "+" : ""}${formatCurrency(dailyChangeDollar)}`;
        setSignedStatus(dailyChangeDollarEl, dailyChangeDollar);
      }

      renderHoldings(data);
      updateStatusIndicators();
      loadHeartrate(state.currentPeriod);
      loadSectors();
      loadTrades();

      const stamp = document.getElementById("refreshStamp");
      if (stamp) {
        const t = new Date().toLocaleTimeString("en-GB", { hour12: false });
        stamp.textContent = `↻ ${t}`;
      }
    })
    .catch((err) => {
      console.error("Load Summary Error:", err);
      showToast("Failed to load portfolio data.", "error");
      const el = document.getElementById("totalBalance");
      if (el) el.textContent = "Error";
    });
}

// ─── Portfolio list ───────────────────────────────────────────────────────────
export async function loadPortfolios() {
  const portfolioList = document.getElementById("portfolioList");
  if (!portfolioList) return;
  try {
    const response = await fetch("/api/portfolios/list");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data  = await response.json();
    const names = data.portfolios || [];
    portfolioList.innerHTML = "";

    const countEl = document.getElementById("portfolioCount");
    if (countEl) countEl.textContent = names.length > 0 ? `${names.length}` : "";

    if (names.length === 0) {
      portfolioList.innerHTML = '<div class="portfolio-card portfolio-card--empty">No portfolios found</div>';
      return;
    }

    names.forEach((name) => {
      const card = document.createElement("div");
      card.className = "portfolio-card";
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.innerHTML = `
        <div class="portfolio-card__title">${name}</div>
        <div class="portfolio-card__meta">Open portfolio</div>
        <button class="portfolio-card__delete" data-name="${name}" title="Delete portfolio" aria-label="Delete portfolio">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6l-2 14H7L5 6"></path>
            <path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4h6v2"></path>
          </svg>
          <span class="delete-label">Delete</span>
        </button>
      `;
      card.addEventListener("click", (e) => {
        if (e.target.closest(".portfolio-card__delete")) return;
        localStorage.setItem("currentPortfolioId", name);
        window.location.href = "/dashboard";
      });
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          localStorage.setItem("currentPortfolioId", name);
          window.location.href = "/dashboard";
        }
      });
      card.querySelector(".portfolio-card__delete").addEventListener("click", async (e) => {
        e.stopPropagation();
        const confirmed = await showConfirm("DELETE PORTFOLIO", `Delete "${name}"? All positions will be permanently removed.`);
        if (!confirmed) return;
        try {
          const resp = await fetch(`/api/portfolios/${encodeURIComponent(name)}`, { method: "DELETE" });
          if (resp.ok) {
            card.style.transition = "opacity 0.2s, transform 0.2s";
            card.style.opacity = "0"; card.style.transform = "scale(0.9)";
            setTimeout(() => card.remove(), 200);
            showToast(`Portfolio "${name}" deleted`, "success");
          } else {
            const err = await resp.json().catch(() => ({}));
            showToast(err.detail || "Failed to delete portfolio", "error");
          }
        } catch { showToast("Network error while deleting", "error"); }
      });
      portfolioList.appendChild(card);
    });
  } catch (err) {
    console.error("Load Portfolios Error:", err);
    portfolioList.innerHTML = '<div class="portfolio-card portfolio-card--empty">Connection failed</div>';
    showToast("Could not load portfolios. Check your connection.", "error");
  }
}

// ─── Status indicators ────────────────────────────────────────────────────────
export function updateStatusIndicators() {
  const mongoStatus    = document.getElementById("mongoStatus");
  const mongoStatusDot = document.getElementById("mongoStatusDot");
  fetch("/status")
    .then((resp) => {
      if (!resp.ok) throw new Error();
      if (mongoStatus)    { mongoStatus.textContent = "Connected"; mongoStatus.style.color = "#10b981"; }
      if (mongoStatusDot) { mongoStatusDot.style.background = "#10b981"; mongoStatusDot.style.boxShadow = "0 0 6px #10b981"; }
    })
    .catch(() => {
      if (mongoStatus)    { mongoStatus.textContent = "Disconnected"; mongoStatus.style.color = "#ef4444"; }
      if (mongoStatusDot) { mongoStatusDot.style.background = "#ef4444"; mongoStatusDot.style.boxShadow = "none"; }
    });
}

// ─── Positions export (#14) ───────────────────────────────────────────────────
export function exportPositions() {
  if (!state.currentPortfolioId) return;
  window.location.href = `/api/portfolios/${encodeURIComponent(state.currentPortfolioId)}/positions/export`;
}

// ─── Trade history (#10) ──────────────────────────────────────────────────────
export async function loadTrades() {
  if (!state.currentPortfolioId) return;
  const bodyEl     = document.getElementById("tradesBody");
  const totalEl    = document.getElementById("tradesTotalPnl");
  const sectionEl  = document.getElementById("tradesSection");
  if (!bodyEl || !sectionEl) return;

  try {
    const resp = await fetch(`/api/portfolios/${encodeURIComponent(state.currentPortfolioId)}/trades`);
    if (!resp.ok) return;
    const data   = await resp.json();
    const trades = data.trades || [];

    if (totalEl) {
      const pnl = data.total_realized_pnl || 0;
      totalEl.textContent = `${pnl >= 0 ? "+" : ""}${formatCurrency(pnl)}`;
      totalEl.className   = `trades-total-val ${pnl >= 0 ? "success" : "negative"}`;
    }

    if (!trades.length) {
      bodyEl.innerHTML = `<tr><td colspan="7" class="trades-empty">No realized trades yet — sell a position to record a trade.</td></tr>`;
      return;
    }

    bodyEl.innerHTML = trades.map((t) => {
      if (t.type === "deposit" || t.type === "withdraw") {
        const isDeposit = t.type === "deposit";
        return `
          <tr>
            <td class="col-ticker">CASH</td>
            <td class="col-num">${t.date}</td>
            <td class="col-num">──</td>
            <td class="col-num">──</td>
            <td class="col-num">──</td>
            <td class="col-num ${isDeposit ? "success" : "negative"}">${isDeposit ? "+" : "-"}${formatCurrency(t.amount)}</td>
            <td class="col-num">${isDeposit ? "DEPOSIT" : "WITHDRAW"}</td>
          </tr>
        `;
      }
      const pnl = t.realized_pnl || 0;
      return `
        <tr>
          <td class="col-ticker">${t.ticker}</td>
          <td class="col-num">${t.date}</td>
          <td class="col-num">${t.shares}</td>
          <td class="col-num">${formatCurrency(t.sell_price)}</td>
          <td class="col-num">${formatCurrency(t.avg_cost)}</td>
          <td class="col-num">${formatCurrency(t.proceeds)}</td>
          <td class="col-num ${pnl >= 0 ? "success" : "negative"}">${pnl >= 0 ? "+" : ""}${formatCurrency(pnl)}</td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    console.error("Trade history error:", err);
  }
}
