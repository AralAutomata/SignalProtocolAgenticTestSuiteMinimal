/**
 * ============================================================================
 * TEST DATABASE MODULE
 * ============================================================================
 *
 * SQLite database operations for storing test results and history.
 * Maintains separate database from main application state.
 *
 * Features:
 * - Persistent storage of test runs
 * - Automatic cleanup (keeps last 100 runs)
 * - Efficient querying with indexes
 *
 * @module apps/sysmaint-web/lib/test-suite/database
 * ============================================================================
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { TestRun, TestResult } from "../../types/test";

/**
 * Database file path - separate from main state database
 */
const testDbDir = path.join(process.env.HOME || "/tmp", ".mega");
const testDbPath = path.join(testDbDir, "test-results.db");

// Ensure directory exists
mkdirSync(testDbDir, { recursive: true });

/**
 * Initialize database connection and schema
 */
const db = new Database(testDbPath);

// Create tables with indexes
db.exec(`
  CREATE TABLE IF NOT EXISTS test_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL UNIQUE,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    total_tests INTEGER NOT NULL,
    passed_tests INTEGER DEFAULT 0,
    failed_tests INTEGER DEFAULT 0,
    retried_tests INTEGER DEFAULT 0,
    total_duration_ms INTEGER,
    total_cost_usd REAL DEFAULT 0,
    status TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS test_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    test_id TEXT NOT NULL,
    test_name TEXT NOT NULL,
    category TEXT NOT NULL,
    status TEXT NOT NULL,
    attempt_number INTEGER DEFAULT 1,
    started_at INTEGER,
    completed_at INTEGER,
    duration_ms INTEGER,
    input_tokens INTEGER,
    output_tokens INTEGER,
    estimated_cost_usd REAL,
    logs TEXT,
    error_message TEXT,
    retry_error_message TEXT,
    FOREIGN KEY (run_id) REFERENCES test_runs(run_id)
  );

  CREATE INDEX IF NOT EXISTS idx_test_results_run_id ON test_results(run_id);
  CREATE INDEX IF NOT EXISTS idx_test_runs_status ON test_runs(status);
  CREATE INDEX IF NOT EXISTS idx_test_runs_started_at ON test_runs(started_at);
`);

/**
 * Clean up old test runs, keeping only the last 100
 */
export function cleanupOldRuns(): void {
  // First delete old results
  db.prepare(`
    DELETE FROM test_results 
    WHERE run_id IN (
      SELECT run_id FROM test_runs 
      ORDER BY started_at DESC 
      LIMIT -1 OFFSET 100
    )
  `).run();

  // Then delete old runs
  db.prepare(`
    DELETE FROM test_runs 
    WHERE run_id NOT IN (
      SELECT run_id FROM test_runs 
      ORDER BY started_at DESC 
      LIMIT 100
    )
  `).run();
}

/**
 * Create a new test run record
 */
export function createTestRun(runId: string, totalTests: number): void {
  cleanupOldRuns();
  db.prepare(`
    INSERT INTO test_runs (run_id, started_at, total_tests, status)
    VALUES (?, ?, ?, 'running')
  `).run(runId, Date.now(), totalTests);
}

/**
 * Save or update a test result
 */
export function updateTestResult(result: TestResult): void {
  db.prepare(`
    INSERT OR REPLACE INTO test_results 
    (run_id, test_id, test_name, category, status, attempt_number, started_at, 
     completed_at, duration_ms, input_tokens, output_tokens, estimated_cost_usd, 
     logs, error_message, retry_error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    result.runId,
    result.testId,
    result.testName,
    result.category,
    result.status,
    result.attemptNumber,
    result.startedAt,
    result.completedAt,
    result.durationMs,
    result.inputTokens,
    result.outputTokens,
    result.estimatedCostUsd,
    JSON.stringify(result.logs),
    result.errorMessage,
    result.retryErrorMessage
  );
}

/**
 * Mark a test run as completed
 */
export function completeTestRun(
  runId: string,
  passed: number,
  failed: number,
  retried: number,
  duration: number,
  cost: number
): void {
  db.prepare(`
    UPDATE test_runs 
    SET completed_at = ?, status = 'completed', 
        passed_tests = ?, failed_tests = ?, retried_tests = ?,
        total_duration_ms = ?, total_cost_usd = ?
    WHERE run_id = ?
  `).run(Date.now(), passed, failed, retried, duration, cost, runId);
}

/**
 * Get test run history
 */
export function getTestHistory(limit: number = 10): TestRun[] {
  const runs = db
    .prepare(
      `
    SELECT * FROM test_runs 
    ORDER BY started_at DESC 
    LIMIT ?
  `
    )
    .all(limit) as any[];

  return runs.map((run) => ({
    runId: run.run_id,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    status: run.status,
    totalTests: run.total_tests,
    passedTests: run.passed_tests,
    failedTests: run.failed_tests,
    retriedTests: run.retried_tests,
    totalDurationMs: run.total_duration_ms,
    totalCostUsd: run.total_cost_usd,
    results: [],
  }));
}

/**
 * Get a specific test run with all results
 */
export function getTestRun(runId: string): TestRun | null {
  const run = db.prepare(`SELECT * FROM test_runs WHERE run_id = ?`).get(runId) as any;
  if (!run) return null;

  const results = db.prepare(`SELECT * FROM test_results WHERE run_id = ?`).all(runId) as any[];

  return {
    runId: run.run_id,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    status: run.status,
    totalTests: run.total_tests,
    passedTests: run.passed_tests,
    failedTests: run.failed_tests,
    retriedTests: run.retried_tests,
    totalDurationMs: run.total_duration_ms,
    totalCostUsd: run.total_cost_usd,
    results: results.map((r) => ({
      runId: r.run_id,
      testId: r.test_id,
      testName: r.test_name,
      category: r.category,
      status: r.status,
      attemptNumber: r.attempt_number,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      durationMs: r.duration_ms,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      estimatedCostUsd: r.estimated_cost_usd,
      logs: JSON.parse(r.logs || "[]"),
      errorMessage: r.error_message,
      retryErrorMessage: r.retry_error_message,
    })),
  };
}

/**
 * Get the most recent test run
 */
export function getLatestTestRun(): TestRun | null {
  const run = db.prepare(`SELECT * FROM test_runs ORDER BY started_at DESC LIMIT 1`).get() as any;
  if (!run) return null;
  return getTestRun(run.run_id);
}

/**
 * Get test data for analysis (last 100 runs with full details)
 */
export function getTestDataForAnalysis(): {
  totalRuns: number;
  runs: Array<{
    runId: string;
    startedAt: number;
    completedAt?: number;
    passed: number;
    failed: number;
    retried: number;
    totalCost: number;
    duration: number;
    failedTests: Array<{
      testId: string;
      testName: string;
      category: string;
      errorMessage?: string;
    }>;
  }>;
  aggregates: {
    totalTestsRun: number;
    overallPassRate: number;
    totalCost: number;
    avgDuration: number;
    categoryBreakdown: Record<string, { passed: number; failed: number }>;
  };
} {
  // Get last 100 runs
  const runs = db
    .prepare(
      `
    SELECT * FROM test_runs 
    WHERE status = 'completed'
    ORDER BY started_at DESC 
    LIMIT 100
  `
    )
    .all() as any[];

  // Get failed tests for each run
  const runsWithDetails = runs.map((run) => {
    const failedResults = db
      .prepare(
        `
      SELECT test_id, test_name, category, error_message
      FROM test_results
      WHERE run_id = ? AND status = 'failed'
    `
      )
      .all(run.run_id) as any[];

    return {
      runId: run.run_id,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      passed: run.passed_tests,
      failed: run.failed_tests,
      retried: run.retried_tests,
      totalCost: run.total_cost_usd,
      duration: run.total_duration_ms,
      failedTests: failedResults.map((r) => ({
        testId: r.test_id,
        testName: r.test_name,
        category: r.category,
        errorMessage: r.error_message,
      })),
    };
  });

  // Calculate aggregates
  const totalTestsRun = runs.reduce((sum, r) => sum + r.total_tests, 0);
  const totalPassed = runs.reduce((sum, r) => sum + r.passed_tests, 0);
  const totalCost = runs.reduce((sum, r) => sum + (r.total_cost_usd || 0), 0);
  const avgDuration = runs.length > 0
    ? runs.reduce((sum, r) => sum + (r.total_duration_ms || 0), 0) / runs.length
    : 0;

  // Category breakdown
  const categoryBreakdown: Record<string, { passed: number; failed: number }> = {};
  
  runs.forEach((run) => {
    const runResults = db
      .prepare(`SELECT category, status FROM test_results WHERE run_id = ?`)
      .all(run.run_id) as any[];
    
    runResults.forEach((result) => {
      if (!categoryBreakdown[result.category]) {
        categoryBreakdown[result.category] = { passed: 0, failed: 0 };
      }
      if (result.status === 'passed') {
        categoryBreakdown[result.category].passed++;
      } else {
        categoryBreakdown[result.category].failed++;
      }
    });
  });

  return {
    totalRuns: runs.length,
    runs: runsWithDetails,
    aggregates: {
      totalTestsRun,
      overallPassRate: totalTestsRun > 0 ? (totalPassed / totalTestsRun) * 100 : 0,
      totalCost,
      avgDuration,
      categoryBreakdown,
    },
  };
}

export { db };
