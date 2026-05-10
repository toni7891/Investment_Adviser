/*****************************************************************************/
/* Investment Strategist Dashboard — app.js v6.0 (ES module entry)          */
/* Ref: [[state.js]] [[ui.js]] [[portfolio.js]] [[chart.js]] [[chat.js]]    */
/* Ref: [[detail.js]] [[modals.js]] [[dashboard.html]] [[PROJECT_MAP.md]]   */
/*****************************************************************************/

import { state, authedFetch, getAuthHeaders }             from "./modules/state.js";
import { showToast, showConfirm }                        from "./modules/ui.js";
import { loadSummary, loadPortfolios, updateStatusIndicators, exportPositions, loadTrades } from "./modules/portfolio.js";
import { loadHeartrate, loadSectors, updateTickerTape, loadFearGreed } from "./modules/chart.js";
import { initChat }                                      from "./modules/chat.js";
import { openDetailPanel, closeDetailPanel }            from "./modules/detail.js";
import {
  openPositionModal, closePositionModal, initPositionModal,
  openSellModal,     closeSellModal,     initSellModal,
  openCashModal,     closeCashModal,     initCashModal,
  openRenameModal,   closeRenameModal,   initRenameModal,
} from "./modules/modals.js";

// ─── Auth guard ───────────────────────────────────────────────────────────────
{
  const _token = localStorage.getItem("authToken");
  if (!_token && !window.location.pathname.startsWith("/login")) {
    window.location.replace("/login");
  }
  state.authToken  = _token;
  state.currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");
}

// ─── Upload helpers ───────────────────────────────────────────────────────────
function setUploadLoading(isLoading) {
  const uploadProgress      = document.getElementById("uploadProgress");
  const uploadPortfolioButton = document.getElementById("uploadPortfolioButton");
  const uploadDropZone      = document.getElementById("uploadDropZone");
  uploadProgress?.classList.toggle("hidden", !isLoading);
  if (uploadPortfolioButton) uploadPortfolioButton.disabled = isLoading;
  uploadDropZone?.classList.toggle("is-loading", isLoading);
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
    const response = await authedFetch("/api/portfolios/upload", { method: "POST", body: formData });
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

// ─── Panel collapse helper ────────────────────────────────────────────────────
function setupPanelToggle(btnId, panelId) {
  const btn   = document.getElementById(btnId);
  const panel = document.getElementById(panelId);
  if (!btn || !panel) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isCollapsed = panel.classList.toggle("collapsed");
    btn.textContent = isCollapsed ? "▶ SHOW" : "⊟ HIDE";
  });
  panel.addEventListener("click", (e) => {
    if (!panel.classList.contains("collapsed")) return;
    e.stopPropagation();
    panel.classList.remove("collapsed");
    btn.textContent = "⊟ HIDE";
  });
}

// ─── Detect page and initialize ───────────────────────────────────────────────
const isLanding   = !!document.getElementById("landing-page");
const isDashboard = !!document.getElementById("dashboard-page");

if (isLanding) {
  loadPortfolios();
}

if (isDashboard) {
  // Init state from storage
  state.currentPortfolioId = localStorage.getItem("currentPortfolioId") || null;
  if (!state.currentPortfolioId) {
    window.location.href = "/";
  } else {
    // Init portfolio title
    const portfolioTitle = document.getElementById("portfolioTitle");
    if (portfolioTitle) portfolioTitle.textContent = state.currentPortfolioId;
    const currentPortfolioEl = document.getElementById("currentPortfolio");
    if (currentPortfolioEl) currentPortfolioEl.textContent = state.currentPortfolioId;

    // Init all modals
    initPositionModal();
    initSellModal();
    initCashModal();
    initRenameModal();
    initChat();

    // Header actions
    document.getElementById("addPositionBtn")?.addEventListener("click",  () => openPositionModal(false));
    document.getElementById("depositCashBtn")?.addEventListener("click",  () => openCashModal(true));
    document.getElementById("withdrawCashBtn")?.addEventListener("click", () => openCashModal(false));
    document.getElementById("backButton")?.addEventListener("click",      () => window.location.href = "/");
    document.getElementById("renameBtn")?.addEventListener("click",       openRenameModal);

    // Export positions (#14)
    document.getElementById("exportPositionsBtn")?.addEventListener("click", exportPositions);

    // Column sort
    document.querySelectorAll(".holdings-table th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        if (state.sortKey === th.dataset.sort) { state.sortDir = -state.sortDir; }
        else { state.sortKey = th.dataset.sort; state.sortDir = state.sortKey === "ticker" ? 1 : -1; }
        // updateSortHeaders is called inside renderHoldings via loadSummary — re-render from cache
        if (state.lastPortfolioData) {
          // import renderHoldings lazily to avoid double-import issues
          import("./modules/portfolio.js").then(({ renderHoldings, updateSortHeaders }) => {
            updateSortHeaders();
            renderHoldings(state.lastPortfolioData);
          });
        }
      });
    });

    // Period tabs
    document.querySelectorAll(".period-btn").forEach((btn) => {
      btn.addEventListener("click", () => loadHeartrate(btn.dataset.period));
    });

    // Chart mode toggle (VALUE / P&L)
    const chartModeBtn = document.getElementById("chartModeBtn");
    chartModeBtn?.addEventListener("click", () => {
      state.chartMode = state.chartMode === "value" ? "pnl" : "value";
      const isPnl = state.chartMode === "pnl";
      chartModeBtn.classList.toggle("act-btn--active", isPnl);
      chartModeBtn.textContent = isPnl ? "P&L ✓" : "P&L";
      if (state.currentPortfolioId) loadHeartrate(state.currentPeriod);
    });

    // Benchmark toggle
    const benchmarkToggleBtn = document.getElementById("benchmarkToggleBtn");
    benchmarkToggleBtn?.addEventListener("click", () => {
      state.benchmarkEnabled = !state.benchmarkEnabled;
      benchmarkToggleBtn.classList.toggle("act-btn--active", state.benchmarkEnabled);
      benchmarkToggleBtn.textContent = state.benchmarkEnabled ? "VS SPY ✓" : "VS SPY";
      if (state.currentPortfolioId) loadHeartrate(state.currentPeriod);
    });

    // Snapshot controls
    document.getElementById("exportHistoryBtn")?.addEventListener("click", () => {
      if (!state.currentPortfolioId) return;
      window.location.href = `/api/portfolios/${encodeURIComponent(state.currentPortfolioId)}/snapshots/export`;
    });

    const snapshotImportInput = document.getElementById("snapshotImportInput");
    document.getElementById("importHistoryBtn")?.addEventListener("click", () => snapshotImportInput?.click());
    snapshotImportInput?.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file || !state.currentPortfolioId) return;
      snapshotImportInput.value = "";
      const importBtn  = document.getElementById("importHistoryBtn");
      const origText   = importBtn?.textContent;
      if (importBtn) { importBtn.disabled = true; importBtn.textContent = "IMPORTING…"; }
      try {
        const fd = new FormData();
        fd.append("file", file);
        const resp = await authedFetch(`/api/portfolios/${encodeURIComponent(state.currentPortfolioId)}/snapshots/import`, { method: "POST", body: fd });
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.detail || "Import failed");
        showToast(`Imported ${result.inserted} snapshot(s)`, "success");
        loadHeartrate(state.currentPeriod);
      } catch (err) {
        showToast(err.message || "Import failed", "error");
      } finally {
        if (importBtn) { importBtn.disabled = false; importBtn.textContent = origText; }
      }
    });

    const takeSnapshotBtn = document.getElementById("takeSnapshotBtn");
    takeSnapshotBtn?.addEventListener("click", async () => {
      if (!state.currentPortfolioId) return;
      const origText = takeSnapshotBtn.textContent;
      takeSnapshotBtn.disabled = true; takeSnapshotBtn.textContent = "SAVING…";
      try {
        const resp   = await authedFetch(`/api/portfolios/${encodeURIComponent(state.currentPortfolioId)}/snapshot`, { method: "POST" });
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.detail || "Snapshot failed");
        showToast(`Snapshot saved (slot: ${result.snapshot?.slot || "─"})`, "success");
        loadHeartrate(state.currentPeriod);
      } catch (err) {
        showToast(err.message || "Snapshot failed", "error");
      } finally {
        takeSnapshotBtn.disabled = false; takeSnapshotBtn.textContent = origText;
      }
    });

    // Panel collapse / expand
    setupPanelToggle("aiPaneToggle",      "aiPane");
    setupPanelToggle("heartrateToggle",   "heartrateSection");
    setupPanelToggle("sectorToggle",      "sectorSection");
    setupPanelToggle("tradesToggle",      "tradesSection");

    // Stock detail panel
    document.getElementById("detailClose")?.addEventListener("click", closeDetailPanel);
    document.getElementById("stockDetailPanel")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeDetailPanel();
    });

    // Expose openDetailPanel so portfolio.js can call it via delegation
    window._openDetailPanel = openDetailPanel;

    // Global Escape → close any open modal or detail panel
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (document.getElementById("stockDetailPanel")?.classList.contains("open")) { closeDetailPanel(); return; }
      if (document.getElementById("positionModal")?.classList.contains("active")) closePositionModal();
      if (document.getElementById("cashModal")?.classList.contains("active"))     closeCashModal();
      if (document.getElementById("sellModal")?.classList.contains("active"))     closeSellModal();
      if (document.getElementById("renameModal")?.classList.contains("active"))   closeRenameModal();
    });

    // Sort headers initial state
    import("./modules/portfolio.js").then(({ updateSortHeaders }) => updateSortHeaders());

    // Load data
    updateStatusIndicators();
    loadSummary();
    setInterval(() => loadSummary(), 90 * 1000);
    updateTickerTape();
    setInterval(updateTickerTape, 5 * 60 * 1000);
    loadFearGreed();
    setInterval(loadFearGreed, 60 * 60 * 1000);
  }
}

// ─── Logout ───────────────────────────────────────────────────────────────────
document.getElementById("logoutBtn")?.addEventListener("click", () => {
  localStorage.removeItem("authToken");
  localStorage.removeItem("currentUser");
  localStorage.removeItem("currentPortfolioId");
  window.location.replace("/login");
});

// ─── Account Settings Modal ───────────────────────────────────────────────────
(function () {
  const modal          = document.getElementById("accountModal");
  const openBtn        = document.getElementById("accountBtn");
  const closeBtn       = document.getElementById("accountModalClose");
  const errorBox       = document.getElementById("accountModalError");
  const successBox     = document.getElementById("accountModalSuccess");
  const newUsernameEl  = document.getElementById("newUsernameInput");
  const userPassEl     = document.getElementById("usernameConfirmPassword");
  const curPassEl      = document.getElementById("currentPasswordInput");
  const newPassEl      = document.getElementById("newPasswordInput");
  const changeUserBtn  = document.getElementById("changeUsernameBtn");
  const changePassBtn  = document.getElementById("changePasswordBtn");

  if (!modal) return;

  function showModal() {
    modal.classList.add("active");
    if (newUsernameEl) newUsernameEl.value = "";
    if (userPassEl)    userPassEl.value    = "";
    if (curPassEl)     curPassEl.value     = "";
    if (newPassEl)     newPassEl.value     = "";
    hideMessages();
  }

  function hideModal() { modal.classList.remove("active"); }

  function showError(msg) {
    if (!errorBox) return;
    errorBox.textContent = msg;
    errorBox.style.display = "block";
    if (successBox) successBox.style.display = "none";
  }

  function showSuccess(msg) {
    if (!successBox) return;
    successBox.textContent = msg;
    successBox.style.display = "block";
    if (errorBox) errorBox.style.display = "none";
  }

  function hideMessages() {
    if (errorBox)   errorBox.style.display   = "none";
    if (successBox) successBox.style.display = "none";
  }

  openBtn?.addEventListener("click", showModal);
  closeBtn?.addEventListener("click", hideModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) hideModal(); });

  changeUserBtn?.addEventListener("click", async () => {
    hideMessages();
    const newUsername = newUsernameEl?.value.trim();
    const password    = userPassEl?.value;
    if (!newUsername) { showError("New username is required."); return; }
    if (!password)    { showError("Current password is required."); return; }

    changeUserBtn.disabled    = true;
    changeUserBtn.textContent = "UPDATING…";
    try {
      const resp = await authedFetch("/api/auth/change-username", {
        method: "PATCH",
        body:   JSON.stringify({ new_username: newUsername, current_password: password }),
      });
      const data = await resp.json();
      if (!resp.ok) { showError(data.detail || "Failed to update username."); return; }
      localStorage.setItem("authToken",   data.access_token);
      localStorage.setItem("currentUser", JSON.stringify({ username: data.username, role: state.currentUser?.role || "user" }));
      state.authToken   = data.access_token;
      state.currentUser = { username: data.username, role: state.currentUser?.role || "user" };
      showSuccess(`Username updated to "${data.username}". Re-logging in…`);
      setTimeout(() => { window.location.reload(); }, 1200);
    } catch { showError("Network error."); }
    finally { changeUserBtn.disabled = false; changeUserBtn.textContent = "UPDATE USERNAME"; }
  });

  changePassBtn?.addEventListener("click", async () => {
    hideMessages();
    const currentPass = curPassEl?.value;
    const newPass     = newPassEl?.value;
    if (!currentPass) { showError("Current password is required."); return; }
    if (!newPass)     { showError("New password is required."); return; }
    if (newPass.length < 6) { showError("Password must be at least 6 characters."); return; }

    changePassBtn.disabled    = true;
    changePassBtn.textContent = "UPDATING…";
    try {
      const resp = await authedFetch("/api/auth/change-password", {
        method: "PATCH",
        body:   JSON.stringify({ current_password: currentPass, new_password: newPass }),
      });
      const data = await resp.json();
      if (!resp.ok) { showError(data.detail || "Failed to update password."); return; }
      localStorage.setItem("authToken", data.access_token);
      state.authToken = data.access_token;
      showSuccess("Password updated successfully.");
      if (curPassEl) curPassEl.value = "";
      if (newPassEl) newPassEl.value = "";
    } catch { showError("Network error."); }
    finally { changePassBtn.disabled = false; changePassBtn.textContent = "UPDATE PASSWORD"; }
  });
})();

// ─── Landing-only: file upload ────────────────────────────────────────────────
if (isLanding) {
  const portfolioUpload       = document.getElementById("portfolioUpload");
  const uploadPortfolioButton = document.getElementById("uploadPortfolioButton");
  const uploadDropZone        = document.getElementById("uploadDropZone");

  uploadPortfolioButton?.addEventListener("click", (e) => {
    e.preventDefault();
    if (portfolioUpload) { portfolioUpload.value = ""; portfolioUpload.click(); }
  });
  portfolioUpload?.addEventListener("change", (e) => uploadPortfolioFile(e.target.files[0]));

  if (uploadDropZone) {
    uploadDropZone.addEventListener("dragover",  (e) => { e.preventDefault(); uploadDropZone.classList.add("drag-over"); });
    uploadDropZone.addEventListener("dragleave", ()  => uploadDropZone.classList.remove("drag-over"));
    uploadDropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      uploadDropZone.classList.remove("drag-over");
      uploadPortfolioFile(e.dataTransfer.files[0]);
    });
  }
}
