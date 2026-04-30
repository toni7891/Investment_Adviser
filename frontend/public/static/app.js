/*****************************************************************************/
/* Investment Strategist Dashboard — Main Application Logic  v5.1           */
/*****************************************************************************/

document.addEventListener("DOMContentLoaded", () => {

  /**************************************************************************
   * SECTION 1 · DOM REFERENCES
   **************************************************************************/
  const landingPage        = document.getElementById("landing-page");
  const dashboardPage      = document.getElementById("dashboard-page");
  const portfolioList      = document.getElementById("portfolioList");
  const backButton         = document.getElementById("backButton");
  const portfolioTitle     = document.getElementById("portfolioTitle");
  const currentPortfolioEl = document.getElementById("currentPortfolio");
  const totalBalanceEl     = document.getElementById("totalBalance");
  const totalProfitEl      = document.getElementById("totalProfit");
  const dailyChangeEl        = document.getElementById("dailyChange");
  const dailyChangeDollarEl  = document.getElementById("dailyChangeDollar");
  const highestGrowthEl    = document.getElementById("highestGrowth");
  const investedAmountEl   = document.getElementById("investedAmount");
  const cashAmountEl       = document.getElementById("cashAmount");

  const chatInput          = document.getElementById("chatInput");
  const sendButton         = document.getElementById("sendButton");
  const chatMessages       = document.getElementById("chatMessages");
  const uploadPortfolioButton = document.getElementById("uploadPortfolioButton");
  const portfolioUpload    = document.getElementById("portfolioUpload");
  const uploadDropZone     = document.getElementById("uploadDropZone");
  const uploadProgress     = document.getElementById("uploadProgress");
  const toastContainer     = document.getElementById("toastContainer");
  const webSearchToggle    = document.getElementById("webSearchToggle");

  const addPositionBtn     = document.getElementById("addPositionBtn");
  const depositCashBtn     = document.getElementById("depositCashBtn");
  const withdrawCashBtn    = document.getElementById("withdrawCashBtn");

  // Cash modal
  const cashModal       = document.getElementById("cashModal");
  const cashModalTitle  = document.getElementById("cashModalTitle");
  const cashForm        = document.getElementById("cashForm");
  const cashAmountInput = document.getElementById("cashAmountInput");
  const cashCancelBtn   = document.getElementById("cashCancelBtn");
  const cashSubmitBtn   = document.getElementById("cashSubmitBtn");

  // Position (buy/edit) modal
  const positionModal        = document.getElementById("positionModal");
  const modalTitle           = document.getElementById("modalTitle");
  const positionForm         = document.getElementById("positionForm");
  const tickerInput          = document.getElementById("tickerInput");
  const sharesInput          = document.getElementById("sharesInput");
  const costInput            = document.getElementById("costInput");
  const cancelBtn            = document.getElementById("cancelBtn");
  const availableCashDisplay = document.getElementById("availableCashDisplay");
  const availableCashGroup   = document.getElementById("availableCashGroup");
  const buyCostDisplay       = document.getElementById("buyCostDisplay");

  // Sell modal
  const sellModal          = document.getElementById("sellModal");
  const sellForm           = document.getElementById("sellForm");
  const sellTickerLabel    = document.getElementById("sellTickerLabel");
  const sellAvailableLabel = document.getElementById("sellAvailableLabel");
  const sellSharesInput    = document.getElementById("sellSharesInput");
  const sellPriceInput     = document.getElementById("sellPriceInput");
  const sellProceedsDisplay = document.getElementById("sellProceedsDisplay");
  const sellCancelBtn      = document.getElementById("sellCancelBtn");
  const sellSubmitBtn      = document.getElementById("sellSubmitBtn");

  // Heartrate chart
  const exportHistoryBtn     = document.getElementById("exportHistoryBtn");
  const importHistoryBtn     = document.getElementById("importHistoryBtn");
  const snapshotImportInput  = document.getElementById("snapshotImportInput");
  const takeSnapshotBtn      = document.getElementById("takeSnapshotBtn");
  const heartrateChange      = document.getElementById("heartrateChange");
  const chartEmptyEl         = document.getElementById("chartEmpty");
  const portfolioChartEl     = document.getElementById("portfolioChart");

  /**************************************************************************
   * SECTION 2 · STATE
   **************************************************************************/
  let currentPortfolioId = null;
  let isEditing          = false;
  let lastPortfolioData  = null;

  // Sell modal state
  let sellTicker    = null;
  let sellMaxShares = 0;

  // Chart state
  let portfolioChart = null;
  let currentPeriod  = "1w";

  // Sort state — default: descending by daily change
  let sortKey = "daily_change";
  let sortDir = -1;

  // Ticker tape animation frame id
  let tickerAnimId = null;

  // Benchmark overlay state
  let benchmarkEnabled = false;

  // Diagnostic object — inspect via window.__tickerDiag in browser console
  window.__tickerDiag = {
    running:    false,
    lastStart:  null,
    lastError:  null,
    singleW:    null,
    copies:     null,
    itemCount:  null,
    status() {
      console.table({
        running:   this.running,
        lastStart: this.lastStart,
        lastError: this.lastError,
        singleW:   this.singleW,
        copies:    this.copies,
        itemCount: this.itemCount,
      });
    },
  };

  /**************************************************************************
   * SECTION 3 · FORMATTERS
   **************************************************************************/
  const formatCurrency = (value) =>
    `$${Number(value || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const formatPercent = (value) => {
    const num = Number(value || 0);
    return `${num >= 0 ? "+" : ""}${num.toFixed(2)}%`;
  };

  const setSignedStatus = (el, value) => {
    if (!el) return;
    el.classList.remove("success", "negative");
    el.classList.add(value >= 0 ? "success" : "negative");
  };

  /**************************************************************************
   * SECTION 4 · NAVIGATION
   **************************************************************************/
  function showDashboard() {
    window.location.href = "/dashboard";
  }

  function showLanding() {
    window.location.href = "/";
  }

  /**************************************************************************
   * SECTION 5 · UPLOAD STATE
   **************************************************************************/
  function setUploadLoading(isLoading) {
    uploadProgress?.classList.toggle("hidden", !isLoading);
    if (uploadPortfolioButton) uploadPortfolioButton.disabled = isLoading;
    uploadDropZone?.classList.toggle("is-loading", isLoading);
  }

  /**************************************************************************
   * SECTION 6 · TOAST NOTIFICATIONS
   **************************************************************************/
  function showToast(message, type = "error") {
    if (!toastContainer) return;
    const toast = document.createElement("div");
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    window.setTimeout(() => toast.classList.add("toast--visible"), 10);
    window.setTimeout(() => {
      toast.classList.remove("toast--visible");
      window.setTimeout(() => toast.remove(), 300);
    }, 3800);
  }

  /**************************************************************************
   * SECTION 7 · CUSTOM CONFIRM DIALOG
   **************************************************************************/
  function showConfirm(title, message) {
    return new Promise((resolve) => {
      const overlay    = document.getElementById("confirmModal");
      const titleEl    = document.getElementById("confirmTitle");
      const msgEl      = document.getElementById("confirmMessage");
      const okBtn      = document.getElementById("confirmOkBtn");
      const cancelBtn2 = document.getElementById("confirmCancelBtn");
      if (!overlay) { resolve(false); return; }

      titleEl.textContent = title;
      msgEl.textContent   = message;
      overlay.classList.add("active");

      const cleanup = (result) => {
        overlay.classList.remove("active");
        resolve(result);
      };

      okBtn.addEventListener("click",     () => cleanup(true),  { once: true });
      cancelBtn2.addEventListener("click", () => cleanup(false), { once: true });
      overlay.addEventListener("click",   (e) => { if (e.target === overlay) cleanup(false); }, { once: true });
    });
  }

  /**************************************************************************
   * SECTION 8 · FILE UPLOAD
   **************************************************************************/
  function openFilePicker(event) {
    if (event) event.preventDefault();
    if (!portfolioUpload) return;
    portfolioUpload.value = "";
    portfolioUpload.click();
  }

  async function uploadPortfolioFile(file) {
    if (!file) return;
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      showToast("Please upload an Excel file (.xlsx or .xls).", "error");
      return;
    }
    setUploadLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/portfolios/upload", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Upload failed");
      showToast(`Uploaded "${data.portfolio_name || "portfolio"}" successfully.`, "success");
      await loadPortfolios();
    } catch (error) {
      showToast(error.message || "Failed to upload portfolio.", "error");
    } finally {
      setUploadLoading(false);
    }
  }

  /**************************************************************************
   * SECTION 9 · STATUS MONITOR
   **************************************************************************/
  function updateStatusIndicators() {
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

  /**************************************************************************
   * SECTION 10 · FIELD VALIDATION HELPERS
   **************************************************************************/
  function setFieldError(input, message) {
    if (!input) return;
    input.classList.toggle("field-inp--error", !!message);
    let errEl = input.parentElement.querySelector(".field-error");
    if (!errEl) {
      errEl = document.createElement("span");
      errEl.className = "field-error";
      input.parentElement.appendChild(errEl);
    }
    errEl.textContent = message || "";
    errEl.classList.toggle("visible", !!message);
  }

  function clearFieldErrors(container) {
    container?.querySelectorAll(".field-inp--error").forEach((el) => el.classList.remove("field-inp--error"));
    container?.querySelectorAll(".field-error.visible").forEach((el) => el.classList.remove("visible"));
  }

  /**************************************************************************
   * SECTION 11 · SORT HELPERS
   **************************************************************************/
  function sortPositions(positions) {
    const augmented = positions.map((p) => {
      const price      = Number(p.current_price || 0);
      const cost       = Number(p.average_cost  || 0);
      const mv         = Number(p.market_value  || price * Number(p.shares || 0));
      const dayPct     = Number(p.daily_change  || 0);
      // daily $ = mv - mv / (1 + dayPct/100)  (exact, derived from pct)
      const dayDollar  = mv - mv / (1 + dayPct / 100);
      return {
        ...p,
        total_pnl:           Number(p.pl || 0),
        total_pnl_pct:       cost > 0 ? ((price - cost) / cost) * 100 : 0,
        daily_change_dollar: dayDollar,
      };
    });

    return augmented.sort((a, b) => {
      if (sortKey === "ticker") {
        const ta = (a.ticker || "").toLowerCase();
        const tb = (b.ticker || "").toLowerCase();
        return sortDir * (ta < tb ? -1 : ta > tb ? 1 : 0);
      }
      return sortDir * (Number(a[sortKey] || 0) - Number(b[sortKey] || 0));
    });
  }

  function updateSortHeaders() {
    document.querySelectorAll(".holdings-table th[data-sort]").forEach((th) => {
      th.classList.remove("sort-asc", "sort-desc");
      if (th.dataset.sort === sortKey) {
        th.classList.add(sortDir === 1 ? "sort-asc" : "sort-desc");
      }
    });
  }

  /**************************************************************************
   * SECTION 12 · HOLDINGS RENDERER
   **************************************************************************/
  function renderHoldings(data) {
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

      if (!bestStock || dayChangePct > Number(bestStock.daily_change || 0)) {
        bestStock = stock;
      }

      const row = document.createElement("tr");
      row.innerHTML = `
        <td class="col-ticker">${stock.ticker ?? ""}</td>
        <td class="col-num">${shares}</td>
        <td class="col-num">${formatCurrency(currentPrice)}</td>
        <td class="col-num">${formatCurrency(marketValue)}</td>
        <td class="col-alloc">
          <div class="alloc-wrap">
            <div class="alloc-track">
              <div class="alloc-fill" style="width:${Math.min(allocPct, 100).toFixed(1)}%"></div>
            </div>
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

    // Edit buttons
    holdingsBody.querySelectorAll(".btn-edit").forEach((button) => {
      button.addEventListener("click", () => {
        const ticker = button.dataset.ticker;
        if (!ticker || !currentPortfolioId) return;
        const stock = data.positions.find((p) => p.ticker === ticker);
        if (stock) openPositionModal(true, stock);
      });
    });

    // Sell buttons
    holdingsBody.querySelectorAll(".btn-sell").forEach((button) => {
      button.addEventListener("click", () => {
        const ticker = button.dataset.ticker;
        const shares = parseFloat(button.dataset.shares) || 0;
        const price  = parseFloat(button.dataset.price)  || 0;
        if (!ticker || !currentPortfolioId) return;
        openSellModal(ticker, shares, price);
      });
    });

    // Top performer
    if (highestGrowthEl && bestStock) {
      const bestChange = Number(bestStock.daily_change || 0);
      highestGrowthEl.textContent = `${bestStock.ticker} (${formatPercent(bestChange)})`;
      setSignedStatus(highestGrowthEl, bestChange);
    }
  }

  /**************************************************************************
   * SECTION 13 · DATA LOADING
   **************************************************************************/
  function loadSummary() {
    if (!currentPortfolioId) return;

    fetch(`/api/portfolios/${currentPortfolioId}`)
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
      })
      .then((data) => {
        lastPortfolioData = data;

        const totalBalance      = Number(data.total_balance    || 0);
        const totalProfit       = Number(data.total_profit     || 0);
        const dailyChangePct    = Number(data.daily_change_pct || 0);
        const dailyChangeDollar = totalBalance - totalBalance / (1 + dailyChangePct / 100);
        const investedValue  = Number(data.invested_value  || 0);
        const cashValue      = Number(data.cash_value      || 0);

        if (totalBalanceEl)   totalBalanceEl.textContent   = formatCurrency(totalBalance);
        if (investedAmountEl) investedAmountEl.textContent = formatCurrency(investedValue);
        if (cashAmountEl)     cashAmountEl.textContent     = formatCurrency(cashValue);

        if (totalProfitEl) {
          totalProfitEl.textContent = `${totalProfit >= 0 ? "+" : ""}${formatCurrency(totalProfit)}`;
          setSignedStatus(totalProfitEl, totalProfit);
        }
        if (dailyChangeEl) {
          dailyChangeEl.textContent = formatPercent(dailyChangePct);
          setSignedStatus(dailyChangeEl, dailyChangePct);
        }
        if (dailyChangeDollarEl) {
          dailyChangeDollarEl.textContent = `${dailyChangeDollar >= 0 ? "+" : ""}${formatCurrency(dailyChangeDollar)}`;
          setSignedStatus(dailyChangeDollarEl, dailyChangeDollar);
        }
        if (currentPortfolioEl) currentPortfolioEl.textContent = currentPortfolioId;

        renderHoldings(data);
        updateStatusIndicators();
        loadHeartrate(currentPeriod);
      })
      .catch((err) => {
        console.error("Load Summary Error:", err);
        showToast("Failed to load portfolio data.", "error");
        if (totalBalanceEl) totalBalanceEl.textContent = "Error";
      });
  }

  async function loadPortfolios() {
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
              <path d="M10 11v6"></path>
              <path d="M14 11v6"></path>
              <path d="M9 6V4h6v2"></path>
            </svg>
            <span class="delete-label">Delete</span>
          </button>
        `;

        card.addEventListener("click", (e) => {
          if (e.target.closest(".portfolio-card__delete")) return;
          localStorage.setItem("currentPortfolioId", name);
          showDashboard();
        });

        card.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            localStorage.setItem("currentPortfolioId", name);
            showDashboard();
          }
        });

        const deleteBtn = card.querySelector(".portfolio-card__delete");
        deleteBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const confirmed = await showConfirm(
            "DELETE PORTFOLIO",
            `Delete "${name}"? All positions will be permanently removed.`
          );
          if (!confirmed) return;

          try {
            const response = await fetch(`/api/portfolios/${encodeURIComponent(name)}`, {
              method: "DELETE",
            });
            if (response.ok) {
              card.style.transition = "opacity 0.2s, transform 0.2s";
              card.style.opacity    = "0";
              card.style.transform  = "scale(0.9)";
              setTimeout(() => card.remove(), 200);
              showToast(`Portfolio "${name}" deleted`, "success");
              if (currentPortfolioId === name) {
                currentPortfolioId = null;
                showLanding();
                loadPortfolios();
              }
            } else {
              const err = await response.json().catch(() => ({}));
              showToast(err.detail || "Failed to delete portfolio", "error");
            }
          } catch {
            showToast("Network error while deleting", "error");
          }
        });

        portfolioList.appendChild(card);
      });
    } catch (err) {
      console.error("Load Portfolios Error:", err);
      portfolioList.innerHTML = '<div class="portfolio-card portfolio-card--empty">Connection failed</div>';
      showToast("Could not load portfolios. Check your connection.", "error");
    }
  }

  /**************************************************************************
   * SECTION 14 · AI CHAT
   **************************************************************************/
  const escapeHtml = (text) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return String(text).replace(/[&<>"']/g, (m) => map[m]);
  };

  const addChatMessage = (content, isUser) => {
    if (!chatMessages) return;
    const div = document.createElement("div");
    div.className = `message ${isUser ? "user" : "bot"}`;
    div.innerHTML = `<p>${escapeHtml(content)}</p>`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  };

  const handleSendMessage = async () => {
    const message = chatInput?.value.trim();
    if (!message) return;

    addChatMessage(message, true);
    chatInput.value = "";
    if (sendButton) sendButton.disabled = true;

    const loadingId  = "loading-" + Date.now();
    const loadingDiv = document.createElement("div");
    loadingDiv.id        = loadingId;
    loadingDiv.className = "message bot loading";
    loadingDiv.innerHTML = `<p><em>AI is thinking…</em></p>`;
    chatMessages?.appendChild(loadingDiv);
    if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
      const response = await fetch("/api/chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          portfolio_id:   currentPortfolioId || "",
          use_web_search: webSearchToggle?.checked ?? true,
        }),
      });
      const data = await response.json();
      document.getElementById(loadingId)?.remove();
      if (!response.ok) {
        addChatMessage(`Error: ${data.detail || "AI request failed."}`, false);
      } else {
        addChatMessage(data.response, false);
      }
    } catch {
      document.getElementById(loadingId)?.remove();
      addChatMessage("Error: Connection failed. Is the AI backend running?", false);
    } finally {
      if (sendButton) sendButton.disabled = false;
      chatInput?.focus();
    }
  };

  sendButton?.addEventListener("click", handleSendMessage);
  chatInput?.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
  });

  /**************************************************************************
   * SECTION 15 · BUY / EDIT POSITION MODAL
   **************************************************************************/
  const updateBuyCost = () => {
    if (!buyCostDisplay || isEditing) return;
    const shares = parseFloat(sharesInput?.value) || 0;
    const price  = parseFloat(costInput?.value)   || 0;
    const total  = shares * price;
    buyCostDisplay.textContent = total > 0 ? `TOTAL COST: ${formatCurrency(total)}` : "";
  };

  function openPositionModal(isEdit = false, stockData = null) {
    if (!positionModal) return;
    isEditing = isEdit;

    if (isEdit) {
      if (modalTitle) modalTitle.textContent = "EDIT POSITION";
      if (availableCashGroup) availableCashGroup.style.display = "none";
      if (buyCostDisplay) buyCostDisplay.textContent = "";
      if (tickerInput) { tickerInput.value = stockData?.ticker || ""; tickerInput.disabled = true; }
      if (sharesInput) sharesInput.value = stockData?.shares || "";
      if (costInput)   costInput.value   = stockData?.average_cost || "";
    } else {
      if (modalTitle) modalTitle.textContent = "BUY POSITION";
      if (availableCashGroup) availableCashGroup.style.display = "";
      const cash = lastPortfolioData?.cash_value || 0;
      if (availableCashDisplay) availableCashDisplay.textContent = formatCurrency(cash);
      if (buyCostDisplay) buyCostDisplay.textContent = "";
      if (tickerInput) { tickerInput.value = ""; tickerInput.disabled = false; }
      if (sharesInput) sharesInput.value = "";
      if (costInput)   costInput.value   = "";
    }

    clearFieldErrors(positionModal);
    positionModal.classList.add("active");
    (isEdit ? sharesInput : tickerInput)?.focus();
  }

  function closePositionModal() {
    positionModal?.classList.remove("active");
    positionForm?.reset();
    clearFieldErrors(positionModal);
    if (tickerInput) tickerInput.disabled = false;
    if (buyCostDisplay) buyCostDisplay.textContent = "";
  }

  tickerInput?.addEventListener("input", () => setFieldError(tickerInput, ""));
  sharesInput?.addEventListener("input", () => { setFieldError(sharesInput, ""); updateBuyCost(); });
  costInput?.addEventListener("input",   () => { setFieldError(costInput,   ""); updateBuyCost(); });

  positionForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const ticker       = tickerInput?.value.trim().toUpperCase() || "";
    const shares       = parseFloat(sharesInput?.value);
    const average_cost = parseFloat(costInput?.value);
    let hasError = false;

    if (!isEditing && !/^[A-Z0-9]{1,6}(\.[A-Z])?$/.test(ticker)) {
      setFieldError(tickerInput, "Use 1–6 uppercase letters/digits (e.g. AAPL)");
      hasError = true;
    }
    if (!shares || shares <= 0) {
      setFieldError(sharesInput, "Must be a positive number");
      hasError = true;
    }
    if (isNaN(average_cost) || average_cost < 0) {
      setFieldError(costInput, "Must be zero or greater");
      hasError = true;
    }
    if (hasError) return;

    const submitBtn = positionForm.querySelector('[type="submit"]');
    const origText  = submitBtn?.textContent;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "SAVING…"; }

    try {
      const response = await fetch(`/api/portfolios/${currentPortfolioId}/positions`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, shares, average_cost, action: isEditing ? "edit" : "buy" }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const msg = errData.detail || `Save failed (${response.status})`;
        if (!isEditing && (msg.toLowerCase().includes("ticker") || msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("invalid"))) {
          setFieldError(tickerInput, msg);
        } else {
          showToast(msg, "error");
        }
        return;
      }

      showToast(`${ticker} ${isEditing ? "updated" : "bought"} successfully`, "success");
      closePositionModal();
      loadSummary();
    } catch (error) {
      showToast(error.message || "Network error", "error");
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = origText; }
    }
  });

  /**************************************************************************
   * SECTION 16 · SELL MODAL
   **************************************************************************/
  const updateSellProceeds = () => {
    const shares   = parseFloat(sellSharesInput?.value)  || 0;
    const price    = parseFloat(sellPriceInput?.value)   || 0;
    const proceeds = shares * price;
    if (sellProceedsDisplay) {
      sellProceedsDisplay.textContent = proceeds > 0 ? `PROCEEDS: ${formatCurrency(proceeds)}` : "";
    }
  };

  function openSellModal(ticker, availableShares, currentPrice) {
    if (!sellModal) return;
    sellTicker    = ticker;
    sellMaxShares = availableShares;

    if (sellTickerLabel)    sellTickerLabel.textContent    = ticker;
    if (sellAvailableLabel) sellAvailableLabel.textContent = `${availableShares} shares`;
    if (sellSharesInput)    { sellSharesInput.value = ""; sellSharesInput.max = availableShares; }
    if (sellPriceInput)     sellPriceInput.value = currentPrice > 0 ? currentPrice.toFixed(2) : "";
    if (sellProceedsDisplay) sellProceedsDisplay.textContent = "";

    clearFieldErrors(sellModal);
    sellModal.classList.add("active");
    sellSharesInput?.focus();
    updateSellProceeds();
  }

  function closeSellModal() {
    sellModal?.classList.remove("active");
    sellForm?.reset();
    clearFieldErrors(sellModal);
    sellTicker    = null;
    sellMaxShares = 0;
  }

  sellSharesInput?.addEventListener("input", () => { setFieldError(sellSharesInput, ""); updateSellProceeds(); });
  sellPriceInput?.addEventListener("input",  () => { setFieldError(sellPriceInput,  ""); updateSellProceeds(); });

  sellForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const shares     = parseFloat(sellSharesInput?.value);
    const sell_price = parseFloat(sellPriceInput?.value);
    let hasError = false;

    if (!shares || shares <= 0) {
      setFieldError(sellSharesInput, "Must be a positive number");
      hasError = true;
    } else if (shares > sellMaxShares + 0.0001) {
      setFieldError(sellSharesInput, `Cannot exceed ${sellMaxShares} available shares`);
      hasError = true;
    }
    if (isNaN(sell_price) || sell_price < 0) {
      setFieldError(sellPriceInput, "Must be zero or greater");
      hasError = true;
    }
    if (hasError) return;

    const origText = sellSubmitBtn?.textContent;
    if (sellSubmitBtn) { sellSubmitBtn.disabled = true; sellSubmitBtn.textContent = "PROCESSING…"; }

    try {
      const response = await fetch(
        `/api/portfolios/${currentPortfolioId}/positions/${encodeURIComponent(sellTicker)}/sell`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shares, sell_price }),
        }
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        showToast(errData.detail || `Sell failed (${response.status})`, "error");
        return;
      }

      const result = await response.json();
      showToast(`Sold ${shares} shares of ${sellTicker} — ${formatCurrency(result.proceeds)} added to cash`, "success");
      closeSellModal();
      loadSummary();
    } catch (error) {
      showToast(error.message || "Network error", "error");
    } finally {
      if (sellSubmitBtn) { sellSubmitBtn.disabled = false; sellSubmitBtn.textContent = origText; }
    }
  });

  /**************************************************************************
   * SECTION 17 · CASH MODAL
   **************************************************************************/
  function openCashModal(isDeposit = true) {
    if (!cashModal) return;
    if (cashModalTitle) cashModalTitle.textContent = isDeposit ? "DEPOSIT CASH"  : "WITHDRAW CASH";
    if (cashSubmitBtn)  cashSubmitBtn.textContent  = isDeposit ? "DEPOSIT"       : "WITHDRAW";
    if (cashForm)       cashForm.dataset.operation = isDeposit ? "deposit"       : "withdraw";
    cashModal.classList.add("active");
    cashAmountInput?.focus();
  }

  function closeCashModal() {
    cashModal?.classList.remove("active");
    cashForm?.reset();
    cashAmountInput?.classList.remove("field-inp--error");
  }

  cashForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const amount    = parseFloat(cashAmountInput?.value);
    const operation = cashForm.dataset.operation;

    if (!amount || amount <= 0) {
      cashAmountInput?.classList.add("field-inp--error");
      showToast("Please enter a valid amount greater than zero.", "error");
      return;
    }
    cashAmountInput?.classList.remove("field-inp--error");

    const origText = cashSubmitBtn?.textContent;
    if (cashSubmitBtn) { cashSubmitBtn.disabled = true; cashSubmitBtn.textContent = "PROCESSING…"; }

    try {
      const response = await fetch(`/api/portfolios/${currentPortfolioId}/cash/${operation}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || `${operation} failed`);
      }
      showToast(
        `${operation === "deposit" ? "Deposited" : "Withdrew"} ${formatCurrency(amount)} successfully`,
        "success"
      );
      closeCashModal();
      loadSummary();
    } catch (error) {
      showToast(error.message || "Operation failed", "error");
    } finally {
      if (cashSubmitBtn) { cashSubmitBtn.disabled = false; cashSubmitBtn.textContent = origText; }
    }
  });

  /**************************************************************************
   * SECTION 18 · PORTFOLIO HEARTRATE CHART
   **************************************************************************/
  async function loadHeartrate(period) {
    if (!currentPortfolioId) return;
    currentPeriod = period;

    document.querySelectorAll(".period-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.period === period);
    });

    try {
      // Fetch snapshots and (optionally) benchmark data in parallel
      const fetchBenchmark = benchmarkEnabled
        ? fetch(`/api/market/benchmark?symbol=SPY&period=${period}`).then((r) => r.ok ? r.json() : null).catch(() => null)
        : Promise.resolve(null);

      const [resp, benchData] = await Promise.all([
        fetch(`/api/portfolios/${encodeURIComponent(currentPortfolioId)}/snapshots?period=${period}`),
        fetchBenchmark,
      ]);

      if (!resp.ok) return;
      const data      = await resp.json();
      const snapshots = data.snapshots || [];

      if (snapshots.length < 2) {
        if (chartEmptyEl)     chartEmptyEl.style.display    = "flex";
        if (portfolioChartEl) portfolioChartEl.style.display = "none";
        if (heartrateChange)  heartrateChange.textContent   = "";
        if (portfolioChart)   { portfolioChart.destroy(); portfolioChart = null; }
        return;
      }

      if (chartEmptyEl)     chartEmptyEl.style.display    = "none";
      if (portfolioChartEl) portfolioChartEl.style.display = "block";

      if (heartrateChange) {
        const pct = data.pct_change || 0;
        heartrateChange.textContent = formatPercent(pct);
        heartrateChange.style.color = pct >= 0 ? "var(--gain)" : "var(--loss)";
      }

      // Build labels: show slot suffix when multiple data points exist for the same date
      const dateCounts = {};
      snapshots.forEach((s) => { dateCounts[s.date] = (dateCounts[s.date] || 0) + 1; });
      const SLOT_LABEL = { open: "open", midday: "mid", close: "cls", eod: "" };
      const labels = snapshots.map((s) => {
        const suffix = dateCounts[s.date] > 1 && s.slot ? ` ${SLOT_LABEL[s.slot] || s.slot}` : "";
        return s.date + suffix;
      });
      const values    = snapshots.map((s) => s.total_value);
      const portStart = values[0] || 0;
      const isUp      = (values[values.length - 1] || 0) >= portStart;
      const lineColor = isUp ? "#00d97e" : "#ff4560";
      const fillColor = isUp ? "rgba(0,217,126,0.07)" : "rgba(255,69,96,0.07)";

      const datasets = [{
        label:                    "Portfolio",
        data:                     values,
        borderColor:              lineColor,
        backgroundColor:          fillColor,
        borderWidth:              1.5,
        fill:                     true,
        tension:                  0.3,
        pointRadius:              0,
        pointHoverRadius:         4,
        pointHoverBackgroundColor: lineColor,
      }];

      // Build benchmark dataset if data is available
      if (benchData && benchData.data && benchData.data.length > 0 && portStart > 0) {
        const spyByDate = {};
        benchData.data.forEach((d) => { spyByDate[d.date] = d.close; });

        // Find the earliest SPY price aligned to the portfolio period
        const sortedDates = Object.keys(spyByDate).sort();
        const spyStart = sortedDates.length > 0 ? spyByDate[sortedDates[0]] : null;

        if (spyStart) {
          const benchValues = snapshots.map((s) => {
            // Nearest preceding SPY date
            const candidates = sortedDates.filter((d) => d <= s.date);
            const nearest    = candidates.length > 0 ? candidates[candidates.length - 1] : sortedDates[0];
            const spyPrice   = spyByDate[nearest];
            return spyPrice ? parseFloat((portStart * (spyPrice / spyStart)).toFixed(2)) : null;
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

      if (portfolioChart) portfolioChart.destroy();

      const ctx = portfolioChartEl.getContext("2d");
      portfolioChart = new Chart(ctx, {
        type: "line",
        data: { labels, datasets },
        options: {
          responsive:          true,
          maintainAspectRatio: false,
          interaction:         { intersect: false, mode: "index" },
          plugins: {
            legend: {
              display: datasets.length > 1,
              labels: {
                color:     "#6b879e",
                font:      { family: "'IBM Plex Mono', monospace", size: 10 },
                boxWidth:  20,
                usePointStyle: true,
              },
            },
            tooltip: {
              backgroundColor: "#1b2a38",
              borderColor:     "rgba(255,255,255,0.07)",
              borderWidth:     1,
              titleColor:      "#6b879e",
              bodyColor:       "#d8e4ee",
              titleFont: { family: "'IBM Plex Mono', monospace", size: 10 },
              bodyFont:  { family: "'IBM Plex Mono', monospace", size: 12 },
              callbacks: {
                label: (ctx) => ` ${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`,
              },
            },
          },
          scales: {
            x: {
              grid:   { color: "rgba(255,255,255,0.03)" },
              border: { display: false },
              ticks:  {
                color:        "#2e4a60",
                font:         { family: "'IBM Plex Mono', monospace", size: 9 },
                maxTicksLimit: 8,
                maxRotation:   0,
              },
            },
            y: {
              grid:   { color: "rgba(255,255,255,0.03)" },
              border: { display: false },
              ticks:  {
                color: "#2e4a60",
                font:  { family: "'IBM Plex Mono', monospace", size: 9 },
                callback: (v) => "$" + Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }),
              },
            },
          },
        },
      });
    } catch (err) {
      console.error("Heartrate chart error:", err);
    }
  }

  /**************************************************************************
   * SECTION 19 · TICKER TAPE (auto-refresh every 5 min)
   **************************************************************************/
  async function updateTickerTape() {
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

      // Stop any running animation before rebuilding.
      if (tickerAnimId !== null) { cancelAnimationFrame(tickerAnimId); tickerAnimId = null; }
      window.__tickerDiag.running   = false;
      window.__tickerDiag.itemCount = items.length;

      track.style.transform = "translateX(0)";
      track.innerHTML = itemHtml; // single copy — used only to measure content width

      // Double-rAF: first frame queues layout, second frame reads it after paint.
      // A single rAF fires before paint so scrollWidth can still be 0 for new content.
      const startAnimation = (attempt = 1) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const tapeW   = tape.offsetWidth;
            const singleW = track.scrollWidth;

            if (!singleW) {
              if (attempt < 3) {
                console.warn(`[TickerTape] scrollWidth=0 on attempt ${attempt}, retrying…`);
                startAnimation(attempt + 1);
              } else {
                const msg = "[TickerTape] scrollWidth still 0 after 3 attempts — tape hidden or empty.";
                console.error(msg);
                window.__tickerDiag.lastError = msg;
              }
              return;
            }

            const copies = Math.max(2, Math.ceil((tapeW * 2) / singleW) + 1);
            track.innerHTML = Array.from({ length: copies }, () => itemHtml).join("");

            window.__tickerDiag.singleW   = singleW;
            window.__tickerDiag.copies    = copies;
            window.__tickerDiag.lastStart = new Date().toISOString();
            window.__tickerDiag.running   = true;
            window.__tickerDiag.lastError = null;
            console.log(`[TickerTape] started — ${items.length} items, singleW=${singleW}px, copies=${copies}`);

            let pos = 0;
            const step = () => {
              pos -= 0.8;                          // ~48 px/s at 60 fps
              if (pos <= -singleW) pos += singleW; // seamless loop
              track.style.transform = `translateX(${pos}px)`;
              tickerAnimId = requestAnimationFrame(step);
            };
            tickerAnimId = requestAnimationFrame(step);
          });
        });
      };

      startAnimation();
    } catch (e) {
      console.error("[TickerTape] error:", e);
      window.__tickerDiag.lastError = String(e);
    }
  }

  /**************************************************************************
   * SECTION 20 · FEAR & GREED WIDGET
   **************************************************************************/
  function fngColor(score) {
    if (score <= 24) return "#ff4560";
    if (score <= 44) return "#ff7043";
    if (score <= 55) return "#f0b429";
    if (score <= 75) return "#52c41a";
    return "#00d97e";
  }

  function fngLabel(score) {
    const n = Math.round(score || 0);
    if (n <= 24) return "EXTREME FEAR";
    if (n <= 44) return "FEAR";
    if (n <= 55) return "NEUTRAL";
    if (n <= 75) return "GREED";
    return "EXTREME GREED";
  }

  async function loadFearGreed() {
    try {
      const resp = await fetch("/api/market/fear-greed");
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

  /**************************************************************************
   * SECTION 21 · EVENT WIRING + INIT
   **************************************************************************/
  addPositionBtn?.addEventListener("click",  () => openPositionModal(false));
  cancelBtn?.addEventListener("click",       closePositionModal);
  depositCashBtn?.addEventListener("click",  () => openCashModal(true));
  withdrawCashBtn?.addEventListener("click", () => openCashModal(false));
  cashCancelBtn?.addEventListener("click",   closeCashModal);
  backButton?.addEventListener("click",      showLanding);
  uploadPortfolioButton?.addEventListener("click", openFilePicker);
  sellCancelBtn?.addEventListener("click",   closeSellModal);

  // Backdrop click closes modals
  positionModal?.addEventListener("click", (e) => { if (e.target === positionModal) closePositionModal(); });
  cashModal?.addEventListener("click",     (e) => { if (e.target === cashModal)     closeCashModal();     });
  sellModal?.addEventListener("click",     (e) => { if (e.target === sellModal)     closeSellModal();     });

  // Escape closes any open modal
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (positionModal?.classList.contains("active")) closePositionModal();
    if (cashModal?.classList.contains("active"))     closeCashModal();
    if (sellModal?.classList.contains("active"))     closeSellModal();
  });

  portfolioUpload?.addEventListener("change", (e) => uploadPortfolioFile(e.target.files[0]));

  // Column sort header clicks
  document.querySelectorAll(".holdings-table th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      if (sortKey === th.dataset.sort) {
        sortDir = -sortDir;
      } else {
        sortKey = th.dataset.sort;
        sortDir = sortKey === "ticker" ? 1 : -1;
      }
      updateSortHeaders();
      if (lastPortfolioData) renderHoldings(lastPortfolioData);
    });
  });

  // Period selector
  document.querySelectorAll(".period-btn").forEach((btn) => {
    btn.addEventListener("click", () => loadHeartrate(btn.dataset.period));
  });

  // Benchmark toggle
  const benchmarkToggleBtn = document.getElementById("benchmarkToggleBtn");
  benchmarkToggleBtn?.addEventListener("click", () => {
    benchmarkEnabled = !benchmarkEnabled;
    benchmarkToggleBtn.classList.toggle("act-btn--active", benchmarkEnabled);
    benchmarkToggleBtn.textContent = benchmarkEnabled ? "VS SPY ✓" : "VS SPY";
    if (currentPortfolioId) loadHeartrate(currentPeriod);
  });

  // Export history
  exportHistoryBtn?.addEventListener("click", () => {
    if (!currentPortfolioId) return;
    window.location.href = `/api/portfolios/${encodeURIComponent(currentPortfolioId)}/snapshots/export`;
  });

  // Import history
  importHistoryBtn?.addEventListener("click", () => snapshotImportInput?.click());
  snapshotImportInput?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file || !currentPortfolioId) return;
    snapshotImportInput.value = "";
    const origText = importHistoryBtn?.textContent;
    if (importHistoryBtn) { importHistoryBtn.disabled = true; importHistoryBtn.textContent = "IMPORTING…"; }
    try {
      const fd = new FormData();
      fd.append("file", file);
      const resp = await fetch(
        `/api/portfolios/${encodeURIComponent(currentPortfolioId)}/snapshots/import`,
        { method: "POST", body: fd }
      );
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.detail || "Import failed");
      showToast(`Imported ${result.inserted} snapshot(s)`, "success");
      loadHeartrate(currentPeriod);
    } catch (err) {
      showToast(err.message || "Import failed", "error");
    } finally {
      if (importHistoryBtn) { importHistoryBtn.disabled = false; importHistoryBtn.textContent = origText; }
    }
  });

  // Manual snapshot button
  takeSnapshotBtn?.addEventListener("click", async () => {
    if (!currentPortfolioId) return;
    const origText = takeSnapshotBtn?.textContent;
    if (takeSnapshotBtn) { takeSnapshotBtn.disabled = true; takeSnapshotBtn.textContent = "SAVING…"; }
    try {
      const resp = await fetch(
        `/api/portfolios/${encodeURIComponent(currentPortfolioId)}/snapshot`,
        { method: "POST" }
      );
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.detail || "Snapshot failed");
      showToast(`Snapshot saved (slot: ${result.snapshot?.slot || "─"})`, "success");
      loadHeartrate(currentPeriod);
    } catch (err) {
      showToast(err.message || "Snapshot failed", "error");
    } finally {
      if (takeSnapshotBtn) { takeSnapshotBtn.disabled = false; takeSnapshotBtn.textContent = origText; }
    }
  });

  // Panel collapse/expand
  function setupPanelToggle(btnId, panelId) {
    const btn = document.getElementById(btnId);
    const panel = document.getElementById(panelId);
    if (!btn || !panel) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isCollapsed = panel.classList.toggle('collapsed');
      btn.textContent = isCollapsed ? '▶ SHOW' : '⊟ HIDE';
    });
    panel.addEventListener('click', (e) => {
      if (!panel.classList.contains('collapsed')) return;
      e.stopPropagation();
      panel.classList.remove('collapsed');
      btn.textContent = '⊟ HIDE';
    });
  }

  // Detect which page we're on and run the appropriate init
  const isLanding   = !!document.getElementById("landing-page");
  const isDashboard = !!document.getElementById("dashboard-page");

  if (isLanding) {
    loadPortfolios();
  }

  if (isDashboard) {
    setupPanelToggle('aiPaneToggle', 'aiPane');
    setupPanelToggle('heartrateToggle', 'heartrateSection');
    currentPortfolioId = localStorage.getItem("currentPortfolioId") || null;
    if (!currentPortfolioId) {
      // No portfolio selected — send back to landing
      window.location.href = "/";
    } else {
      if (portfolioTitle)     portfolioTitle.textContent     = currentPortfolioId;
      if (currentPortfolioEl) currentPortfolioEl.textContent = currentPortfolioId;
      updateSortHeaders();
      updateStatusIndicators();
      loadSummary();
      updateTickerTape();
      setInterval(updateTickerTape, 5 * 60 * 1000);   // refresh tape every 5 min
      loadFearGreed();
      setInterval(loadFearGreed, 60 * 60 * 1000);      // refresh F&G every 1 hour
    }
  }
});
