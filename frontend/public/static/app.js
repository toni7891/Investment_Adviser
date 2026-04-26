/*****************************************************************************/
/* Investment Strategist Dashboard - Main Application Logic                 */
/* Unified version: Combines features from public/app.js and static/app.js   */
/*****************************************************************************/

document.addEventListener("DOMContentLoaded", () => {
  /****************************************************************************
   * SECTION 1: DOM ELEMENT REFERENCES                                        *
   ****************************************************************************/
  const landingPage = document.getElementById("landing-page");
  const dashboardPage = document.getElementById("dashboard-page");
  const portfolioList = document.getElementById("portfolioList");
  const backButton = document.getElementById("backButton");
  const portfolioTitle = document.getElementById("portfolioTitle");
  const currentPortfolioEl = document.getElementById("currentPortfolio");
  const totalBalanceEl = document.getElementById("totalBalance");
  const totalProfitEl = document.getElementById("totalProfit");
  const dailyChangeEl = document.getElementById("dailyChange");
  const highestGrowthEl = document.getElementById("highestGrowth");
  const investedAmountEl = document.getElementById("investedAmount");
  const cashAmountEl = document.getElementById("cashAmount");

   const chatInput = document.getElementById("chatInput");
   const sendButton = document.getElementById("sendButton");
   const chatMessages = document.getElementById("chatMessages");
   const uploadPortfolioButton = document.getElementById("uploadPortfolioButton");
   const portfolioUpload = document.getElementById("portfolioUpload");
   const uploadDropZone = document.getElementById("uploadDropZone");
   const uploadProgress = document.getElementById("uploadProgress");
    const toastContainer = document.getElementById("toastContainer");
    const webSearchToggle = document.getElementById("webSearchToggle");

    // Cash modal elements
    const cashModal = document.getElementById("cashModal");
    const cashModalTitle = document.getElementById("cashModalTitle");
    const cashForm = document.getElementById("cashForm");
    const cashAmountInput = document.getElementById("cashAmountInput");
    const cashCancelBtn = document.getElementById("cashCancelBtn");
    const cashSubmitBtn = document.getElementById("cashSubmitBtn");

    let currentPortfolioId = null;

  /****************************************************************************
   * SECTION 2: UTILITY FUNCTIONS                                             *
   ****************************************************************************/
  const formatCurrency = (value) =>
    `$${Number(value || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const formatPercent = (value) => {
    const num = Number(value || 0);
    return `${num >= 0 ? "+" : ""}${num.toFixed(2)}%`;
  };

  const setSignedStatus = (el, value, positiveClass = "success", negativeClass = "negative") => {
    if (!el) return;
    el.classList.remove(positiveClass, negativeClass);
    el.classList.add(value >= 0 ? positiveClass : negativeClass);
  };

  /****************************************************************************
   * SECTION 3: UI NAVIGATION FUNCTIONS                                       *
   ****************************************************************************/
  function showDashboard() {
    if (landingPage) landingPage.classList.add("hidden");
    if (dashboardPage) dashboardPage.classList.remove("hidden");
  }

  function showLanding() {
    if (dashboardPage) dashboardPage.classList.add("hidden");
    if (landingPage) landingPage.classList.remove("hidden");
  }

  /****************************************************************************
   * SECTION 4: UPLOAD STATE MANAGEMENT                                       *
   ****************************************************************************/
  function setUploadLoading(isLoading) {
    if (uploadProgress) uploadProgress.classList.toggle("hidden", !isLoading);
    if (uploadPortfolioButton) uploadPortfolioButton.disabled = isLoading;
    if (uploadDropZone) uploadDropZone.classList.toggle("is-loading", isLoading);

    const addCard = document.getElementById("addPortfolioCard");
    if (addCard) {
      addCard.classList.toggle("is-loading", isLoading);
      const labelElement = addCard.querySelector(".add-label");
      if (labelElement) labelElement.textContent = isLoading ? "Uploading..." : "Add Portfolio";
    }
  }

  /****************************************************************************
   * SECTION 5: TOAST NOTIFICATION SYSTEM                                     *
   ****************************************************************************/
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

  /****************************************************************************
   * SECTION 6: FILE UPLOAD HANDLERS                                          *
   ****************************************************************************/
  function openFilePicker(event) {
    if (event) event.preventDefault();
    if (!portfolioUpload) return;
    portfolioUpload.value = "";
    portfolioUpload.click();
  }

  async function uploadPortfolioFile(file) {
    if (!file) return;
    setUploadLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/portfolios/upload", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `Upload failed`);
      showToast(`Uploaded ${data.portfolio_name || "portfolio"} successfully.`, "success");
      await loadPortfolios();
    } catch (error) {
      showToast(error.message || "Failed to upload portfolio.", "error");
    } finally {
      setUploadLoading(false);
    }
  }

  /****************************************************************************
   * SECTION 7: BACKEND STATUS MONITORING                                     *
   ****************************************************************************/
  function updateStatusIndicators() {
    const mongoStatus = document.getElementById("mongoStatus");
    fetch("/api/portfolios/list")
      .then((resp) => {
        if (!resp.ok) throw new Error();
        if (mongoStatus) {
          mongoStatus.textContent = "Connected";
          mongoStatus.style.color = "#10b981";
        }
      })
      .catch(() => {
        if (mongoStatus) {
          mongoStatus.textContent = "Disconnected";
          mongoStatus.style.color = "#ef4444";
        }
      });
  }

  /****************************************************************************
   * SECTION 8: DATA LOADING FUNCTIONS                                        *
   ****************************************************************************/
  function loadSummary() {
    if (!currentPortfolioId) return;

    fetch(`/api/portfolios/${currentPortfolioId}`)
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
      })
      .then((data) => {
        const totalBalance = Number(data.total_balance || 0);
        const totalProfit = Number(data.total_profit || 0);
        const dailyChangePct = Number(data.daily_change_pct || 0);
        const investedValue = Number(data.invested_value || 0);
        const cashValue = Number(data.cash_value || 0);

        if (totalBalanceEl) totalBalanceEl.textContent = formatCurrency(totalBalance);
        if (investedAmountEl) investedAmountEl.textContent = formatCurrency(investedValue);
        if (cashAmountEl) cashAmountEl.textContent = formatCurrency(cashValue);

        if (totalProfitEl) {
          totalProfitEl.textContent = `${totalProfit >= 0 ? "+" : ""}${formatCurrency(totalProfit)}`;
          setSignedStatus(totalProfitEl, totalProfit);
        }

        if (dailyChangeEl) {
          dailyChangeEl.textContent = formatPercent(dailyChangePct);
          setSignedStatus(dailyChangeEl, dailyChangePct);
        }

        if (currentPortfolioEl) currentPortfolioEl.textContent = currentPortfolioId;

        const holdingsBody = document.getElementById("holdingsBody");
        let bestStock = null;

        if (holdingsBody) {
          holdingsBody.innerHTML = "";

          // Sort positions: top performers (highest daily % gain) first
          const sortedPositions = (data.positions || []).sort((a, b) => {
            const changeA = Number(a.daily_change || 0);
            const changeB = Number(b.daily_change || 0);
            return changeB - changeA;  // Descending: highest gain first
          });

          sortedPositions.forEach((stock) => {
            const dayChangePct = Number(stock.daily_change || 0);
            const currentPrice = Number(stock.current_price || 0);
            const averageCost = Number(stock.average_cost || 0);
            const shares = Number(stock.shares || 0);
            const marketValue = Number(stock.market_value || currentPrice * shares);
            const totalPnL = (currentPrice - averageCost) * shares;

            if (!bestStock || dayChangePct > Number(bestStock.daily_change || 0)) {
              bestStock = stock;
            }

             const row = document.createElement("tr");
             row.className = "border-b border-gray-700 hover:bg-gray-800 transition-colors";
             row.innerHTML = `
               <td class="py-3 px-4">${stock.ticker ?? ""}</td>
               <td class="py-3 px-4">${shares}</td>
               <td class="py-3 px-4">${formatCurrency(currentPrice)}</td>
               <td class="py-3 px-4">${formatCurrency(marketValue)}</td>
               <td class="py-3 px-4 ${dayChangePct >= 0 ? "success" : "negative"}">
                 ${formatPercent(dayChangePct)}
               </td>
               <td class="py-3 px-4 ${totalPnL >= 0 ? "success" : "negative"}">
                 ${formatCurrency(totalPnL)}
               </td>
                <td class="py-3 px-4">
                  <button class="btn-edit" data-ticker="${stock.ticker}" title="Edit ${stock.ticker} position">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                    Edit
                  </button>
                  <button class="btn-delete" data-ticker="${stock.ticker}" title="Delete ${stock.ticker} position">
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

          // Attach listeners to new edit/delete buttons
          holdingsBody.querySelectorAll('.btn-edit').forEach(button => {
            button.addEventListener('click', (e) => {
              const ticker = e.target.getAttribute('data-ticker');
              if (!ticker || !currentPortfolioId) return;
              const stock = data.positions.find(p => p.ticker === ticker);
              if (stock) openPositionModal(true, stock);
            });
          });

          holdingsBody.querySelectorAll('.btn-delete').forEach(button => {
            button.addEventListener('click', async (e) => {
              const ticker = e.target.getAttribute('data-ticker');
              if (!ticker || !currentPortfolioId) return;

              if (confirm(`Are you sure you want to delete ${ticker} from your portfolio?`)) {
                try {
                  const response = await fetch(`/api/portfolios/${currentPortfolioId}/positions/${ticker}`, {
                    method: "DELETE",
                  });

                  if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.detail || `HTTP ${response.status}`);
                  }

                  showToast(`Position ${ticker} deleted successfully`, "success");
                  loadSummary(); // Refresh the dashboard
                } catch (error) {
                  console.error("Failed to delete position:", error);
                  showToast(error.message || "Failed to delete position", "error");
                }
              }
            });
          });
        }

        if (highestGrowthEl && bestStock) {
          const bestChange = Number(bestStock.daily_change || 0);
          highestGrowthEl.textContent = `${bestStock.ticker} (${formatPercent(bestChange)})`;
          setSignedStatus(highestGrowthEl, bestChange);
        }
        updateStatusIndicators();
      })
      .catch((err) => {
        console.error("Load Summary Error:", err);
        if (totalBalanceEl) totalBalanceEl.textContent = "Error";
      });
  }

  async function loadPortfolios() {
    if (!portfolioList) return;
    try {
      const response = await fetch("/api/portfolios/list");
      const data = await response.json();
      const names = data.portfolios || [];
      portfolioList.innerHTML = "";

      if (names.length === 0) {
        portfolioList.innerHTML = '<div class="portfolio-card portfolio-card--empty">No portfolios found</div>';
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

        // Open portfolio on card click (ignore clicks on delete button)
        card.addEventListener("click", (e) => {
          if (e.target.closest(".portfolio-card__delete")) return;
          currentPortfolioId = name;
          if (portfolioTitle) portfolioTitle.textContent = name;
          showDashboard();
          loadSummary();
        });

        // Keyboard: Enter/Space to open
        card.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            currentPortfolioId = name;
            if (portfolioTitle) portfolioTitle.textContent = name;
            showDashboard();
            loadSummary();
          }
        });

        // Delete button handler
        const deleteBtn = card.querySelector(".portfolio-card__delete");
        deleteBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (!confirm(`Delete portfolio "${name}"? This cannot be undone.`)) return;

          try {
            const response = await fetch(`/api/portfolios/${encodeURIComponent(name)}`, {
              method: "DELETE"
            });

            if (response.ok) {
              // Remove card from DOM with fade effect
              card.style.opacity = "0";
              card.style.transform = "scale(0.9)";
              setTimeout(() => card.remove(), 200);
              showToast(`Portfolio "${name}" deleted`, "success");

              // If current open portfolio was deleted, go back to landing
              if (currentPortfolioId === name) {
                currentPortfolioId = null;
                showLanding();
                loadPortfolios();
              }
            } else {
              const err = await response.json().catch(() => ({}));
              showToast(err.detail || "Failed to delete portfolio", "error");
            }
          } catch (err) {
            console.error("Delete portfolio error:", err);
            showToast("Network error while deleting", "error");
          }
        });

        portfolioList.appendChild(card);
      });
    } catch (err) {
      console.error("Load Portfolios Error:", err);
    }
  }

  /****************************************************************************
   * SECTION 9: AI CHAT FUNCTIONALITY                                        *
   ****************************************************************************/
  const escapeHtml = (text) => {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(text).replace(/[&<>"']/g, (m) => map[m]);
  };

  const addChatMessage = (content, isUser) => {
    if (!chatMessages) return;
    const messageDiv = document.createElement("div");
    messageDiv.className = `message ${isUser ? "user" : "bot"}`;
    messageDiv.innerHTML = `<p>${escapeHtml(content)}</p>`;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  };

  const handleSendMessage = async () => {
    const message = chatInput.value.trim();
    if (!message) return;
    addChatMessage(message, true);
    chatInput.value = "";

    const loadingId = "loading-" + Date.now();
    const loadingDiv = document.createElement("div");
    loadingDiv.id = loadingId;
    loadingDiv.className = "message bot loading";
    loadingDiv.innerHTML = `<p><em>AI is thinking...</em></p>`;
    chatMessages.appendChild(loadingDiv);

     try {
       const response = await fetch("/api/chat", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({
           message,
           portfolio_id: currentPortfolioId || "",
           use_web_search: webSearchToggle?.checked ?? true
         }),
       });
       const data = await response.json();
       document.getElementById(loadingId)?.remove();
       addChatMessage(data.response, false);
     } catch (error) {
       document.getElementById(loadingId)?.remove();
       addChatMessage("Error: Connection failed.", false);
     }
  };

  sendButton?.addEventListener("click", handleSendMessage);
  chatInput?.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
  });

  /****************************************************************************
   * SECTION 10 & 11: MODAL & CASH FUNCTIONALITY                              *
   ****************************************************************************/
   const positionModal = document.getElementById("positionModal");
   const modalTitle = document.getElementById("modalTitle");
   const positionForm = document.getElementById("positionForm");
   const tickerInput = document.getElementById("tickerInput");
   const sharesInput = document.getElementById("sharesInput");
   const costInput = document.getElementById("costInput");
   const cancelBtn = document.getElementById("cancelBtn");

   let isEditing = false;
   let originalTicker = null;

   function openPositionModal(isEdit = false, stockData = null) {
     if (!positionModal) return;
     
     isEditing = isEdit;
     originalTicker = stockData ? stockData.ticker : null;
     
     modalTitle.textContent = isEdit ? "Edit Position" : "Add Position";
     
     if (isEdit && stockData) {
       tickerInput.value = stockData.ticker || "";
       tickerInput.disabled = true;  // Lock ticker during edit
       sharesInput.value = stockData.shares || "";
       costInput.value = stockData.average_cost || "";
     } else {
       tickerInput.value = "";
       tickerInput.disabled = false;
       sharesInput.value = "";
       costInput.value = "";
     }
     
     positionModal.classList.add("active");
     tickerInput.focus();
   }

  function closePositionModal() {
    positionModal?.classList.remove("active");
    positionForm?.reset();
  }

  function openCashModal(isDeposit = true) {
    if (!cashModal) return;
    cashModalTitle.textContent = isDeposit ? "Deposit Cash" : "Withdraw Cash";
    cashSubmitBtn.textContent = isDeposit ? "Deposit" : "Withdraw";
    cashForm.dataset.operation = isDeposit ? "deposit" : "withdraw";
    cashModal.classList.add("active");
    cashAmountInput.focus();
  }

  function closeCashModal() {
    cashModal?.classList.remove("active");
    cashForm?.reset();
  }

   positionForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const ticker = tickerInput.value.trim().toUpperCase();
    const shares = parseFloat(sharesInput.value);
    const average_cost = parseFloat(costInput.value);

    // Client-side ticker format validation (basic)
    const tickerRegex = /^[A-Z0-9]{1,6}(\.[A-Z])?$/;
    if (!tickerRegex.test(ticker)) {
      showToast(`Invalid ticker format: '${ticker}'. Use 1-6 uppercase letters/digits.`, "error");
      return;
    }

    try {
      const response = await fetch(`/api/portfolios/${currentPortfolioId}/positions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, shares, average_cost }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const msg = errData.detail || `Save failed (${response.status})`;
        throw new Error(msg);
      }

      showToast("Saved successfully", "success");
      closePositionModal();
      loadSummary();
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  cashForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const amount = parseFloat(cashAmountInput.value);
    const operation = cashForm.dataset.operation;
    try {
      const response = await fetch(`/api/portfolios/${currentPortfolioId}/cash/${operation}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      if (!response.ok) throw new Error(`${operation} failed`);
      showToast(`Success: ${operation}`, "success");
      closeCashModal();
      loadSummary();
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  addPositionBtn?.addEventListener("click", () => openPositionModal(false));
  cancelBtn?.addEventListener("click", closePositionModal);
  depositCashBtn?.addEventListener("click", () => openCashModal(true));
  withdrawCashBtn?.addEventListener("click", () => openCashModal(false));
  cashCancelBtn?.addEventListener("click", closeCashModal);
  backButton?.addEventListener("click", showLanding);
  uploadPortfolioButton?.addEventListener("click", openFilePicker);

  portfolioUpload?.addEventListener("change", (e) => uploadPortfolioFile(e.target.files[0]));

  updateStatusIndicators();
  loadPortfolios();
});