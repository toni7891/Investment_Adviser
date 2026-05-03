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
};
