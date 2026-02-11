/**
 * ============================================================================
 * API ROUTE: POST /api/test/run
 * ============================================================================
 *
 * Start a test execution run with Server-Sent Events for real-time progress
 *
 * @module apps/sysmaint-web/app/api/test/run/route
 * ============================================================================
 */

export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { calculateEstimatedCost, calculateEstimatedDuration } from "../../../../lib/test-suite/metadata";

// Dynamic imports for server-side only modules
async function getTestRunner() {
  const { TestRunner, getTestStatus } = await import("../../../../lib/test-suite/runner");
  return { TestRunner, getTestStatus };
}

async function getAllTests() {
  const [{ signalTests }, { aiTests }, { webTests }] = await Promise.all([
    import("../../../../lib/test-suite/signal-e2ee"),
    import("../../../../lib/test-suite/ai-agent"),
    import("../../../../lib/test-suite/web-api"),
  ]);
  return [...signalTests, ...aiTests, ...webTests];
}

/**
 * GET handler - Start test run with SSE stream
 * Uses GET for EventSource compatibility
 */
export async function GET(_request: NextRequest) {
  try {
    // Dynamic import server-side modules
    const { TestRunner, getTestStatus } = await getTestRunner();
    const allTests = await getAllTests();
  
  // Check if already running
  const status = getTestStatus();
  if (status.isRunning) {
    return new Response(
      JSON.stringify({
        error: "Test run already in progress",
        currentRunId: status.currentRunId,
      }),
      {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Generate run ID
  const runId = randomUUID();
  const runner = new TestRunner(runId);

  // Create SSE stream
  const stream = new ReadableStream({
    start(controller) {
      // Calculate estimates
      const estimatedCost = calculateEstimatedCost();
      const estimatedDuration = calculateEstimatedDuration();

      // Send initial run-started event
      controller.enqueue(
        `data: ${JSON.stringify({
          type: "run-started",
          runId,
          totalTests: allTests.length,
          estimatedCost,
          estimatedDuration,
        })}\n\n`
      );

      // Listen for progress events
      runner.on("progress", (update: any) => {
        try {
          controller.enqueue(`data: ${JSON.stringify(update)}\n\n`);
        } catch (error) {
          // Client disconnected
          console.log("Client disconnected from test stream");
        }
      });

      // Start tests
      runner
        .runAll(allTests)
        .then(() => {
          controller.close();
        })
        .catch((error: any) => {
          controller.enqueue(
            `data: ${JSON.stringify({
              type: "error",
              error: error.message,
            })}\n\n`
          );
          controller.close();
        });
    },
    cancel() {
      // Handle cancellation
      console.log("Test run stream cancelled");
    },
  });

  // Return SSE response
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
  } catch (error: any) {
    console.error("Failed to initialize test runner:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to initialize test runner",
        details: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
