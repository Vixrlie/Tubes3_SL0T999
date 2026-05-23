import type { ContentPipelineState, PopupStats, ScanRequest, ScanResponse } from '../types';
import { applyHighlights, clearHighlights } from './highlighter';
import { collectScanTargets, readDocumentText } from './scanner';
import { hideTooltip } from './tooltip';

const initialStats: PopupStats = {
  totalKeywords: 0,
  exactMatches: 0,
  regexMatches: 0,
  fuzzyMatches: 0
};

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
    targets,
    stats: {
      totalKeywords: request.text.length > 0 ? 1 : 0,
      exactMatches: 0,
      regexMatches: 0,
      fuzzyMatches: 0
    }
  };
}

function runScan(): ScanResponse {
  clearHighlights(document);
  hideTooltip();

  const pipeline = buildPipelineState();
  void pipeline.targets;
  applyHighlights([]);
  persistStats(pipeline.stats);

  return {
    ok: true,
    result: {
      matches: [],
      totalMatches: pipeline.stats.totalKeywords,
      exactMatches: pipeline.stats.exactMatches,
      regexMatches: pipeline.stats.regexMatches,
      fuzzyMatches: pipeline.stats.fuzzyMatches,
      scannedTextLength: pipeline.request.text.length,
      executionTimeMs: 0
    }
  };
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (message === 'scan-now') {
    sendResponse(runScan());
    return true;
  }

  return false;
});

runScan();

void initialStats;