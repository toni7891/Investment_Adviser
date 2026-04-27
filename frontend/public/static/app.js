/*****************************************************************************/
/* Investment Strategist Dashboard — Main Application Logic  v4.2           */
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
  const dailyChangeEl      = document.getElementById("dailyChange");
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

  // Position modal
  const positionModal = document.getElementById("positionModal");
  const modalTitle    = document.getElementById("modalTitle");
  const positionForm  = document.getElementById("positionForm");
  const tickerInput   = document.getElementById("tickerInput");
  const sharesInput   = document.getElementById("sharesInput");
  const costInput     = document.getElementById("costInput");
  const cancelBtn     = document.getElementById("cancelBtn");

  /**************************************************************************
   * SECTION 2 · STATE
   **************************************************************************/
  let currentPortfolioId = null;
  let isEditing          = false;
  let lastPortfolioData  = null;

  // Sort state — default: descending by daily change
  let sortKey = "daily_change";
  let sortDir = -1; // -1 = descending, 1 = ascending

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
    landingPage?.classList.add("hidden");
    dashboardPage?.classList.remove("hidden");
  }

  function showLanding() {
    dashboardPage?.classList.add("hidden");
    landingPage?.classList.remove("hidden");
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
    const mongoStatus  = document.getElementById("mongoStatus");
    const mongoStatusDot = document.getElementById("mongoStatusDot");
    fetch("/api/portfolios/list")
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
    // Augment each position with computed fields needed for sort keys
    const augmented = positions.map((p) => {
      const price = Number(p.current_price || 0);
      const cost  = Number(p.average_cost  || 0);
      return {
        ...p,
        total_pnl:     Number(p.pl || 0),
        total_pnl_pct: cost > 0 ? ((price - cost) / cost) * 100 : 0,
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
   * SECTION 12 · HOLDINGS RENDERER (sort + DOM, no fetch)
   **************************************************************************/
  function renderHoldings(data) {
    const totalValue   = Number(data.total_balance || 0);
    const holdingsBody = document.getElementById("holdingsBody");
    if (!holdingsBody) return;
    holdingsBody.innerHTML = "";

    let bestStock = null;
    const sorted  = sortPositions(data.positions || []);

    sorted.forEach((stock) => {
      const dayChangePct = Number(stock.daily_change  || 0);
      const currentPrice = Number(stock.current_price || 0);
      const shares       = Number(stock.shares        || 0);
      const marketValue  = Number(stock.market_value  || currentPrice * shares);
      const totalPnL     = Number(stock.total_pnl     || 0);
      const totalPnLPct  = Number(stock.total_pnl_pct || 0);
      const allocPct     = totalValue > 0 ? (marketValue / totalValue) * 100 : 0;

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
        <td class="col-num ${dayChangePct >= 0 ? "success" : "negative"}">${formatPercent(dayChangePct)}</td>
        <td class="col-num ${totalPnLPct  >= 0 ? "success" : "negative"}">${formatPercent(totalPnLPct)}</td>
        <td class="col-num ${totalPnL    >= 0 ? "success" : "negative"}">${formatCurrency(totalPnL)}</td>
        <td class="col-ops">
          <button class="btn-edit"   data-ticker="${stock.ticker}" title="Edit ${stock.ticker}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            Edit
          </button>
          <button class="btn-delete" data-ticker="${stock.ticker}" title="Delete ${stock.ticker}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
            Delete
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

    // Delete buttons
    holdingsBody.querySelectorAll(".btn-delete").forEach((button) => {
      button.addEventListener("click", async () => {
        const ticker = button.dataset.ticker;
        if (!ticker || !currentPortfolioId) return;

        const confirmed = await showConfirm(
          "DELETE POSITION",
          `Remove ${ticker} from this portfolio? This cannot be undone.`
        );
        if (!confirmed) return;

        try {
          const response = await fetch(
            `/api/portfolios/${currentPortfolioId}/positions/${ticker}`,
            { method: "DELETE" }
          );
          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.detail || `HTTP ${response.status}`);
          }
          showToast(`${ticker} removed from portfolio`, "success");
          loadSummary();
        } catch (error) {
          showToast(error.message || "Failed to delete position", "error");
        }
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

        const totalBalance   = Number(data.total_balance   || 0);
        const totalProfit    = Number(data.total_profit    || 0);
        const dailyChangePct = Number(data.daily_change_pct || 0);
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
        if (currentPortfolioEl) currentPortfolioEl.textContent = currentPortfolioId;

        renderHoldings(data);
        updateStatusIndicators();
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
          currentPortfolioId = name;
          if (portfolioTitle) portfolioTitle.textContent = name;
          showDashboard();
          loadSummary();
        });

        card.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            currentPortfolioId = name;
            if (portfolioTitle) portfolioTitle.textContent = name;
            showDashboard();
            loadSummary();
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
   * SECTION 15 · POSITION MODAL
   **************************************************************************/
  function openPositionModal(isEdit = false, stockData = null) {
    if (!positionModal) return;
    isEditing = isEdit;
    if (modalTitle) modalTitle.textContent = isEdit ? "EDIT POSITION" : "ADD POSITION";

    if (isEdit && stockData) {
      if (tickerInput) { tickerInput.value = stockData.ticker || ""; tickerInput.disabled = true; }
      if (sharesInput) sharesInput.value = stockData.shares || "";
      if (costInput)   costInput.value   = stockData.average_cost || "";
    } else {
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
  }

  tickerInput?.addEventListener("input", () => setFieldError(tickerInput, ""));
  sharesInput?.addEventListener("input", () => setFieldError(sharesInput, ""));
  costInput?.addEventListener("input",   () => setFieldError(costInput,   ""));

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
        body: JSON.stringify({ ticker, shares, average_cost }),
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

      showToast(`${ticker} saved successfully`, "success");
      closePositionModal();
      loadSummary();
    } catch (error) {
      showToast(error.message || "Network error", "error");
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = origText; }
    }
  });

  /**************************************************************************
   * SECTION 16 · CASH MODAL
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
   * SECTION 17 · EVENT WIRING + INIT
   **************************************************************************/
  addPositionBtn?.addEventListener("click",  () => openPositionModal(false));
  cancelBtn?.addEventListener("click",       closePositionModal);
  depositCashBtn?.addEventListener("click",  () => openCashModal(true));
  withdrawCashBtn?.addEventListener("click", () => openCashModal(false));
  cashCancelBtn?.addEventListener("click",   closeCashModal);
  backButton?.addEventListener("click",      showLanding);
  uploadPortfolioButton?.addEventListener("click", openFilePicker);

  // Backdrop click closes modals
  positionModal?.addEventListener("click", (e) => { if (e.target === positionModal) closePositionModal(); });
  cashModal?.addEventListener("click",     (e) => { if (e.target === cashModal)     closeCashModal(); });

  // Escape closes any open modal
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (positionModal?.classList.contains("active")) closePositionModal();
    if (cashModal?.classList.contains("active"))     closeCashModal();
  });

  portfolioUpload?.addEventListener("change", (e) => uploadPortfolioFile(e.target.files[0]));

  // Column sort header clicks — re-render cached data, no re-fetch
  document.querySelectorAll(".holdings-table th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      if (sortKey === th.dataset.sort) {
        sortDir = -sortDir;
      } else {
        sortKey = th.dataset.sort;
        sortDir = sortKey === "ticker" ? 1 : -1; // ticker defaults ascending
      }
      updateSortHeaders();
      if (lastPortfolioData) renderHoldings(lastPortfolioData);
    });
  });

  // Initial state
  updateSortHeaders();
  updateStatusIndicators();
  loadPortfolios();
});
