/**
 * ============================================================================
 * API ROUTE: GET /api/test/export
 * ============================================================================
 *
 * Export test run results as JSON
 *
 * @module apps/sysmaint-web/app/api/test/export/route
 * ============================================================================
 */

export const runtime = "nodejs";

import { NextRequest } from "next/server";

/**
 * GET handler - Export test run as JSON
 */
export async function GET(request: NextRequest) {
  try {
    // Dynamic import server-side only module
    const { exportTestRun } = await import("../../../../lib/test-suite/export");
    
    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId");
    const format = (searchParams.get("format") || "structured") as
      | "structured"
      | "flattened";

    // Validate parameters
    if (!runId) {
      return new Response(
        JSON.stringify({ error: "Missing runId parameter" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (!["structured", "flattened"].includes(format)) {
      return new Response(
        JSON.stringify({
          error: "Invalid format. Use 'structured' or 'flattened'",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Export test run
    const data = exportTestRun(runId, format);

    // Return JSON file
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="test-run-${runId}-${format}.json"`,
      },
    });
  } catch (error: any) {
    // Handle not found error
    if (error.message.includes("not found")) {
      return new Response(
        JSON.stringify({ error: error.message }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Handle other errors
    return new Response(
      JSON.stringify({
        error: "Failed to export test run",
        message: error.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
