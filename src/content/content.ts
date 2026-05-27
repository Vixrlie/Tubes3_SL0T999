import type {
  ContentPipelineState,
  DetectionContext,
  DetectionResult,
  PopupStats,
  ScanRequest,
  ScanResponse,
  ScanTarget,
} from "../types";
import { runDetectionEnginesDetailed } from "../algorithms";
import {
  applyBlur,
  applyDetectionResult,
  clearHighlights,
  removeBlur,
} from "./highlighter";
import { collectImageTargets, collectScanTargets, readDocumentText } from "./scanner";
import { runOcrDetection } from "./ocr";
import { hideTooltip, isTooltipVisible } from "./tooltip";

function createRequest(): ScanRequest {
  return {
    url: location.href,
    text: readDocumentText(document.body ?? document),
    timestamp: Date.now(),
  };
}

function persistStats(stats: PopupStats): void {
  chrome.storage.local.set(stats);
}

function buildPipelineState(): ContentPipelineState {
  const request = createRequest();
  const targets = collectScanTargets(document);
  const imageTargets = collectImageTargets(document, targets.length);

  return {
    request,
    targets,
    imageTargets,
  };
}

async function buildTextDetectionResult(
  request: ScanRequest,
  targets: ScanTarget[],
): Promise<
  DetectionResult & {
    timings: {
      kmp: number;
      bm: number;
      ahoCorasick: number;
      rabinKarp: number;
      regex: number;
      fuzzy: number;
    };
  }
> {
  const detectionContext: DetectionContext = {
    url: request.url,
    text: request.text,
    timestamp: request.timestamp,
    targets,
  };
  const { matches, timings } =
    await runDetectionEnginesDetailed(detectionContext);
  const exactMatches = matches.filter(
    (match) => match.source === "exact",
  ).length;
  const regexMatches = matches.filter(
    (match) => match.source === "regex",
  ).length;
  const fuzzyMatches = matches.filter(
    (match) => match.source === "fuzzy",
  ).length;

  return {
    matches,
    totalMatches: matches.length,
    exactMatches,
    regexMatches,
    fuzzyMatches,
    scannedTextLength: request.text.length,
    executionTimeMs:
      timings.kmp +
      timings.bm +
      timings.ahoCorasick +
      timings.rabinKarp +
      timings.regex +
      timings.fuzzy,
    timings,
  };
}

async function runScan(includeOcr = false): Promise<ScanResponse> {
  clearHighlights(document);
  hideTooltip();

  const pipeline = buildPipelineState();
  const textDetectionResult = await buildTextDetectionResult(
    pipeline.request,
    pipeline.targets,
  );
  const imageTargets = includeOcr ? pipeline.imageTargets ?? [] : [];
  const ocrResult = includeOcr && imageTargets.length > 0
    ? await runOcrDetection(imageTargets)
    : { matches: [], executionTimeMs: 0 };
  const combinedMatches = [...textDetectionResult.matches, ...ocrResult.matches];
  const combinedTargets = [...pipeline.targets, ...imageTargets];

  const detectionResult: DetectionResult = {
    ...textDetectionResult,
    matches: combinedMatches,
    totalMatches: combinedMatches.length,
    scannedTextLength: textDetectionResult.scannedTextLength,
    executionTimeMs: textDetectionResult.executionTimeMs + ocrResult.executionTimeMs,
  };

  applyDetectionResult(detectionResult, combinedTargets);
  const kmpMatches = textDetectionResult.matches.filter(
    (m) => m.algorithm === "KMP",
  ).length;
  const bmMatches = textDetectionResult.matches.filter(
    (m) => m.algorithm === "BM",
  ).length;
  const ahoCorasickMatches = textDetectionResult.matches.filter(
    (m) => m.algorithm === "AhoCorasick",
  ).length;
  const rabinKarpMatches = textDetectionResult.matches.filter(
    (m) => m.algorithm === "RabinKarp",
  ).length;
  const ocrMatches = ocrResult.matches.length;
  const stats: PopupStats = {
    totalKeywords: detectionResult.totalMatches,
    exactMatches: textDetectionResult.exactMatches,
    regexMatches: textDetectionResult.regexMatches,
    fuzzyMatches: textDetectionResult.fuzzyMatches,
    ocrMatches,
    kmpMatches,
    bmMatches,
    ahoCorasickMatches,
    rabinKarpMatches,
    executionTimeMsKmp: textDetectionResult.timings.kmp,
    executionTimeMsBm: textDetectionResult.timings.bm,
    executionTimeMsAhoCorasick: textDetectionResult.timings.ahoCorasick,
    executionTimeMsRabinKarp: textDetectionResult.timings.rabinKarp,
    executionTimeMsOcr: ocrResult.executionTimeMs,
    executionTimeMsRegex: textDetectionResult.timings.regex,
    executionTimeMsFuzzy: textDetectionResult.timings.fuzzy,
    lastScanMs: detectionResult.executionTimeMs,
  };

  persistStats(stats);

  chrome.storage.local.get({ blurEnabled: false }, (items) => {
    if (items["blurEnabled"]) applyBlur(document);
  });

  return {
    ok: true,
    result: {
      ...detectionResult,
    },
  };
}

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    if (message === "scan-now") {
      void runScan(true).then((response) => sendResponse(response));
      return true;
    }

    return false;
  },
);

let scanTimer: number | undefined;
let internalMutation = false;

function scheduleScan(): void {
  if (scanTimer !== undefined) {
    window.clearTimeout(scanTimer);
  }

  scanTimer = window.setTimeout(() => {
    internalMutation = true;
    void runScan(false);
    window.setTimeout(() => {
      internalMutation = false;
    }, 0);
  }, 150);
}

const observer = new MutationObserver((mutations) => {
  if (internalMutation) {
    return;
  }

  // If tooltip is visible (user interacting), avoid running scans to reduce noise.
  if (isTooltipVisible()) return;

  // Ignore mutations that are entirely inside our own UI (tooltip, overlays).
  const relevant = mutations.some((mutation) => {
    // If any added/removed node is not part of our UI, it's relevant.
    const added = Array.from(mutation.addedNodes).some((n) => {
      if (n instanceof Element) return n.closest('[data-judol-ui]') === null;
      if (n.parentElement) return n.parentElement.closest('[data-judol-ui]') === null;
      return true;
    });

    const removed = Array.from(mutation.removedNodes).some((n) => {
      if (n instanceof Element) return n.closest('[data-judol-ui]') === null;
      if (n.parentElement) return n.parentElement.closest('[data-judol-ui]') === null;
      return true;
    });

    const charDataRelevant = mutation.type === 'characterData' && (mutation.target instanceof Node) && (mutation.target instanceof Element ? mutation.target.closest('[data-judol-ui]') === null : mutation.target.parentElement?.closest('[data-judol-ui]') === null);

    return added || removed || charDataRelevant;
  });

  if (relevant) scheduleScan();
});

const observerRoot = document.body ?? document.documentElement;

if (observerRoot) {
  observer.observe(observerRoot, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !("blurEnabled" in changes)) return;
  const enabled = changes["blurEnabled"]?.newValue as boolean;
  if (enabled) applyBlur(document);
  else removeBlur(document);
});

void runScan(true);
