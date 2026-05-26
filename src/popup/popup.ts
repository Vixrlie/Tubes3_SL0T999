import "./popup.css";

import type { PopupStats } from "../types";

if (typeof chrome === "undefined" || !chrome.storage) {
  const mockStats: PopupStats = {
    totalKeywords: 12,
    exactMatches: 8,
    regexMatches: 3,
    fuzzyMatches: 1,
    kmpMatches: 8,
    bmMatches: 7,
    executionTimeMsKmp: 0.42,
    executionTimeMsBm: 0.31,
    executionTimeMsRegex: 0.08,
    executionTimeMsFuzzy: 1.19,
    lastScanMs: 2.0,
  };

  (window as unknown as Record<string, unknown>)["chrome"] = {
    storage: {
      local: {
        get: (_defaults: unknown, cb: (items: PopupStats) => void) =>
          cb(mockStats),
      },
      onChanged: { addListener: () => {} },
    },
    tabs: {
      query: (_q: unknown, cb: (tabs: { id: number }[]) => void) =>
        cb([{ id: 1 }]),
      sendMessage: (_id: number, _msg: unknown, cb: () => void) => cb(),
    },
  };
}

const defaultStats: PopupStats = {
  totalKeywords: 0,
  exactMatches: 0,
  regexMatches: 0,
  fuzzyMatches: 0,
  kmpMatches: 0,
  bmMatches: 0,
  executionTimeMsKmp: 0,
  executionTimeMsBm: 0,
  executionTimeMsRegex: 0,
  executionTimeMsFuzzy: 0,
  lastScanMs: 0,
};

function formatMs(ms: number): string {
  if (ms === 0) return "-";
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
  return `${ms.toFixed(2)} ms`;
}

function setText(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setBarWidth(id: string, pct: number): void {
  const el = document.getElementById(id) as HTMLElement | null;
  if (el) el.style.width = `${Math.min(100, Math.max(0, pct))}%`;
}

function renderStats(stats: PopupStats): void {
  const total = stats.totalKeywords;

  // Hero
  const totalEl = document.getElementById("total-count");
  if (totalEl) {
    totalEl.textContent = String(total);
    totalEl.classList.toggle("zero", total === 0);
  }
  setText("scan-meta", `Last scan: ${formatMs(stats.lastScanMs)} total`);

  // Bar max is the largest single-algorithm match count (floor at 1 to avoid /0)
  const counts = [
    stats.kmpMatches,
    stats.bmMatches,
    stats.regexMatches,
    stats.fuzzyMatches,
  ];
  const maxCount = Math.max(...counts, 1);

  setText("count-kmp", String(stats.kmpMatches));
  setText("count-bm", String(stats.bmMatches));
  setText("count-regex", String(stats.regexMatches));
  setText("count-fuzzy", String(stats.fuzzyMatches));

  setBarWidth("bar-kmp", (stats.kmpMatches / maxCount) * 100);
  setBarWidth("bar-bm", (stats.bmMatches / maxCount) * 100);
  setBarWidth("bar-regex", (stats.regexMatches / maxCount) * 100);
  setBarWidth("bar-fuzzy", (stats.fuzzyMatches / maxCount) * 100);

  setText("time-kmp", formatMs(stats.executionTimeMsKmp));
  setText("time-bm", formatMs(stats.executionTimeMsBm));
  setText("time-regex", formatMs(stats.executionTimeMsRegex));
  setText("time-fuzzy", formatMs(stats.executionTimeMsFuzzy));

  // Type grid
  setText("count-exact", String(stats.exactMatches));
  setText("count-regex-type", String(stats.regexMatches));
  setText("count-fuzzy-type", String(stats.fuzzyMatches));
}

function loadStats(): void {
  chrome.storage.local.get(defaultStats, (items) => {
    const stats = items as PopupStats;
    renderStats(stats);
  });
}

function triggerScan(): void {
  const btn = document.getElementById("btn-scan") as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Scanning…";
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (tabId === undefined) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Scan Now";
      }
      return;
    }

    chrome.tabs.sendMessage(tabId, "scan-now", () => {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Scan Now";
      }
      loadStats();
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  loadStats();

  document.getElementById("btn-scan")?.addEventListener("click", triggerScan);

  const btnInfo = document.getElementById(
    "btn-info",
  ) as HTMLButtonElement | null;
  const infoPanel = document.getElementById(
    "info-panel",
  ) as HTMLDivElement | null;
  btnInfo?.addEventListener("click", () => {
    const isHidden = infoPanel?.hasAttribute("hidden");
    if (isHidden) {
      infoPanel?.removeAttribute("hidden");
      btnInfo.classList.add("active");
    } else {
      infoPanel?.setAttribute("hidden", "");
      btnInfo.classList.remove("active");
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (
      area === "local" &&
      Object.keys(changes).some((k) => k in defaultStats)
    ) {
      loadStats();
    }
  });
});
