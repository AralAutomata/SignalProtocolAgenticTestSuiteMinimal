/**
 * ============================================================================
 * TEST EXPORT UTILITIES
 * ============================================================================
 *
 * Export test results in structured or flattened JSON formats
 *
 * Formats:
 * - Structured: Nested JSON with categories
 * - Flattened: Array of records (CSV-friendly)
 *
 * @module apps/sysmaint-web/lib/test-suite/export
 * ============================================================================
 */

import type { TestRun } from "../../types/test";
import { getTestRun } from "./database";

/**
 * Export format options
 */
export type ExportFormat = "structured" | "flattened";

/**
 * Export a test run in the specified format
 */
export function exportTestRun(runId: string, format: ExportFormat): object {
  const run = getTestRun(runId);
  if (!run) {
    throw new Error(`Test run ${runId} not found`);
  }

  if (format === "structured") {
    return exportStructured(run);
  } else {
    return exportFlattened(run);
  }
}

/**
 * Export in structured nested format
 */
function exportStructured(run: TestRun): object {
  // Group results by category
  const categories: Record<string, any> = {};

  const categoryNames: Record<string, string> = {
    signal: "Signal Protocol",
    e2ee: "E2EE Health",
    ai: "AI Agent",
    web: "Web API",
  };

  // Initialize categories
  ["signal", "e2ee", "ai", "web"].forEach((cat) => {
    categories[cat] = {
      name: categoryNames[cat],
      passed: 0,
      failed: 0,
      tests: [],
    };
  });

  // Populate with results
  run.results.forEach((result) => {
    const cat = categories[result.category];
    cat[result.status === "passed" ? "passed" : "failed"]++;
    cat.tests.push({
      id: result.testId,
      name: result.testName,
      status: result.status,
      attempt: result.attemptNumber,
      durationMs: result.durationMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      estimatedCostUsd: result.estimatedCostUsd,
      errorMessage: result.errorMessage,
      retryErrorMessage: result.retryErrorMessage,
      logs: result.logs,
    });
  });

  return {
    runId: run.runId,
    metadata: {
      startedAt: new Date(run.startedAt).toISOString(),
      completedAt: run.completedAt
        ? new Date(run.completedAt).toISOString()
        : null,
      totalDurationMs: run.totalDurationMs,
      totalCostUsd: run.totalCostUsd,
      summary: {
        total: run.totalTests,
        passed: run.passedTests,
        failed: run.failedTests,
        retried: run.retriedTests,
      },
    },
    categories,
  };
}

/**
 * Export in flattened array format (CSV-friendly)
 */
function exportFlattened(run: TestRun): object[] {
  return run.results.map((result) => ({
    // Run metadata (repeated for each row)
    runId: run.runId,
    runStartedAt: new Date(run.startedAt).toISOString(),
    runCompletedAt: run.completedAt
      ? new Date(run.completedAt).toISOString()
      : null,
    runTotalDurationMs: run.totalDurationMs,
    runTotalCostUsd: run.totalCostUsd,
    runTotalTests: run.totalTests,
    runPassedTests: run.passedTests,
    runFailedTests: run.failedTests,
    runRetriedTests: run.retriedTests,

    // Test result fields
    testId: result.testId,
    testName: result.testName,
    testCategory: result.category,
    testStatus: result.status,
    testAttemptNumber: result.attemptNumber,
    testStartedAt: new Date(result.startedAt).toISOString(),
    testCompletedAt: result.completedAt
      ? new Date(result.completedAt).toISOString()
      : null,
    testDurationMs: result.durationMs,
    testInputTokens: result.inputTokens,
    testOutputTokens: result.outputTokens,
    testCostUsd: result.estimatedCostUsd,
    testErrorMessage: result.errorMessage,
    testRetryErrorMessage: result.retryErrorMessage,
    testLogCount: result.logs.length,
  }));
}
