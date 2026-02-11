/**
 * ============================================================================
 * BROWSER NOTIFICATION SERVICE
 * ============================================================================
 *
 * Browser notifications for test lifecycle events
 *
 * Events:
 * - Test run started
 * - Test run completed (with results)
 * - Test run cancelled
 *
 * @module apps/sysmaint-web/lib/test-suite/notifications
 * ============================================================================
 */

/**
 * Service for managing browser notifications
 */
export class TestNotificationService {
  private permission: NotificationPermission = "default";

  /**
   * Request permission to show notifications
   */
  async requestPermission(): Promise<boolean> {
    if (typeof window === "undefined") {
      return false; // Server-side
    }

    if (!("Notification" in window)) {
      console.log("Browser notifications not supported");
      return false;
    }

    if (this.permission === "granted") {
      return true;
    }

    this.permission = await Notification.requestPermission();
    return this.permission === "granted";
  }

  /**
   * Show a notification
   */
  notify(title: string, options: NotificationOptions): void {
    if (typeof window === "undefined") return; // Server-side safety

    if (this.permission === "default") {
      // Try to request permission on first use
      this.requestPermission().then((granted) => {
        if (granted) {
          new Notification(title, options);
        }
      });
    } else if (this.permission === "granted") {
      new Notification(title, options);
    }
  }

  /**
   * Notify that a test run has started
   */
  notifyTestStarted(runId: string, testCount: number): void {
    this.notify("Test Run Started", {
      body: `Running ${testCount} tests sequentially`,
      icon: "/icon-192x192.png",
      tag: `test-run-${runId}`,
      requireInteraction: false,
    });
  }

  /**
   * Notify about test progress (silent - no notification)
   */
  notifyTestInProgress(_testName: string, _progress: number): void {
    // Skip notification to avoid spam
    // Just update UI silently
  }

  /**
   * Notify that a test run has completed
   */
  notifyTestCompleted(summary: {
    passed: number;
    failed: number;
    retried: number;
    total: number;
    cost: number;
  }): void {
    const { passed, failed, retried, total, cost } = summary;
    const allPassed = failed === 0;

    const title = allPassed
      ? "✅ All Tests Passed"
      : `❌ ${failed} Tests Failed`;
    const body = `${passed}/${total} tests passed${
      retried > 0 ? ` (${retried} retried)` : ""
    }\nCost: $${cost.toFixed(4)}`;

    this.notify(title, {
      body,
      icon: allPassed ? "/success-icon.png" : "/warning-icon.png",
      tag: "test-completion",
      requireInteraction: failed > 0, // Keep visible if there are failures
    });
  }

  /**
   * Notify that a test run was cancelled
   */
  notifyTestCancelled(runId: string): void {
    this.notify("Test Run Cancelled", {
      body: "The test run was stopped before completion",
      icon: "/cancel-icon.png",
      tag: `test-run-${runId}`,
    });
  }
}

/**
 * Singleton instance
 */
export const notificationService = new TestNotificationService();
