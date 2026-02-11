/**
 * ============================================================================
 * DIAGNOSTICS PROBE - SYSTEM METRICS COLLECTOR
 * ============================================================================
 *
 * This module implements the diag-probe service, which periodically collects
 * system metrics from the host machine and sends them to the sysmaint-agent
 * via encrypted Signal Protocol messages.
 *
 * PURPOSE:
 *
 * The probe provides visibility into system health by:
 * 1. Sampling host metrics (CPU, memory, swap, network)
 * 2. Querying relay server diagnostics
 * 3. Packaging into telemetry reports
 * 4. Encrypting and sending to sysmaint-agent
 *
 * COLLECTED METRICS:
 *
 * Host Metrics (from /proc filesystem):
 * - CPU utilization percentage
 * - Memory usage percentage
 * - Swap usage percentage
 * - Network bytes in/out (cumulative)
 * - System load averages (1m, 5m, 15m)
 *
 * Relay Metrics (from relay /diagnostics):
 * - Relay uptime
 * - Registered users count
 * - Active WebSocket connections
 * - Message queue depth
 * - Prekey bundle count
 *
 * ARCHITECTURE:
 *
 * The probe runs as a continuous loop:
 * 1. Collect host metrics from /proc
 * 2. Fetch relay diagnostics via HTTP
 * 3. Package into SysmaintTelemetryReport
 * 4. Encrypt via Signal Protocol
 * 5. Send to sysmaint-agent via relay
 * 6. Sleep for interval (default: 10 seconds)
 * 7. Repeat
 *
 * SECURITY:
 *
 * All telemetry is sent end-to-end encrypted using Signal Protocol.
 * The relay cannot read the telemetry content, only route it.
 *
 * SIGNAL PROTOCOL:
 *
 * The probe maintains a Signal identity ("diagprobe") and establishes
 * a session with the sysmaint-agent for encrypted communication.
 *
 * ============================================================================
 */

// Filesystem utilities
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";

// OS utilities for loadavg and CPU info
import os from "node:os";

// Path utilities
import path from "node:path";

// Utility for delays
import { setTimeout as delay } from "node:timers/promises";

// UUID generation for report IDs
import { randomUUID } from "node:crypto";

// Signal Protocol types
import { ProtocolAddress } from "@signalapp/libsignal-client";

// SysMaint protocol message types
import {
  encodeSysmaintMessage,
  type HostMetrics,
  type RelaySnapshot,
  type SysmaintTelemetryReport
} from "@mega/sysmaint-protocol";

// Signal Protocol operations
import {
  encryptMessage,
  exportBundle,
  generatePreKeys,
  initSession,
  initializeIdentity,
  openStore,
  type Bundle
} from "@mega/signal-core";

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Relay server URL for Signal communication and diagnostics.
 * Default uses Docker internal networking.
 */
const relayUrl = process.env.RELAY_URL ?? "http://relay:8080";

/**
 * Telemetry reporting interval in milliseconds.
 * Default: 10 seconds between reports.
 */
const intervalMs = Number(process.env.SYSMAINT_PROBE_INTERVAL_MS ?? "10000");

/**
 * Signal identity name for this probe.
 * Messages are sent FROM this identity.
 */
const localId = process.env.DIAG_PROBE_ID ?? "diagprobe";

/**
 * Target identity to send telemetry TO.
 * Default is "sysmaint" (the AI agent).
 */
const targetId = process.env.SYSMAINT_ID ?? "sysmaint";

/**
 * Path to Signal Protocol encrypted database.
 * Stores identity keys, sessions, prekeys.
 */
const signalDbPath = process.env.DIAG_PROBE_SIGNAL_DB ?? "/home/node/.mega/diagprobe.db";

/**
 * Passphrase for Signal database encryption.
 * REQUIRED for accessing cryptographic keys.
 */
const passphrase = process.env.MEGA_PASSPHRASE;

// Validate required configuration
if (!passphrase) {
  throw new Error("MEGA_PASSPHRASE is required for diag-probe.");
}

// ============================================================================
// DATABASE SETUP
// ============================================================================

/**
 * Create directory for database if needed.
 */
mkdirSync(path.dirname(signalDbPath), { recursive: true });

/**
 * Initialize Signal Protocol state.
 */
const signalState = openStore(signalDbPath, passphrase);

// ============================================================================
// CPU METRICS COLLECTION
// ============================================================================

/**
 * Previous CPU sample for calculating utilization.
 * Stores idle and total ticks from /proc/stat.
 */
let lastCpuSample: { idle: number; total: number } | null = null;

/**
 * Parse CPU statistics from /proc/stat.
 *
 * /proc/stat contains system-wide CPU statistics in this format:
 * cpu  user nice system idle iowait irq softirq steal guest guest_nice
 *
 * We calculate:
 * - idle: idle + iowait (time CPU was not doing work)
 * - total: sum of all fields (total time)
 *
 * By comparing two samples, we can calculate CPU utilization %.
 *
 * @param text - Content of /proc/stat
 * @returns Object with idle and total tick counts
 */
function parseCpuStat(text: string): { idle: number; total: number } {
  // Get first line (aggregate CPU stats)
  const line = text.split("\n")[0] ?? "";

  // Split into fields and convert to numbers
  const parts = line
    .trim()
    .split(/\s+/)
    .slice(1)  // Skip "cpu" label
    .map((part) => Number(part));

  // Total ticks = sum of all fields
  const total = parts.reduce(
    (sum, value) => sum + (Number.isFinite(value) ? value : 0),
    0
  );

  // Idle ticks = idle + iowait (indices 3 and 4)
  const idle = (parts[3] ?? 0) + (parts[4] ?? 0);

  return { idle, total };
}

/**
 * Compute CPU utilization percentage from two samples.
 *
 * Formula:
 * utilization = (totalDelta - idleDelta) / totalDelta * 100
 *
 * Where:
 * - totalDelta = currentTotal - previousTotal
 * - idleDelta = currentIdle - previousIdle
 *
 * This gives the percentage of time the CPU was busy.
 *
 * @param prev - Previous CPU sample
 * @param next - Current CPU sample
 * @returns CPU utilization percentage (0-100)
 */
function computeCpuPct(
  prev: { idle: number; total: number },
  next: { idle: number; total: number }
): number {
  const idleDelta = next.idle - prev.idle;
  const totalDelta = next.total - prev.total;

  if (totalDelta <= 0) return 0;

  return ((totalDelta - idleDelta) / totalDelta) * 100;
}

// ============================================================================
// MEMORY METRICS COLLECTION
// ============================================================================

/**
 * Parse memory statistics from /proc/meminfo.
 *
 * /proc/meminfo contains memory usage information in this format:
 * MemTotal:       16384000 kB
 * MemAvailable:    8192000 kB
 * SwapTotal:       4194304 kB
 * SwapFree:        4194304 kB
 *
 * We calculate:
 * - Memory percentage: (Total - Available) / Total * 100
 * - Swap percentage: (Total - Free) / Total * 100
 *
 * @param text - Content of /proc/meminfo
 * @returns Object with memPct and swapPct
 */
function parseMeminfo(text: string): { memPct: number; swapPct: number } {
  const values = new Map<string, number>();

  // Parse each line
  for (const line of text.split("\n")) {
    const [key, rest] = line.split(":");
    if (!key || !rest) continue;

    // Extract first numeric value (in kB)
    const first = Number(rest.trim().split(/\s+/)[0]);
    values.set(key, Number.isFinite(first) ? first : 0);
  }

  // Get values (in kB)
  const memTotal = values.get("MemTotal") ?? 0;
  const memAvail = values.get("MemAvailable") ?? 0;
  const swapTotal = values.get("SwapTotal") ?? 0;
  const swapFree = values.get("SwapFree") ?? 0;

  // Calculate percentages
  const memPct = memTotal > 0 ? ((memTotal - memAvail) / memTotal) * 100 : 0;
  const swapPct = swapTotal > 0 ? ((swapTotal - swapFree) / swapTotal) * 100 : 0;

  return { memPct, swapPct };
}

// ============================================================================
// NETWORK METRICS COLLECTION
// ============================================================================

/**
 * Parse network statistics from /proc/net/dev.
 *
 * /proc/net/dev contains per-interface network statistics:
 * Inter-|   Receive                                                |  Transmit
 *  face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
 *   eth0: 1234567    1234    0    0    0     0          0         0  7654321    5678    0    0    0     0       0          0
 *
 * We sum rx_bytes (index 1) and tx_bytes (index 9) across all interfaces
 * except loopback (lo).
 *
 * @param text - Content of /proc/net/dev
 * @returns Object with netInBytes and netOutBytes (cumulative)
 */
function parseNetDev(text: string): { netInBytes: number; netOutBytes: number } {
  // Skip header lines (first 2 lines)
  const lines = text.trim().split("\n").slice(2);

  let rxTotal = 0;
  let txTotal = 0;

  for (const line of lines) {
    const parts = line.trim().split(/[:\s]+/);
    const iface = parts[0];

    // Skip loopback interface
    if (!iface || iface === "lo") continue;

    // Extract receive bytes (index 1) and transmit bytes (index 9)
    const rx = Number(parts[1] ?? 0);
    const tx = Number(parts[9] ?? 0);

    rxTotal += Number.isFinite(rx) ? rx : 0;
    txTotal += Number.isFinite(tx) ? tx : 0;
  }

  return { netInBytes: rxTotal, netOutBytes: txTotal };
}

// ============================================================================
// HOST METRICS AGGREGATION
// ============================================================================

/**
 * Sample all host metrics.
 *
 * This function:
 * 1. Reads /proc/stat for CPU
 * 2. Reads /proc/meminfo for memory
 * 3. Reads /proc/net/dev for network
 * 4. Calculates CPU utilization
 * 5. Gets load averages from Node.js os module
 *
 * CPU calculation:
 * - If we have a previous sample, calculate utilization from delta
 * - Otherwise, estimate from load average (less accurate)
 *
 * @returns Promise resolving to HostMetrics object
 */
async function sampleHostMetrics(): Promise<HostMetrics> {
  // Read all proc files in parallel
  const [cpuStat, meminfo, netdev] = await Promise.all([
    readFile("/proc/stat", "utf8"),
    readFile("/proc/meminfo", "utf8"),
    readFile("/proc/net/dev", "utf8")
  ]);

  // Parse current CPU stats
  const nowCpu = parseCpuStat(cpuStat);

  let cpuPct = 0;
  if (lastCpuSample) {
    // Calculate utilization from delta
    cpuPct = computeCpuPct(lastCpuSample, nowCpu);
  } else {
    // First sample - estimate from load average
    // Load average / num_cpus * 100 gives rough estimate
    const load = os.loadavg()[0] ?? 0;
    cpuPct = (load / Math.max(os.cpus().length, 1)) * 100;
  }

  // Store current sample for next iteration
  lastCpuSample = nowCpu;

  // Parse memory and network
  const mem = parseMeminfo(meminfo);
  const net = parseNetDev(netdev);

  // Build and return metrics object
  return {
    cpuPct,
    memPct: mem.memPct,
    swapPct: mem.swapPct,
    netInBytes: net.netInBytes,
    netOutBytes: net.netOutBytes,
    // Load averages [1-min, 5-min, 15-min]
    load: [os.loadavg()[0] ?? 0, os.loadavg()[1] ?? 0, os.loadavg()[2] ?? 0]
  };
}

// ============================================================================
// NETWORK HELPERS
// ============================================================================

/**
 * HTTP GET helper with JSON parsing.
 *
 * @param url - Target URL
 * @returns Promise resolving to JSON response
 * @throws Error on HTTP error
 */
async function httpGetJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }
  return (await res.json()) as T;
}

/**
 * HTTP POST helper with JSON body.
 *
 * @param url - Target URL
 * @param body - Request body (JSON serialized)
 * @returns Promise resolving to JSON response
 * @throws Error on HTTP error
 */
async function httpPostJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }
  return (await res.json()) as T;
}

/**
 * Validate prekey bundle payload.
 *
 * @param input - Unknown data to validate
 * @returns Validated Bundle
 * @throws Error if invalid
 */
function ensureBundle(input: unknown): Bundle {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid prekey bundle payload.");
  }
  const bundle = input as Bundle;
  if (!bundle.id) {
    throw new Error("Invalid prekey bundle payload.");
  }
  return bundle;
}

// ============================================================================
// SIGNAL PROTOCOL SETUP
// ============================================================================

/**
 * Ensure Signal identity is initialized and registered.
 *
 * This function:
 * 1. Creates identity if not exists
 * 2. Generates fresh prekeys
 * 3. Registers with relay
 * 4. Uploads prekey bundle
 */
async function ensureIdentityBootstrapped(): Promise<void> {
  // Check for existing identity
  if (!signalState.getLocalIdentity()) {
    await initializeIdentity(signalState, localId, 1);
  }

  // Generate fresh prekeys
  await generatePreKeys(signalState, 1);

  // Register with relay
  await httpPostJson(`${relayUrl}/v1/register`, { id: localId });

  // Upload prekey bundle
  const bundle = await exportBundle(signalState);
  await httpPostJson(`${relayUrl}/v1/prekeys`, { id: localId, bundle });
}

/**
 * Ensure we have a Signal session with a peer.
 *
 * If no session exists, fetches their prekey bundle and establishes one.
 *
 * @param peerId - Peer identity name
 */
async function ensureSessionWith(peerId: string): Promise<void> {
  const address = ProtocolAddress.new(peerId, 1);

  // Check for existing session
  const existing = await signalState.sessionStore.getSession(address);
  if (existing) return;

  // Fetch peer's prekey bundle
  const payload = await httpGetJson<{ id: string; bundle: Bundle }>(
    `${relayUrl}/v1/prekeys/${peerId}`
  );

  // Establish session
  await initSession(signalState, ensureBundle(payload.bundle));
}

// ============================================================================
// RELAY DIAGNOSTICS
// ============================================================================

/**
 * Fetch relay server diagnostics.
 *
 * Queries the relay /diagnostics endpoint for current status.
 *
 * @returns Promise resolving to RelaySnapshot
 */
async function fetchRelaySnapshot(): Promise<RelaySnapshot> {
  const payload = await httpGetJson<{
    uptimeSec: number;
    queueDepthHistogram: Record<string, number>;
    counts: {
      users: number;
      prekeys: number;
      queuedMessages: number;
      activeConnections: number;
    };
  }>(`${relayUrl}/diagnostics`);

  return {
    uptimeSec: payload.uptimeSec,
    queueDepthHistogram: payload.queueDepthHistogram,
    counts: payload.counts
  };
}

// ============================================================================
// TELEMETRY PUBLISHING
// ============================================================================

/**
 * Publish telemetry report to sysmaint-agent.
 *
 * This function:
 * 1. Ensures session with target
 * 2. Samples host metrics
 * 3. Fetches relay snapshot
 * 4. Builds telemetry report
 * 5. Encrypts via Signal Protocol
 * 6. Sends to relay for delivery
 */
async function publishTelemetry(): Promise<void> {
  // Ensure encrypted session exists
  await ensureSessionWith(targetId);

  // Collect metrics in parallel
  const [host, relay] = await Promise.all([
    sampleHostMetrics(),
    fetchRelaySnapshot()
  ]);

  // Build telemetry report
  const report: SysmaintTelemetryReport = {
    version: 1,
    kind: "telemetry.report",
    reportId: randomUUID(),
    source: localId,
    relay,
    host,
    createdAt: Date.now()
  };

  // Encrypt report
  const envelope = await encryptMessage(
    signalState,
    targetId,
    encodeSysmaintMessage(report)
  );

  // Send via relay
  await httpPostJson(`${relayUrl}/v1/messages`, {
    from: localId,
    to: targetId,
    envelope
  });

  // Log summary
  console.log(
    `[probe] sent telemetry report=${report.reportId} ` +
    `cpu=${report.host.cpuPct.toFixed(1)} ` +
    `mem=${report.host.memPct.toFixed(1)} ` +
    `queued=${report.relay.counts.queuedMessages}`
  );
}

// ============================================================================
// MAIN LOOP
// ============================================================================

/**
 * Main entry point.
 *
 * Sets up identity and runs continuous telemetry loop.
 */
async function main(): Promise<void> {
  // Initialize Signal identity
  await ensureIdentityBootstrapped();

  console.log(
    `diag-probe started id=${localId} -> ${targetId} ` +
    `relay=${relayUrl} interval=${intervalMs}ms`
  );

  // Main loop
  while (true) {
    try {
      await publishTelemetry();
    } catch (err) {
      console.error("[probe] telemetry error", err);
    }

    // Wait for next interval
    await delay(intervalMs);
  }
}

// Start the probe
void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
