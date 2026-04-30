/*****************************************************************************/
/* Investment Strategist Dashboard — app.js v6.0 (ES module entry)          */
/*****************************************************************************/

import { state }                                         from "./modules/state.js";
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
        const resp = await fetch(`/api/portfolios/${encodeURIComponent(state.currentPortfolioId)}/snapshots/import`, { method: "POST", body: fd });
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
        const resp   = await fetch(`/api/portfolios/${encodeURIComponent(state.currentPortfolioId)}/snapshot`, { method: "POST" });
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
