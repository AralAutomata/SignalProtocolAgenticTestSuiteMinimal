/**
 * ============================================================================
 * DENO SERVICE CLIENT
 * ============================================================================
 *
 * Node.js client for calling the Deno Test Overview Service.
 * Generates AI-powered test analysis reports.
 *
 * @module apps/sysmaint-web/lib/test-suite/deno-client
 * ============================================================================
 */

const DENO_SERVICE_URL = process.env.DENO_TEST_OVERVIEW_URL || "http://deno-test-overview:8000";

/**
 * Generate formal test report using Deno service
 */
export async function generateReportWithDeno(testData: any): Promise<string> {
  const response = await fetch(`${DENO_SERVICE_URL}/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(testData),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Deno service error: ${error}`);
  }

  const result = await response.json();
  return result.report;
}

/**
 * Check if Deno service is healthy
 */
export async function isDenoServiceHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`${DENO_SERVICE_URL}/health`, {
      method: "GET",
    });
    return response.ok;
  } catch {
    return false;
  }
}
