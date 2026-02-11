/**
 * ============================================================================
 * TEST SUITE TYPE DEFINITIONS
 * ============================================================================
 *
 * TypeScript interfaces and types for the test dashboard system.
 * Defines the structure for tests, results, and progress updates.
 *
 * @module apps/sysmaint-web/types/test
 * ============================================================================
 */

import type Database from "better-sqlite3";

/**
 * Test categories for organizing tests in the UI
 */
export type TestCategory = "signal" | "e2ee" | "ai" | "web";

/**
 * Test execution status states
 */
export type TestStatus = "pending" | "running" | "retrying" | "passed" | "failed";

/**
 * Definition of a single test case
 */
export interface TestDefinition {
  /** Unique identifier for the test */
  id: string;
  /** Human-readable test name */
  name: string;
  /** Category for grouping */
  category: TestCategory;
  /** Detailed description */
  description: string;
  /** Estimated duration in milliseconds */
  estimatedDuration: number;
  /** Estimated cost in USD (for AI tests) */
  estimatedCost?: number;
  /** Test execution function */
  fn: (context: TestContext) => Promise<TestResultData>;
}

/**
 * Context provided to each test during execution
 */
export interface TestContext {
  /** Logging function for test output */
  log: (message: string) => void;
  /** In-memory database for test isolation */
  db: Database.Database;
  /** Error from first attempt (if retrying) */
  firstError?: Error;
  /** Accumulated log messages */
  logs: string[];
}

/**
 * Data returned by a successful test execution
 */
export interface TestResultData {
  /** Execution duration in milliseconds */
  duration?: number;
  /** Input tokens used (AI tests) */
  inputTokens?: number;
  /** Output tokens used (AI tests) */
  outputTokens?: number;
  /** Estimated cost in USD */
  estimatedCostUsd?: number;
  /** Additional test-specific data */
  [key: string]: any;
}

/**
 * Complete test result with metadata
 */
export interface TestResult {
  /** Parent run ID */
  runId: string;
  /** Test identifier */
  testId: string;
  /** Test name */
  testName: string;
  /** Test category */
  category: TestCategory;
  /** Final status */
  status: TestStatus;
  /** Attempt number (1 for first try, 2 for retry) */
  attemptNumber: number;
  /** Start timestamp */
  startedAt: number;
  /** Completion timestamp */
  completedAt?: number;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Input tokens (AI tests) */
  inputTokens?: number;
  /** Output tokens (AI tests) */
  outputTokens?: number;
  /** Cost in USD (AI tests) */
  estimatedCostUsd?: number;
  /** Execution logs */
  logs: string[];
  /** Error message if failed */
  errorMessage?: string;
  /** Error from first attempt if retried */
  retryErrorMessage?: string;
}

/**
 * Complete test run with all results
 */
export interface TestRun {
  /** Unique run identifier */
  runId: string;
  /** Start timestamp */
  startedAt: number;
  /** Completion timestamp */
  completedAt?: number;
  /** Overall run status */
  status: "running" | "completed" | "failed" | "cancelled";
  /** Total number of tests */
  totalTests: number;
  /** Number of passed tests */
  passedTests: number;
  /** Number of failed tests */
  failedTests: number;
  /** Number of retried tests */
  retriedTests: number;
  /** Total duration in milliseconds */
  totalDurationMs?: number;
  /** Total cost in USD */
  totalCostUsd: number;
  /** Individual test results */
  results: TestResult[];
}

/**
 * Progress update events for real-time UI updates
 */
export interface ProgressUpdate {
  /** Event type */
  type:
    | "run-started"
    | "test-started"
    | "test-progress"
    | "test-retry"
    | "test-completed"
    | "run-completed"
    | "error";
  /** Run ID */
  runId?: string;
  /** Test ID */
  testId?: string;
  /** Test name */
  testName?: string;
  /** Test index in sequence */
  index?: number;
  /** Total test count */
  total?: number;
  /** Log message */
  log?: string;
  /** Error message */
  error?: string;
  /** Next attempt number (for retries) */
  nextAttempt?: number;
  /** Current status */
  status?: TestStatus;
  /** Duration in milliseconds */
  duration?: number;
  /** Cost in USD */
  cost?: number;
  /** Run summary */
  summary?: {
    passed: number;
    failed: number;
    retried: number;
    totalCost: number;
    totalDuration: number;
  };
  /** Estimated cost for run */
  estimatedCost?: number;
  /** Estimated duration for run */
  estimatedDuration?: number;
}
