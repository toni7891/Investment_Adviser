/*****************************************************************************/
/* Investment Strategist Dashboard - Main Application Logic                 */
/* Unified version: Combines features from public/app.js and static/app.js   */
/*****************************************************************************/

// Wait for the DOM to fully load before executing JavaScript
document.addEventListener("DOMContentLoaded", () => {
  /****************************************************************************
   * SECTION 1: DOM ELEMENT REFERENCES                                        *
   * Cache references to frequently-used elements for better performance      *
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

  // Chat elements
  const chatInput = document.getElementById("chatInput");
  const sendButton = document.getElementById("sendButton");
  const chatMessages = document.getElementById("chatMessages");
  const uploadPortfolioButton = document.getElementById("uploadPortfolioButton");
  const portfolioUpload = document.getElementById("portfolioUpload");
  const uploadDropZone = document.getElementById("uploadDropZone");
  const uploadProgress = document.getElementById("uploadProgress");
  const toastContainer = document.getElementById("toastContainer");

  // Store the currently selected portfolio ID (null initially)
  let currentPortfolioId = null;

  /****************************************************************************
   * SECTION 2: UTILITY FUNCTIONS                                             *
   * Helper functions for formatting and UI updates                           *
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
   * Handle switching between landing page and dashboard view                 *
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
   * Handle UI states during file upload operations                          *
   ****************************************************************************/

  function setUploadLoading(isLoading) {
    if (uploadProgress) {
      uploadProgress.classList.toggle("hidden", !isLoading);
    }
    if (uploadPortfolioButton) {
      uploadPortfolioButton.disabled = isLoading;
    }
    if (uploadDropZone) {
      uploadDropZone.classList.toggle("is-loading", isLoading);
    }

    const addCard = document.getElementById("addPortfolioCard");
    if (addCard) {
      addCard.classList.toggle("is-loading", isLoading);
      const labelElement = addCard.querySelector(".add-label");
      if (labelElement && isLoading) {
        labelElement.textContent = "Uploading...";
      } else if (labelElement) {
        labelElement.textContent = "Add Portfolio";
      }
    }
  }

  /****************************************************************************
   * SECTION 5: TOAST NOTIFICATION SYSTEM                                     *
   * Display temporary status messages to the user                            *
   ****************************************************************************/

  function showToast(message, type = "error") {
    if (!toastContainer) return;

    const toast = document.createElement("div");
    toast.className = `toast toast--${type}`;
    toast.textContent = message;

    toastContainer.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add("toast--visible");
    }, 10);

    window.setTimeout(() => {
      toast.classList.remove("toast--visible");
      window.setTimeout(() => {
        toast.remove();
      }, 300);
    }, 3800);
  }

  /****************************************************************************
   * SECTION 6: FILE UPLOAD HANDLERS                                          *
   * Handle triggering file selection for portfolio uploads                   *
   ****************************************************************************/

  function openFilePicker(event) {
    if (event) {
      event.preventDefault();
    }

    if (!portfolioUpload) return;

    if (typeof portfolioUpload.showPicker === "function") {
      try {
        portfolioUpload.showPicker();
        return;
      } catch (showPickerError) {
        console.warn("showPicker failed, falling back to click()", showPickerError);
      }
    }

    portfolioUpload.value = "";
    portfolioUpload.click();
  }

  async function uploadPortfolioFile(file) {
    if (!file) return;

    setUploadLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/portfolios/upload", {
        method: "POST",
        body: formData,
      });

      let data = {};
      try {
        data = await response.json();
      } catch (parseError) {
        data = {};
      }

      if (!response.ok) {
        throw new Error(data.detail || `Upload failed with HTTP ${response.status}`);
      }

      showToast(`Uploaded ${data.portfolio_name || "portfolio"} successfully.`, "success");
      await loadPortfolios();
    } catch (error) {
      console.error("Failed to upload portfolio", error);
      showToast(error.message || "Failed to upload portfolio.", "error");
    } finally {
      setUploadLoading(false);
    }
  }


  /****************************************************************************
   * SECTION 7: BACKEND STATUS MONITORING                                     *
   * Check if MongoDB connection is active                                    *
   ****************************************************************************/

  function updateStatusIndicators() {
    const mongoStatus = document.getElementById("mongoStatus");

    fetch("/api/portfolios/list")
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
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
   * Fetch portfolio data from backend API endpoints                          *
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
          totalProfitEl.style.color = "";
        }

        if (dailyChangeEl) {
          dailyChangeEl.textContent = formatPercent(dailyChangePct);
          setSignedStatus(dailyChangeEl, dailyChangePct);
          dailyChangeEl.style.color = "";
        }

        if (currentPortfolioEl) {
          currentPortfolioEl.textContent = currentPortfolioId;
        }

        const holdingsBody = document.getElementById("holdingsBody");
        let bestStock = null;

        if (holdingsBody) {
          holdingsBody.innerHTML = "";

          (data.positions || []).forEach((stock) => {
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
            `;
            holdingsBody.appendChild(row);
          });
        }

        if (highestGrowthEl && bestStock) {
          const bestChange = Number(bestStock.daily_change || 0);
          highestGrowthEl.textContent = `${bestStock.ticker} (${formatPercent(bestChange)})`;
          setSignedStatus(highestGrowthEl, bestChange);
          highestGrowthEl.style.color = "";
        }

        updateStatusIndicators();
      })
      .catch((err) => {
        console.error("Failed to load portfolio summary", err);
        if (totalBalanceEl) totalBalanceEl.textContent = "Error";
      });
  }

  async function loadPortfolios() {
    if (!portfolioList) return;

    try {
      const response = await fetch("/api/portfolios/list");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      const names = data.portfolios || [];
      portfolioList.innerHTML = "";

      if (names.length === 0) {
        const emptyCard = document.createElement("div");
        emptyCard.className = "portfolio-card portfolio-card--empty";
        emptyCard.innerHTML = `
          <div class="portfolio-card__title">No portfolios found</div>
          <div class="portfolio-card__meta">Upload an Excel template to create your first portfolio.</div>
        `;
        portfolioList.appendChild(emptyCard);
      }

      names.forEach((name) => {
        const btn = document.createElement("button");
        btn.className = "portfolio-card";
        btn.type = "button";
        btn.innerHTML = `
          <div class="portfolio-card__title">${name}</div>
          <div class="portfolio-card__meta">Open portfolio</div>
        `;
        btn.addEventListener("click", () => {
          currentPortfolioId = name;
          if (portfolioTitle) portfolioTitle.textContent = name;
          showDashboard();
          loadSummary();
        });
        portfolioList.appendChild(btn);
      });

    } catch (err) {
      console.error("Failed to load portfolios", err);
      portfolioList.innerHTML = `
        <div class="portfolio-card portfolio-card--empty">
          <div class="portfolio-card__title">Failed to load portfolios</div>
          <div class="portfolio-card__meta">Please refresh the page and try again.</div>
        </div>
      `;
    }
  }

  /****************************************************************************
   * SECTION 9: AI CHAT FUNCTIONALITY                                        *
   * Handles communication with LM Studio via backend                         *
   ****************************************************************************/

  const escapeHtml = (text) => {
    const map = {
      '&': '\u0026',
      '<': '\u003c',
      '>': '\u003e',
      '"': '\u0022',
      "'": '\u0027',
    };
    return String(text).replace(/[&<>"']/g, (m) => map[m]);
  };

  const scrollToChatBottom = () => {
    setTimeout(() => {
      if (chatMessages) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    }, 50);
  };

  const addChatMessage = (content, isUser) => {
    if (!chatMessages) return;

    const messageDiv = document.createElement("div");
    messageDiv.className = `message ${isUser ? "user" : "bot"}`;
    messageDiv.innerHTML = `<p>${escapeHtml(content)}</p>`;
    chatMessages.appendChild(messageDiv);
    scrollToChatBottom();
  };

  const handleSendMessage = async () => {
    if (!chatInput || !sendButton) return;

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
    scrollToChatBottom();

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      document.getElementById(loadingId)?.remove();
      addChatMessage(data.response, false);
    } catch (error) {
      console.error("Chat error:", error);
      document.getElementById(loadingId)?.remove();
      addChatMessage(
        `Error: ${error.message}. Make sure LM Studio is running on port 1234.`,
        false
      );
    }
  };

  if (sendButton) {
    sendButton.addEventListener("click", handleSendMessage);
  }

  if (chatInput) {
    chatInput.addEventListener("keypress", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleSendMessage();
      }
    });
  }

  /****************************************************************************
   * SECTION 10: EVENT LISTENERS & INITIALIZATION                             *
   * Wire up all interactive elements                                         *
   ****************************************************************************/

  backButton?.addEventListener("click", showLanding);
  uploadPortfolioButton?.addEventListener("click", openFilePicker);

  portfolioUpload?.addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    uploadPortfolioFile(file);
  });

  if (uploadDropZone) {
    const preventDefaults = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
      uploadDropZone.addEventListener(eventName, preventDefaults, false);
    });

    ["dragenter", "dragover"].forEach((eventName) => {
      uploadDropZone.addEventListener(eventName, () => {
        uploadDropZone.classList.add("drag-active");
      });
    });

    ["dragleave", "drop"].forEach((eventName) => {
      uploadDropZone.addEventListener(eventName, () => {
        uploadDropZone.classList.remove("drag-active");
      });
    });

    uploadDropZone.addEventListener("drop", (event) => {
      const files = event.dataTransfer?.files;
      if (files && files.length > 0) {
        uploadPortfolioFile(files[0]);
      }
    });

    uploadDropZone.addEventListener("click", (event) => {
      if (event.target === uploadDropZone) {
        openFilePicker();
      }
    });
  }

  updateStatusIndicators();
  loadPortfolios();
});

