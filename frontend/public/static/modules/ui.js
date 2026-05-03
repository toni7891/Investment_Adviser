// Ref: [[portfolio.js]] [[modals.js]] [[chat.js]] [[app.js]] [[PROJECT_MAP.md]]
// ─── Toast ────────────────────────────────────────────────────────────────────
export function showToast(message, type = "error") {
  const toastContainer = document.getElementById("toastContainer");
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

// ─── Confirm dialog ───────────────────────────────────────────────────────────
export function showConfirm(title, message) {
  return new Promise((resolve) => {
    const overlay    = document.getElementById("confirmModal");
    const titleEl    = document.getElementById("confirmTitle");
    const msgEl      = document.getElementById("confirmMessage");
    const okBtn      = document.getElementById("confirmOkBtn");
    const cancelBtn  = document.getElementById("confirmCancelBtn");
    if (!overlay) { resolve(false); return; }

    titleEl.textContent = title;
    msgEl.textContent   = message;
    overlay.classList.add("active");

    const cleanup = (result) => {
      overlay.classList.remove("active");
      resolve(result);
    };

    okBtn.addEventListener("click",    () => cleanup(true),  { once: true });
    cancelBtn.addEventListener("click", () => cleanup(false), { once: true });
    overlay.addEventListener("click",  (e) => { if (e.target === overlay) cleanup(false); }, { once: true });
  });
}

// ─── Field validation ─────────────────────────────────────────────────────────
export function setFieldError(input, message) {
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

export function clearFieldErrors(container) {
  container?.querySelectorAll(".field-inp--error").forEach((el) => el.classList.remove("field-inp--error"));
  container?.querySelectorAll(".field-error.visible").forEach((el) => el.classList.remove("visible"));
}
