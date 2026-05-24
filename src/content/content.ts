import type { ContentPipelineState, DetectionContext, DetectionResult, PopupStats, ScanRequest, ScanResponse } from '../types';
import { runDetectionEngines } from '../algorithms';
import { applyDetectionResult, clearHighlights } from './highlighter';
import { collectScanTargets, readDocumentText } from './scanner';
import { hideTooltip } from './tooltip';

function createRequest(): ScanRequest {
  return {
    url: location.href,
    text: readDocumentText(document.body ?? document),
    timestamp: Date.now()
  };
}

function persistStats(stats: PopupStats): void {
  chrome.storage.local.set(stats);
}

function buildPipelineState(): ContentPipelineState {
  const request = createRequest();
  const targets = collectScanTargets(document);

  return {
    request,
    targets
  };
}

async function buildDetectionResult(request: ScanRequest): Promise<DetectionResult> {
  const detectionContext: DetectionContext = {
    url: request.url,
    text: request.text,
    timestamp: request.timestamp
  };
  const matches = await runDetectionEngines(detectionContext);
  const exactMatches = matches.filter((match) => match.source === 'exact').length;
  const regexMatches = matches.filter((match) => match.source === 'regex').length;
  const fuzzyMatches = matches.filter((match) => match.source === 'fuzzy').length;

  return {
    matches,
    totalMatches: matches.length,
    exactMatches,
    regexMatches,
    fuzzyMatches,
    scannedTextLength: request.text.length,
    executionTimeMs: 0
  };
}

async function runScan(): Promise<ScanResponse> {
  clearHighlights(document);
  hideTooltip();

  const pipeline = buildPipelineState();
  const detectionResult = await buildDetectionResult(pipeline.request);
  applyDetectionResult(detectionResult, pipeline.targets);
  const stats: PopupStats = {
    totalKeywords: detectionResult.totalMatches,
    exactMatches: detectionResult.exactMatches,
    regexMatches: detectionResult.regexMatches,
    fuzzyMatches: detectionResult.fuzzyMatches
  };

  persistStats(stats);

  return {
    ok: true,
    result: {
      ...detectionResult
    }
  };
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (message === 'scan-now') {
    void runScan().then((response) => sendResponse(response));
    return true;
  }

  return false;
});

let scanTimer: number | undefined;
let internalMutation = false;

function scheduleScan(): void {
  if (scanTimer !== undefined) {
    window.clearTimeout(scanTimer);
  }

  scanTimer = window.setTimeout(() => {
    internalMutation = true;
    void runScan();
    window.setTimeout(() => {
      internalMutation = false;
    }, 0);
  }, 150);
}

const observer = new MutationObserver((mutations) => {
  if (internalMutation) {
    return;
  }

  if (mutations.some((mutation) => mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0 || mutation.type === 'characterData')) {
    scheduleScan();
  }
});

const observerRoot = document.body ?? document.documentElement;

if (observerRoot) {
  observer.observe(observerRoot, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

runScan();
