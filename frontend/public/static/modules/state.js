/**
 * Shared mutable application state.
 * Import this object and mutate its properties directly.
 * Ref: [[portfolio.js]] [[chart.js]] [[modals.js]] [[chat.js]] [[app.js]] [[PROJECT_MAP.md]]
 */
export const state = {
  currentPortfolioId: null,
  isEditing:          false,
  lastPortfolioData:  null,
  sellTicker:         null,
  sellMaxShares:      0,
  portfolioChart:     null,
  sectorChart:        null,
  currentPeriod:      "1w",
  sortKey:            "daily_change",
  sortDir:            -1,
  tickerAnimId:       null,
  benchmarkEnabled:   false,
  chartMode:          "value",
  authToken:          null,
  currentUser:        null,  // { username, role }
};

export function getAuthHeaders() {
  const t = localStorage.getItem("authToken");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function authedFetch(url, options = {}) {
  const headers = { ...getAuthHeaders() };
  // Don't set Content-Type for FormData — browser handles multipart boundary
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = options.headers?.["Content-Type"] || "application/json";
  }
  Object.assign(headers, options.headers || {});
  const resp = await fetch(url, { ...options, headers });
  if (resp.status === 401) {
    localStorage.removeItem("authToken");
    localStorage.removeItem("currentUser");
    window.location.replace("/login");
  }
  return resp;
}
