/**
 * ============================================================================
 * API ROUTE: POST /api/test/overview
 * ============================================================================
 *
 * Generate test analysis report and send to Alice via E2EE Signal message.
 *
 * @module apps/sysmaint-web/app/api/test/overview/route
 * ============================================================================
 */

export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { randomUUID } from "crypto";

// Dynamic imports for server-side only modules
async function getTestData() {
  const { getTestDataForAnalysis } = await import("../../../../lib/test-suite/database");
  return getTestDataForAnalysis();
}

async function getDenoClient() {
  const { generateReportWithDeno, isDenoServiceHealthy } = await import("../../../../lib/test-suite/deno-client");
  return { generateReportWithDeno, isDenoServiceHealthy };
}

async function getSignalMessenger() {
  const { sendPromptToSysmaint } = await import("../../../../lib/signal");
  return { sendPromptToSysmaint };
}

// In-memory store for the latest test report (for display in UI)
let latestTestReport: {
  report: string;
  aiResponse: string;
  sentAt: number;
  requestId: string;
} | null = null;

/**
 * POST handler - Generate and send test overview
 */
export async function POST(_request: NextRequest) {
  try {
    // Dynamic import server-side modules
    const { isDenoServiceHealthy, generateReportWithDeno } = await getDenoClient();
    const { sendPromptToSysmaint } = await getSignalMessenger();
    
    // 1. Check if Deno service is available
    const isHealthy = await isDenoServiceHealthy();
    if (!isHealthy) {
      return new Response(
        JSON.stringify({ 
          error: "Deno service unavailable",
          message: "The test overview service is not running. Please ensure the deno-test-overview container is started."
        }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }

    // 2. Query test data
    console.log("[Test Overview] Querying test data...");
    const testData = await getTestData();
    
    if (testData.totalRuns === 0) {
      return new Response(
        JSON.stringify({ 
          error: "No test data",
          message: "No test runs found in database. Run some tests first."
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 3. Generate report via Deno service
    console.log(`[Test Overview] Generating report for ${testData.totalRuns} runs...`);
    const report = await generateReportWithDeno(testData);

    // 4. Send to Alice via E2EE Signal message
    console.log("[Test Overview] Sending report to Alice via Signal...");
    
    const messagePrefix = "📊 AUTOMATED TEST SUITE ANALYSIS\n" +
      "═══════════════════════════════════════════════\n\n";
    
    const messageSuffix = "\n\n═══════════════════════════════════════════════\n" +
      "Reply with:\n" +
      "• \"Run tests\" - Execute test suite\n" +
      "• \"Status\" - Get system status\n" +
      "═══════════════════════════════════════════════";
    
    const fullMessage = messagePrefix + report + messageSuffix;
    
    // Send via Signal Protocol (E2EE)
    const result = await sendPromptToSysmaint(fullMessage);

    console.log("[Test Overview] Report sent successfully");

    // Store the report and response for UI display
    latestTestReport = {
      report: report,
      aiResponse: result.reply,
      sentAt: Date.now(),
      requestId: result.requestId,
    };

    // 5. Return success with full report and AI response
    return Response.json({
      success: true,
      message: "Test overview sent to Alice via Signal Protocol",
      requestId: result.requestId,
      runsAnalyzed: testData.totalRuns,
      report: report,
      aiResponse: result.reply,
    });

  } catch (error: any) {
    console.error("[Test Overview] Error:", error);
    return new Response(
      JSON.stringify({ 
        error: "Failed to generate test overview",
        message: error.message
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * GET handler - Retrieve the latest test report
 */
export async function GET(_request: NextRequest) {
  if (!latestTestReport) {
    return Response.json({
      hasReport: false,
      message: "No test report available. Click 'Tests Overview' to generate one."
    });
  }

  return Response.json({
    hasReport: true,
    report: latestTestReport.report,
    aiResponse: latestTestReport.aiResponse,
    sentAt: latestTestReport.sentAt,
    requestId: latestTestReport.requestId,
  });
}
