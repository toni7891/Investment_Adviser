// Ref: [[state.js]] [[formatters.js]] [[ui.js]] [[portfolio.js]] [[app.js]] [[PROJECT_MAP.md]]
import { state } from "./state.js";
import { formatCurrency } from "./formatters.js";
import { showToast, setFieldError, clearFieldErrors } from "./ui.js";
import { loadSummary } from "./portfolio.js";

// ─── Buy / Edit position modal ────────────────────────────────────────────────
function updateBuyCost() {
  const buyCostDisplay = document.getElementById("buyCostDisplay");
  const sharesInput    = document.getElementById("sharesInput");
  const costInput      = document.getElementById("costInput");
  if (!buyCostDisplay || state.isEditing) return;
  const total = (parseFloat(sharesInput?.value) || 0) * (parseFloat(costInput?.value) || 0);
  buyCostDisplay.textContent = total > 0 ? `TOTAL COST: ${formatCurrency(total)}` : "";
}

export function openPositionModal(isEdit = false, stockData = null) {
  const positionModal        = document.getElementById("positionModal");
  const modalTitle           = document.getElementById("modalTitle");
  const availableCashGroup   = document.getElementById("availableCashGroup");
  const availableCashDisplay = document.getElementById("availableCashDisplay");
  const buyCostDisplay       = document.getElementById("buyCostDisplay");
  const tickerInput          = document.getElementById("tickerInput");
  const sharesInput          = document.getElementById("sharesInput");
  const costInput            = document.getElementById("costInput");
  if (!positionModal) return;
  state.isEditing = isEdit;

  if (isEdit) {
    if (modalTitle)         modalTitle.textContent          = "EDIT POSITION";
    if (availableCashGroup) availableCashGroup.style.display = "none";
    if (buyCostDisplay)     buyCostDisplay.textContent      = "";
    if (tickerInput)  { tickerInput.value = stockData?.ticker || ""; tickerInput.disabled = true; }
    if (sharesInput)  sharesInput.value = stockData?.shares || "";
    if (costInput)    costInput.value   = stockData?.average_cost || "";
  } else {
    if (modalTitle)         modalTitle.textContent          = "BUY POSITION";
    if (availableCashGroup) availableCashGroup.style.display = "";
    if (availableCashDisplay) availableCashDisplay.textContent = formatCurrency(state.lastPortfolioData?.cash_value || 0);
    if (buyCostDisplay)     buyCostDisplay.textContent      = "";
    if (tickerInput)  { tickerInput.value = ""; tickerInput.disabled = false; }
    if (sharesInput)  sharesInput.value = "";
    if (costInput)    costInput.value   = "";
  }

  clearFieldErrors(positionModal);
  positionModal.classList.add("active");
  (isEdit ? sharesInput : tickerInput)?.focus();
}

export function closePositionModal() {
  const positionModal = document.getElementById("positionModal");
  const tickerInput   = document.getElementById("tickerInput");
  const buyCostDisplay = document.getElementById("buyCostDisplay");
  positionModal?.classList.remove("active");
  document.getElementById("positionForm")?.reset();
  clearFieldErrors(positionModal);
  if (tickerInput) tickerInput.disabled = false;
  if (buyCostDisplay) buyCostDisplay.textContent = "";
}

export function initPositionModal() {
  const positionModal = document.getElementById("positionModal");
  const positionForm  = document.getElementById("positionForm");
  const tickerInput   = document.getElementById("tickerInput");
  const sharesInput   = document.getElementById("sharesInput");
  const costInput     = document.getElementById("costInput");
  const cancelBtn     = document.getElementById("cancelBtn");

  tickerInput?.addEventListener("input", () => setFieldError(tickerInput, ""));
  sharesInput?.addEventListener("input", () => { setFieldError(sharesInput, ""); updateBuyCost(); });
  costInput?.addEventListener("input",   () => { setFieldError(costInput,   ""); updateBuyCost(); });
  cancelBtn?.addEventListener("click",   closePositionModal);
  positionModal?.addEventListener("click", (e) => { if (e.target === positionModal) closePositionModal(); });

  positionForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const ticker       = tickerInput?.value.trim().toUpperCase() || "";
    const shares       = parseFloat(sharesInput?.value);
    const average_cost = parseFloat(costInput?.value);
    let hasError = false;

    if (!state.isEditing && !/^[A-Z0-9]{1,6}(\.[A-Z])?$/.test(ticker)) {
      setFieldError(tickerInput, "Use 1–6 uppercase letters/digits (e.g. AAPL)");
      hasError = true;
    }
    if (!shares || shares <= 0) { setFieldError(sharesInput, "Must be a positive number"); hasError = true; }
    if (isNaN(average_cost) || average_cost < 0) { setFieldError(costInput, "Must be zero or greater"); hasError = true; }
    if (hasError) return;

    const submitBtn = positionForm.querySelector('[type="submit"]');
    const origText  = submitBtn?.textContent;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "SAVING…"; }

    try {
      const response = await fetch(`/api/portfolios/${state.currentPortfolioId}/positions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, shares, average_cost, action: state.isEditing ? "edit" : "buy" }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const msg = errData.detail || `Save failed (${response.status})`;
        if (!state.isEditing && (msg.toLowerCase().includes("ticker") || msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("invalid"))) {
          setFieldError(tickerInput, msg);
        } else {
          showToast(msg, "error");
        }
        return;
      }
      showToast(`${ticker} ${state.isEditing ? "updated" : "bought"} successfully`, "success");
      closePositionModal();
      loadSummary();
    } catch (error) {
      showToast(error.message || "Network error", "error");
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = origText; }
    }
  });
}

// ─── Sell modal ───────────────────────────────────────────────────────────────
function updateSellProceeds() {
  const sellSharesInput    = document.getElementById("sellSharesInput");
  const sellPriceInput     = document.getElementById("sellPriceInput");
  const sellProceedsDisplay = document.getElementById("sellProceedsDisplay");
  const proceeds = (parseFloat(sellSharesInput?.value) || 0) * (parseFloat(sellPriceInput?.value) || 0);
  if (sellProceedsDisplay) {
    sellProceedsDisplay.textContent = proceeds > 0 ? `PROCEEDS: ${formatCurrency(proceeds)}` : "";
  }
}

export function openSellModal(ticker, availableShares, currentPrice) {
  const sellModal          = document.getElementById("sellModal");
  const sellTickerLabel    = document.getElementById("sellTickerLabel");
  const sellAvailableLabel = document.getElementById("sellAvailableLabel");
  const sellSharesInput    = document.getElementById("sellSharesInput");
  const sellPriceInput     = document.getElementById("sellPriceInput");
  const sellProceedsDisplay = document.getElementById("sellProceedsDisplay");
  if (!sellModal) return;
  state.sellTicker    = ticker;
  state.sellMaxShares = availableShares;

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

export function closeSellModal() {
  const sellModal = document.getElementById("sellModal");
  sellModal?.classList.remove("active");
  document.getElementById("sellForm")?.reset();
  clearFieldErrors(sellModal);
  state.sellTicker    = null;
  state.sellMaxShares = 0;
}

export function initSellModal() {
  const sellModal       = document.getElementById("sellModal");
  const sellForm        = document.getElementById("sellForm");
  const sellSharesInput = document.getElementById("sellSharesInput");
  const sellPriceInput  = document.getElementById("sellPriceInput");
  const sellCancelBtn   = document.getElementById("sellCancelBtn");
  const sellSubmitBtn   = document.getElementById("sellSubmitBtn");

  sellSharesInput?.addEventListener("input", () => { setFieldError(sellSharesInput, ""); updateSellProceeds(); });
  sellPriceInput?.addEventListener("input",  () => { setFieldError(sellPriceInput,  ""); updateSellProceeds(); });
  sellCancelBtn?.addEventListener("click",   closeSellModal);
  sellModal?.addEventListener("click", (e) => { if (e.target === sellModal) closeSellModal(); });

  sellForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const shares     = parseFloat(sellSharesInput?.value);
    const sell_price = parseFloat(sellPriceInput?.value);
    let hasError = false;

    if (!shares || shares <= 0) { setFieldError(sellSharesInput, "Must be a positive number"); hasError = true; }
    else if (shares > state.sellMaxShares + 0.0001) { setFieldError(sellSharesInput, `Cannot exceed ${state.sellMaxShares} available shares`); hasError = true; }
    if (isNaN(sell_price) || sell_price < 0) { setFieldError(sellPriceInput, "Must be zero or greater"); hasError = true; }
    if (hasError) return;

    const origText = sellSubmitBtn?.textContent;
    if (sellSubmitBtn) { sellSubmitBtn.disabled = true; sellSubmitBtn.textContent = "PROCESSING…"; }

    try {
      const response = await fetch(
        `/api/portfolios/${state.currentPortfolioId}/positions/${encodeURIComponent(state.sellTicker)}/sell`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shares, sell_price }) }
      );
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        showToast(errData.detail || `Sell failed (${response.status})`, "error");
        return;
      }
      const result = await response.json();
      showToast(`Sold ${shares} shares of ${state.sellTicker} — ${formatCurrency(result.proceeds)} added to cash`, "success");
      closeSellModal();
      loadSummary();
    } catch (error) {
      showToast(error.message || "Network error", "error");
    } finally {
      if (sellSubmitBtn) { sellSubmitBtn.disabled = false; sellSubmitBtn.textContent = origText; }
    }
  });
}

// ─── Cash modal ───────────────────────────────────────────────────────────────
export function openCashModal(isDeposit = true) {
  const cashModal      = document.getElementById("cashModal");
  const cashModalTitle = document.getElementById("cashModalTitle");
  const cashSubmitBtn  = document.getElementById("cashSubmitBtn");
  const cashForm       = document.getElementById("cashForm");
  const cashAmountInput = document.getElementById("cashAmountInput");
  if (!cashModal) return;
  if (cashModalTitle) cashModalTitle.textContent = isDeposit ? "DEPOSIT CASH"  : "WITHDRAW CASH";
  if (cashSubmitBtn)  cashSubmitBtn.textContent  = isDeposit ? "DEPOSIT"       : "WITHDRAW";
  if (cashForm)       cashForm.dataset.operation = isDeposit ? "deposit"       : "withdraw";
  cashModal.classList.add("active");
  cashAmountInput?.focus();
}

export function closeCashModal() {
  const cashModal       = document.getElementById("cashModal");
  const cashAmountInput = document.getElementById("cashAmountInput");
  cashModal?.classList.remove("active");
  document.getElementById("cashForm")?.reset();
  cashAmountInput?.classList.remove("field-inp--error");
}

export function initCashModal() {
  const cashModal       = document.getElementById("cashModal");
  const cashForm        = document.getElementById("cashForm");
  const cashAmountInput = document.getElementById("cashAmountInput");
  const cashCancelBtn   = document.getElementById("cashCancelBtn");
  const cashSubmitBtn   = document.getElementById("cashSubmitBtn");

  cashCancelBtn?.addEventListener("click", closeCashModal);
  cashModal?.addEventListener("click", (e) => { if (e.target === cashModal) closeCashModal(); });

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
      const response = await fetch(`/api/portfolios/${state.currentPortfolioId}/cash/${operation}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || `${operation} failed`);
      }
      showToast(`${operation === "deposit" ? "Deposited" : "Withdrew"} ${formatCurrency(amount)} successfully`, "success");
      closeCashModal();
      loadSummary();
    } catch (error) {
      showToast(error.message || "Operation failed", "error");
    } finally {
      if (cashSubmitBtn) { cashSubmitBtn.disabled = false; cashSubmitBtn.textContent = origText; }
    }
  });
}

// ─── Rename modal (#9) ────────────────────────────────────────────────────────
export function openRenameModal() {
  const modal  = document.getElementById("renameModal");
  const input  = document.getElementById("renameInput");
  if (!modal) return;
  if (input) input.value = state.currentPortfolioId || "";
  modal.classList.add("active");
  input?.select();
}

export function closeRenameModal() {
  document.getElementById("renameModal")?.classList.remove("active");
  document.getElementById("renameForm")?.reset();
}

export function initRenameModal() {
  const modal       = document.getElementById("renameModal");
  const form        = document.getElementById("renameForm");
  const cancelBtn   = document.getElementById("renameCancelBtn");
  const submitBtn   = document.getElementById("renameSubmitBtn");
  const renameInput = document.getElementById("renameInput");

  cancelBtn?.addEventListener("click", closeRenameModal);
  modal?.addEventListener("click", (e) => { if (e.target === modal) closeRenameModal(); });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const newName = renameInput?.value.trim();
    if (!newName) return;
    const origText = submitBtn?.textContent;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "RENAMING…"; }
    try {
      const resp = await fetch(`/api/portfolios/${encodeURIComponent(state.currentPortfolioId)}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_name: newName }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        showToast(err.detail || "Rename failed", "error");
        return;
      }
      const result = await resp.json();
      state.currentPortfolioId = result.new_id;
      localStorage.setItem("currentPortfolioId", result.new_id);
      document.getElementById("portfolioTitle")?.textContent != null &&
        (document.getElementById("portfolioTitle").textContent = result.new_id);
      document.getElementById("currentPortfolio")?.textContent != null &&
        (document.getElementById("currentPortfolio").textContent = result.new_id);
      showToast(`Portfolio renamed to "${result.new_id}"`, "success");
      closeRenameModal();
    } catch (err) {
      showToast(err.message || "Network error", "error");
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = origText; }
    }
  });
}
