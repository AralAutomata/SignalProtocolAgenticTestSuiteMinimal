/**
 * ============================================================================
 * TEST SUITE REGISTRY
 * ============================================================================
 *
 * Re-exports test metadata for UI display.
 * Actual test implementations are server-side only in runner.ts
 *
 * @module apps/sysmaint-web/lib/test-suite/index
 * ============================================================================
 */

// Re-export metadata (browser-safe)
export {
  allTestsMetadata as allTests,
  testsByCategory,
  getTestById,
  calculateEstimatedCost,
  calculateEstimatedDuration,
  getCategoryDisplayName,
} from "./metadata";

// Export metadata type
export type { TestMetadata } from "./metadata";
