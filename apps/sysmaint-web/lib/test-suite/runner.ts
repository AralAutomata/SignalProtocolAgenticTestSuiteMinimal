/**
 * ============================================================================
 * TEST RUNNER ENGINE
 * ============================================================================
 *
 * Sequential test execution engine with retry logic and real-time progress
 * Global lock prevents concurrent test runs
 *
 * Features:
 * - Sequential execution (one test at a time)
 * - Automatic retry on failure (1 retry per test)
 * - 30-second timeout for AI tests
 * - Global lock to prevent concurrent runs
 * - Real-time progress events
 *
 * @module apps/sysmaint-web/lib/test-suite/runner
 * ============================================================================
 */

import { EventEmitter } from "events";
import Database from "better-sqlite3";
import type {
  TestDefinition,
  TestResult,
  ProgressUpdate,
  TestContext,
} from "../../types/test";
import {
  createTestRun,
  updateTestResult,
  completeTestRun,
} from "./database";

/**
 * Global lock to prevent concurrent test runs
 */
let isRunning = false;
let currentRunId: string | null = null;

/**
 * Test runner class with event emitter for progress updates
 */
export class TestRunner extends EventEmitter {
  private runId: string;
  private results: TestResult[] = [];
  private startTime: number = 0;

  constructor(runId: string) {
    super();
    this.runId = runId;
  }

  /**
   * Check if a test run is currently in progress
   */
  static isRunning(): boolean {
    return isRunning;
  }

  /**
   * Get the ID of the current test run
   */
  static getCurrentRunId(): string | null {
    return currentRunId;
  }

  /**
   * Run all tests sequentially
   */
  async runAll(tests: TestDefinition[]): Promise<void> {
    if (isRunning) {
      throw new Error("Test run already in progress");
    }

    isRunning = true;
    currentRunId = this.runId;
    this.startTime = Date.now();

    try {
      // Create run record in database
      createTestRun(this.runId, tests.length);

      // Emit run started event
      this.emit(
        "progress",
        {
          type: "run-started",
          runId: this.runId,
          totalTests: tests.length,
          estimatedCost: tests.reduce((sum, t) => sum + (t.estimatedCost || 0), 0),
          estimatedDuration: tests.reduce(
            (sum, t) => sum + t.estimatedDuration,
            0
          ),
        } as ProgressUpdate
      );

      // Execute tests sequentially
      for (let i = 0; i < tests.length; i++) {
        const test = tests[i];

        const result = await this.executeTestWithRetry(test, i, tests.length);
        this.results.push(result);

        // Save to database
        updateTestResult(result);
      }

      // Calculate final statistics
      const passed = this.results.filter((r) => r.status === "passed").length;
      const failed = this.results.filter((r) => r.status === "failed").length;
      const retried = this.results.filter((r) => r.attemptNumber > 1).length;
      const totalCost = this.results.reduce(
        (sum, r) => sum + (r.estimatedCostUsd || 0),
        0
      );
      const totalDuration = Date.now() - this.startTime;

      // Mark run as completed
      completeTestRun(this.runId, passed, failed, retried, totalDuration, totalCost);

      // Emit completion event
      this.emit(
        "progress",
        {
          type: "run-completed",
          runId: this.runId,
          summary: {
            passed,
            failed,
            retried,
            totalCost,
            totalDuration,
          },
        } as ProgressUpdate
      );
    } finally {
      // Release lock
      isRunning = false;
      currentRunId = null;
    }
  }

  /**
   * Execute a single test with retry logic
   */
  private async executeTestWithRetry(
    test: TestDefinition,
    index: number,
    total: number
  ): Promise<TestResult> {
    const maxAttempts = 2; // Original + 1 retry
    let firstError: Error | undefined;
    const logs: string[] = [];

    /**
     * Log function that captures messages
     */
    const log = (message: string) => {
      const entry = `[${new Date().toISOString()}] ${message}`;
      logs.push(entry);
      this.emit(
        "progress",
        {
          type: "test-progress",
          testId: test.id,
          log: message,
        } as ProgressUpdate
      );
    };

    // Create isolated in-memory database for this test
    const testDb = new Database(":memory:");

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const startedAt = Date.now();

      // Emit appropriate event
      this.emit(
        "progress",
        {
          type: attempt === 1 ? "test-started" : "test-retry",
          testId: test.id,
          testName: test.name,
          index,
          total,
          nextAttempt: attempt > 1 ? attempt : undefined,
          error: attempt > 1 ? firstError?.message : undefined,
        } as ProgressUpdate
      );

      try {
        // Create test context
        const context: TestContext = {
          log,
          db: testDb,
          firstError,
          logs,
        };

        // Set timeout based on test category
        const timeoutMs = test.category === "ai" ? 30000 : 10000;

        // Execute test with timeout
        const resultData = await Promise.race([
          test.fn(context),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Test timed out after ${timeoutMs}ms`)),
              timeoutMs
            )
          ),
        ]);

        const duration = Date.now() - startedAt;

        // Cleanup database
        testDb.close();

        // Return successful result
        return {
          runId: this.runId,
          testId: test.id,
          testName: test.name,
          category: test.category,
          status: "passed",
          attemptNumber: attempt,
          startedAt,
          completedAt: Date.now(),
          durationMs: duration,
          inputTokens: resultData?.inputTokens,
          outputTokens: resultData?.outputTokens,
          estimatedCostUsd: resultData?.estimatedCostUsd,
          logs,
        };
      } catch (error: any) {
        if (attempt === maxAttempts) {
          // Final failure - close database and return failure result
          testDb.close();

          return {
            runId: this.runId,
            testId: test.id,
            testName: test.name,
            category: test.category,
            status: "failed",
            attemptNumber: attempt,
            startedAt,
            completedAt: Date.now(),
            errorMessage: error.message,
            retryErrorMessage: firstError?.message,
            logs,
          };
        }

        // First attempt failed - will retry
        firstError = error;
        log(`Attempt ${attempt} failed: ${error.message}`);
        log(`Waiting 1 second before retry...`);

        // Wait 1 second before retry
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    // Should never reach here
    throw new Error("Unexpected exit from retry loop");
  }
}

/**
 * Get current test status
 */
export function getTestStatus(): {
  isRunning: boolean;
  currentRunId: string | null;
} {
  return {
    isRunning: TestRunner.isRunning(),
    currentRunId: TestRunner.getCurrentRunId(),
  };
}
