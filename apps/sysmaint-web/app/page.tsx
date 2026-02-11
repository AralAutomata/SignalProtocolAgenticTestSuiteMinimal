/**
 * ============================================================================
 * Dashboard Page Component - System Status Overview
 * ============================================================================
 * 
 * PURPOSE:
 * Main dashboard page displaying real-time system telemetry and metrics.
 * This is the application's home page (/) and provides a comprehensive
 * overview of system health, resource usage, and AI agent activity.
 * 
 * FEATURES:
 * - Auto-refreshing metrics (every 5 seconds)
 * - Real-time system snapshot display (CPU, memory, swap)
 * - Relay server statistics (users, prekeys, connections)
 * - LLM usage tracking (requests, tokens, cost estimation)
 * - Token usage reset functionality
 * - Staleness detection for data freshness
 * - Error handling and loading states
 * 
 * ARCHITECTURE:
 * - Next.js Client Component ("use client" directive)
 * - Uses React hooks for state management:
 *   - useState: Local component state
 *   - useEffect: Side effects (data fetching, timers)
 * - Pull-based data fetching from REST API
 * - No WebSocket (uses polling for simplicity)
 * 
 * DATA SOURCES:
 * - /api/status/current - Current system snapshot
 * - /api/status/usage/reset - Reset cumulative counters
 * 
 * DATA FLOW:
 * 1. Component mounts -> Initial data fetch
 * 2. setInterval starts 5-second polling loop
 * 3. Each poll: fetch -> parse -> update state -> re-render
 * 4. Component unmounts -> Cleanup timer
 * 
 * STATE MANAGEMENT:
 * - data: Current status payload from API (null until first load)
 * - error: Error message string (null when no error)
 * - resetBusy: Boolean for reset button loading state
 * - resetInfo: Success message after reset (null initially)
 * 
 * UI COMPONENTS:
 * - Status cards in responsive grid layout
 * - Metric displays with labels and values
 * - Error banners for API failures
 * - Reset button with loading state
 * - Empty state when no data available
 * 
 * FORMATTING UTILITIES:
 * - fmtTs: Formats Unix timestamp to localized string
 * - fmtNum: Formats numbers with locale-specific separators
 * - fmtUsd: Formats currency with 6 decimal places
 * 
 * RESPONSIVE DESIGN:
 * - CSS Grid layout adapts to screen size
 * - Cards stack on smaller screens
 * - Font sizes adjust for readability
 * 
 * PERFORMANCE:
 * - Efficient re-rendering via React's diffing
 * - Cleanup prevents memory leaks
 * - Polling interval balances freshness vs. load
 * 
 * ERROR HANDLING:
 * - Network errors displayed in UI
 * - Failed fetches don't crash the app
 * - Reset errors shown inline
 * - Graceful degradation when API unavailable
 * 
 * TYPE DEFINITIONS:
 * StatusPayload: Complete API response structure
 * - ok: Success indicator
 * - staleSeconds: Data age indicator
 * - usage: LLM token usage statistics
 * - snapshot: System telemetry data
 * 
 * @module apps/sysmaint-web/app/page
 * @see {@link /api/status/current} Data source API
 * @see {@link ../layout.tsx} Parent layout component
 * ============================================================================
 */

"use client";

import { useEffect, useState } from "react";

/**
 * Type definition for the status API response payload.
 * 
 * This interface matches the expected response from /api/status/current
 * and provides TypeScript type safety for the component state.
 */
type StatusPayload = {
  /** Indicates whether the API request was successful */
  ok: boolean;
  
  /**
   * Time in seconds since last data update.
   * null if no snapshot exists yet.
   * Used to detect stale data.
   */
  staleSeconds: number | null;
  
  /**
   * LLM usage statistics from the SysMaint agent.
   * Tracks AI agent activity and estimated costs.
   */
  usage: {
    /** Total number of LLM API requests made */
    requests: number;
    
    /** Total input tokens consumed (prompts) */
    inputTokens: number;
    
    /** Total output tokens generated (replies) */
    outputTokens: number;
    
    /** Combined total of input + output tokens */
    totalTokens: number;
    
    /** Estimated cost in USD based on token rates */
    estimatedCostUsd: number;
    
    /** Average tokens per LLM reply for efficiency metrics */
    averageTokensPerReply: number;
    
    /** Timestamp of most recent reply (null if no replies yet) */
    lastReplyAt: number | null;
  };
  
  /**
   * System telemetry snapshot from diag-probe.
   * null if no data has been collected yet.
   */
  snapshot: {
    /** Unix timestamp when snapshot was created */
    createdAt: number;
    
    /** CPU usage percentage (0-100) */
    cpuPct: number;
    
    /** Memory usage percentage (0-100) */
    memPct: number;
    
    /** Swap usage percentage (0-100) */
    swapPct: number;
    
    /** Network bytes received since last snapshot */
    netInBytes: number;
    
    /** Network bytes transmitted since last snapshot */
    netOutBytes: number;
    
    /**
     * System load averages [1min, 5min, 15min].
     * Standard Unix load average values.
     */
    load: [number, number, number];
    
    /**
     * Relay server metrics.
     * Shows Signal Protocol relay health.
     */
    relay: {
      /** Number of registered users on relay */
      users: number;
      
      /** Total prekeys available across all users */
      prekeys: number;
      
      /** Messages waiting in delivery queue */
      queuedMessages: number;
      
      /** Active WebSocket connections */
      activeConnections: number;
      
      /** Relay server uptime in seconds */
      uptimeSec: number;
    };
  } | null;
};

/**
 * Formats a Unix timestamp to a localized date/time string.
 * 
 * @param ts - Unix timestamp in milliseconds
 * @returns Localized date/time string (e.g., "1/1/2024, 12:00:00 PM")
 * 
 * @example
 * fmtTs(1704067200000) // Returns: "1/1/2024, 12:00:00 PM" (in en-US locale)
 */
function fmtTs(ts: number): string {
  return new Date(ts).toLocaleString();
}

/**
 * Formats a number with locale-specific thousand separators.
 * 
 * @param value - Number to format
 * @returns Formatted string (e.g., "1,234,567")
 * 
 * @example
 * fmtNum(1234567) // Returns: "1,234,567"
 * fmtNum(1000)    // Returns: "1,000"
 */
function fmtNum(value: number): string {
  return new Intl.NumberFormat().format(value);
}

/**
 * Formats a number as USD currency with 6 decimal places.
 * 
 * Used for displaying precise cost estimates from LLM usage.
 * The high precision (6 decimals) is useful for tracking
 * fractional costs of individual API calls.
 * 
 * @param value - Cost value in USD
 * @returns Formatted currency string (e.g., "$0.001234")
 * 
 * @example
 * fmtUsd(0.001234) // Returns: "$0.001234"
 * fmtUsd(1.5)      // Returns: "$1.500000"
 */
function fmtUsd(value: number): string {
  return `$${value.toFixed(6)}`;
}

/**
 * Dashboard Page Component
 * 
 * Main system status dashboard with real-time telemetry display.
 * Automatically refreshes every 5 seconds to show current metrics.
 * 
 * @returns JSX.Element - The complete dashboard UI
 */
export default function DashboardPage() {
  /**
   * State: Current status data from API.
   * null initially, populated after first successful fetch.
   */
  const [data, setData] = useState<StatusPayload | null>(null);
  
  /**
   * State: Error message from API failures.
   * null when no error, string message when error occurs.
   */
  const [error, setError] = useState<string | null>(null);
  
  /**
   * State: Loading state for reset operation.
   * true while reset API call is in progress.
   */
  const [resetBusy, setResetBusy] = useState(false);
  
  /**
   * State: Success message after token usage reset.
   * Displays confirmation with timestamp of reset.
   */
  const [resetInfo, setResetInfo] = useState<string | null>(null);

  /**
   * Effect: Data fetching and polling setup.
   * 
   * Runs on component mount:
   * 1. Fetches current status immediately
   * 2. Sets up 5-second polling interval
   * 3. Cleans up on unmount (prevents memory leaks)
   * 
   * The polling approach provides near real-time updates without
   * the complexity of WebSocket connections.
   */
  useEffect(() => {
    /**
     * Flag to prevent state updates after unmount.
     * Important for avoiding React warnings about setting
     * state on unmounted components.
     */
    let stop = false;

    /**
     * Async function to fetch status data from API.
     * Handles both success and error cases.
     */
    const load = async () => {
      try {
        /**
         * Fetch current status from API.
         * cache: "no-store" ensures fresh data (bypasses browser cache)
         */
        const res = await fetch("/api/status/current", { cache: "no-store" });
        
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        
        const payload = (await res.json()) as StatusPayload;
        
        /**
         * Only update state if component still mounted.
         * Prevents memory leaks and React warnings.
         */
        if (!stop) {
          setData(payload);
          setError(null);
        }
      } catch (err) {
        if (!stop) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    // Trigger initial load
    void load();
    
    /**
     * Set up polling interval (every 5 seconds).
     * This provides a good balance between:
     * - Data freshness (updates frequently)
     * - Server load (not too many requests)
     * - User experience (feels "live")
     */
    const timer = setInterval(() => {
      void load();
    }, 5000);

    /**
     * Cleanup function called on component unmount.
     * - Sets stop flag to prevent state updates
     * - Clears polling interval
     * - Prevents memory leaks
     */
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []); // Empty deps = run once on mount

  /**
   * Handler: Reset token usage statistics.
   * 
   * Called when user clicks "Reset Token Usage" button.
   * Flow:
   * 1. Set loading state
   * 2. Call reset API
   * 3. Fetch fresh status data
   * 4. Update UI with confirmation
   * 5. Clear loading state
   */
  const onResetUsage = async () => {
    // Prevent concurrent resets
    if (resetBusy) return;
    
    setResetBusy(true);
    setResetInfo(null);
    
    try {
      // Call reset API
      const resetRes = await fetch("/api/status/usage/reset", {
        method: "POST",
        cache: "no-store"
      });
      
      if (!resetRes.ok) {
        throw new Error(`HTTP ${resetRes.status}`);
      }
      
      const resetPayload = (await resetRes.json()) as { 
        ok: boolean; 
        resetAt?: number; 
        error?: string 
      };
      
      if (!resetPayload.ok || !resetPayload.resetAt) {
        throw new Error(resetPayload.error ?? "Failed to reset usage totals.");
      }

      // Fetch fresh status after reset
      const statusRes = await fetch("/api/status/current", { cache: "no-store" });
      if (!statusRes.ok) {
        throw new Error(`HTTP ${statusRes.status}`);
      }
      
      const statusPayload = (await statusRes.json()) as StatusPayload;
      setData(statusPayload);
      setError(null);
      
      // Show confirmation with formatted timestamp
      setResetInfo(`Token usage reset at ${fmtTs(resetPayload.resetAt)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResetBusy(false);
    }
  };

  /**
   * Destructure data for easier access in JSX.
   * Using optional chaining to handle null data safely.
   */
  const snapshot = data?.snapshot;
  const usage = data?.usage;

  return (
    <section>
      {/* Page header */}
      <h1>System Status Dashboard</h1>
      
      {/* Subtitle explaining data source */}
      <p className="sub">
        Encrypted telemetry from Signal messages (Alice/SysMaint stack).
      </p>
      
      {/* Error display */}
      {error ? <p className="sub">Error: {error}</p> : null}
      
      {/* Reset confirmation message */}
      {resetInfo ? <p className="sub">{resetInfo}</p> : null}
      
      {/* Empty state: No data available yet */}
      {!snapshot ? (
        <div className="card">
          <div className="label">Status</div>
          <div className="value">No snapshots yet</div>
          <div className="sub">
            Start `diag-probe` and `sysmaint-agent` to populate telemetry.
          </div>
        </div>
      ) : (
        <>
          {/* First row: Core system metrics */}
          <div className="grid">
            {/* CPU usage card */}
            <div className="card">
              <div className="label">CPU</div>
              <div className="value">{snapshot.cpuPct.toFixed(1)}%</div>
            </div>
            
            {/* Memory usage card */}
            <div className="card">
              <div className="label">Memory</div>
              <div className="value">{snapshot.memPct.toFixed(1)}%</div>
            </div>
            
            {/* Swap usage card */}
            <div className="card">
              <div className="label">Swap</div>
              <div className="value">{snapshot.swapPct.toFixed(1)}%</div>
            </div>
            
            {/* Relay queue depth card */}
            <div className="card">
              <div className="label">Queue</div>
              <div className="value">{snapshot.relay.queuedMessages}</div>
            </div>
          </div>

          {/* Second row: Relay server details */}
          <div className="grid" style={{ marginTop: 12 }}>
            {/* Registered users and prekeys */}
            <div className="card">
              <div className="label">Relay Users</div>
              <div className="value">{snapshot.relay.users}</div>
              <div className="sub">Prekeys: {snapshot.relay.prekeys}</div>
            </div>
            
            {/* Active WebSocket connections */}
            <div className="card">
              <div className="label">Active WebSockets</div>
              <div className="value">{snapshot.relay.activeConnections}</div>
              <div className="sub">Uptime: {snapshot.relay.uptimeSec}s</div>
            </div>
            
            {/* System load averages */}
            <div className="card">
              <div className="label">Load Average</div>
              <div className="value">
                {snapshot.load.map((v) => v.toFixed(2)).join(" / ")}
              </div>
            </div>
            
            {/* Data freshness indicator */}
            <div className="card">
              <div className="label">Last Update</div>
              <div className="value" style={{ fontSize: 16 }}>
                {fmtTs(snapshot.createdAt)}
              </div>
              <div className="sub">
                Staleness: {data?.staleSeconds ?? "?"}s
              </div>
            </div>
          </div>

          {/* Third row: LLM usage statistics */}
          <div className="grid" style={{ marginTop: 12 }}>
            {/* Request count and reset button */}
            <div className="card">
              <div className="label">LLM Requests</div>
              <div className="value">{fmtNum(usage?.requests ?? 0)}</div>
              <div className="sub">
                Last reply: {usage?.lastReplyAt ? fmtTs(usage.lastReplyAt) : "n/a"}
              </div>
              <div style={{ marginTop: 10 }}>
                <button type="button" onClick={onResetUsage} disabled={resetBusy}>
                  {resetBusy ? "Resetting..." : "Reset Token Usage"}
                </button>
              </div>
            </div>
            
            {/* Token counts */}
            <div className="card">
              <div className="label">Input Tokens</div>
              <div className="value">{fmtNum(usage?.inputTokens ?? 0)}</div>
              <div className="sub">
                Output: {fmtNum(usage?.outputTokens ?? 0)}
              </div>
            </div>
            
            {/* Total tokens and average */}
            <div className="card">
              <div className="label">Total Tokens</div>
              <div className="value">{fmtNum(usage?.totalTokens ?? 0)}</div>
              <div className="sub">
                Avg/reply: {fmtNum(Math.round(usage?.averageTokensPerReply ?? 0))}
              </div>
            </div>
            
            {/* Cost estimation */}
            <div className="card">
              <div className="label">Estimated Spend</div>
              <div className="value">{fmtUsd(usage?.estimatedCostUsd ?? 0)}</div>
              <div className="sub">Based on configured model token rates</div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
