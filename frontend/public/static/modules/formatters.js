// Ref: [[portfolio.js]] [[chart.js]] [[modals.js]] [[detail.js]] [[PROJECT_MAP.md]]
export const formatCurrency = (value) =>
  `$${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const formatPercent = (value) => {
  const num = Number(value || 0);
  return `${num >= 0 ? "+" : ""}${num.toFixed(2)}%`;
};

export function setSignedStatus(el, value) {
  if (!el) return;
  el.classList.remove("success", "negative");
  el.classList.add(value >= 0 ? "success" : "negative");
}
