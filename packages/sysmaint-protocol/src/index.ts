/**
 * ============================================================================
 * SYSMAINT PROTOCOL MODULE
 * ============================================================================
 * 
 * This module defines the typed message protocol for the SysMaint (System
 * Maintenance) agent system. It provides schemas and types for the various
 * message types exchanged between system components.
 * 
 * ARCHITECTURE OVERVIEW:
 * 
 * The SysMaint system consists of multiple components that communicate via
 * the Signal Protocol (end-to-end encrypted):
 * 
 * - diag-probe: Collects system telemetry and sends to sysmaint-agent
 * - sysmaint-agent: AI-powered agent that responds to queries and monitors telemetry
 * - sysmaint-web: Web UI that allows users to chat with sysmaint-agent
 * 
 * MESSAGE TYPES:
 * 
 * 1. TELEMETRY REPORT (diag-probe → sysmaint-agent)
 *    Contains system metrics (CPU, memory, network, relay stats)
 *    Sent periodically (e.g., every 10 seconds)
 * 
 * 2. CHAT PROMPT (user → sysmaint-agent)
 *    User's question or command
 *    Triggers AI processing and tool execution
 * 
 * 3. CHAT REPLY (sysmaint-agent → user)
 *    AI-generated response to a chat prompt
 *    Contains the answer and metadata (token usage, cost)
 * 
 * 4. CONTROL PING (diagnostic)
 *    Simple keepalive/control message
 * 
 * SECURITY:
 * 
 * All messages are encrypted using Signal Protocol before transmission.
 * This module handles the APPLICATION LAYER protocol - encryption is handled
 * by the signal-core package.
 * 
 * SCHEMA DESIGN:
 * 
 * Each message type has:
 * - A 'kind' discriminator field for type narrowing
 * - A version field for protocol evolution
 * - Required metadata (timestamps, IDs)
 * - Type-specific payload fields
 * 
 * We use discriminated unions to enable type-safe message handling.
 * 
 * ============================================================================
 */

// Node.js crypto for UUID generation
import { randomUUID } from "node:crypto";

// Zod for schema validation and type inference
import { z } from "zod";

// ============================================================================
// RELAY SERVER METRICS SCHEMAS
// ============================================================================

/**
 * RelayCountsSchema - Statistics about relay server state.
 * 
 * These counts provide a snapshot of the relay's current workload:
 * - users: Total registered identities
 * - prekeys: Uploaded prekey bundles available for session establishment
 * - queuedMessages: Undelivered messages waiting for recipients
 * - activeConnections: Currently connected WebSocket clients
 * 
 * These metrics help monitor relay health and capacity.
 */
export const RelayCountsSchema = z.object({
  // Number of registered users/identities
  // Non-negative integer
  users: z.number().int().nonnegative(),
  
  // Number of uploaded prekey bundles
  // Each registered user should have prekeys for receiving messages
  prekeys: z.number().int().nonnegative(),
  
  // Number of undelivered messages in the queue
  // High numbers may indicate connectivity issues or offline users
  queuedMessages: z.number().int().nonnegative(),
  
  // Number of active WebSocket connections
  // Shows real-time client engagement
  activeConnections: z.number().int().nonnegative()
});

/**
 * RelaySnapshotSchema - Complete relay diagnostics snapshot.
 * 
 * This provides a comprehensive view of relay health at a point in time.
 * It's sent by the relay server and consumed by diagnostics/monitoring.
 * 
 * FIELDS:
 * - uptimeSec: How long relay has been running (reliability indicator)
 * - queueDepthHistogram: Distribution of queue depths across users
 *   (helps identify if specific users are backing up)
 * - counts: Aggregate statistics from RelayCountsSchema
 */
export const RelaySnapshotSchema = z.object({
  // Relay uptime in seconds
  // Indicates stability (higher = more stable)
  uptimeSec: z.number().int().nonnegative(),
  
  // Histogram of message queue depths
  // Keys are bucket labels ("0", "1-5", "6-20", "21+")
  // Values are counts of users in each bucket
  // Helps identify users with backed-up message queues
  queueDepthHistogram: z.record(z.number().int().nonnegative()),
  
  // Aggregate relay statistics
  counts: RelayCountsSchema
});

// ============================================================================
// HOST METRICS SCHEMAS
// ============================================================================

/**
 * HostMetricsSchema - System resource utilization metrics.
 * 
 * These metrics are collected from the host machine running the services.
 * They provide insight into system health and resource constraints.
 * 
 * METRICS EXPLAINED:
 * 
 * cpuPct: CPU utilization percentage
 *   - 0-100% representing overall CPU usage
 *   - Can exceed 100% on multi-core systems (100% = 1 full core)
 *   - High values indicate CPU pressure
 * 
 * memPct: Memory utilization percentage
 *   - Percentage of total RAM in use
 *   - High values may lead to swapping (performance degradation)
 * 
 * swapPct: Swap utilization percentage
 *   - Percentage of swap space in use
 *   - Non-zero values indicate memory pressure
 *   - High values indicate severe memory shortage
 * 
 * netInBytes: Network bytes received
 *   - Cumulative count (use delta for rate calculation)
 *   - Monotonically increasing until counter wraps
 * 
 * netOutBytes: Network bytes transmitted
 *   - Cumulative count like netInBytes
 * 
 * load: System load averages
 *   - Tuple of [1-min, 5-min, 15-min] load averages
 *   - Represents average number of runnable processes
 *   - Rule of thumb: load > num_cores indicates CPU saturation
 *   - Example: [2.5, 1.8, 1.2] - high current load, trending down
 */
export const HostMetricsSchema = z.object({
  // CPU utilization percentage
  // Can exceed 100% on multi-core systems
  cpuPct: z.number().min(0),
  
  // Memory utilization percentage (0-100%)
  memPct: z.number().min(0),
  
  // Swap utilization percentage (0-100%)
  swapPct: z.number().min(0),
  
  // Network bytes received (cumulative counter)
  netInBytes: z.number().nonnegative(),
  
  // Network bytes transmitted (cumulative counter)
  netOutBytes: z.number().nonnegative(),
  
  // Load averages [1-min, 5-min, 15-min]
  // Shows trend: 1-min > 5-min > 15-min means load increasing
  load: z.tuple([z.number(), z.number(), z.number()])
});

// ============================================================================
// CHAT MESSAGE SCHEMAS
// ============================================================================

/**
 * SysmaintChatPromptSchema - User's chat message to SysMaint agent.
 * 
 * This represents a user's question, command, or prompt sent to the
 * AI-powered SysMaint agent. The agent will process this using LangChain
 * and respond with a SysmaintChatReply.
 * 
 * WORKFLOW:
 * 1. User enters prompt in web UI
 * 2. Frontend encrypts and sends via Signal Protocol
 * 3. sysmaint-agent receives, decrypts, parses
 * 4. Agent processes with LangChain (may call tools)
 * 5. Agent sends encrypted reply with matching requestId
 * 
 * FIELDS:
 * - requestId: Unique ID for correlating reply with prompt
 * - prompt: The user's actual message/question
 * - from: Sender's Signal identity
 * - createdAt: Timestamp for ordering and timeout handling
 */
export const SysmaintChatPromptSchema = z.object({
  // Protocol version - allows future evolution
  version: z.literal(1),
  
  // Message type discriminator
  kind: z.literal("chat.prompt"),
  
  // Unique request identifier (UUID)
  // Used to match replies with their corresponding prompts
  requestId: z.string().min(1),
  
  // The user's prompt/question
  // Examples: "What's the current CPU usage?", "Is the system healthy?"
  prompt: z.string().min(1),
  
  // Sender's Signal identity
  from: z.string().min(1),
  
  // Creation timestamp (milliseconds since epoch)
  createdAt: z.number().int().positive()
});

/**
 * SysmaintChatReplySchema - AI agent's response to a chat prompt.
 * 
 * This is the SysMaint agent's response to a user's chat prompt.
 * It contains the AI-generated reply and metadata about the processing.
 * 
 * WORKFLOW:
 * 1. Agent receives SysmaintChatPrompt
 * 2. Agent processes through LangChain (may execute tools)
 * 3. Agent generates reply text
 * 4. Agent creates reply with same requestId as prompt
 * 5. Agent encrypts and sends back to user
 * 
 * METADATA:
 * The reply includes the original requestId for correlation.
 * Additional metadata (token usage, cost) is stored in sysmaint-agent's
 * state database, not in the message itself.
 * 
 * FIELDS:
 * - requestId: Matches the corresponding chat.prompt
 * - reply: The AI-generated response text
 * - from: Always "sysmaint" (the agent's identity)
 * - createdAt: Timestamp for latency calculation
 */
export const SysmaintChatReplySchema = z.object({
  version: z.literal(1),
  kind: z.literal("chat.reply"),
  
  // Request ID - must match the corresponding chat.prompt
  requestId: z.string().min(1),
  
  // The AI-generated reply
  // This is the text the user will see
  reply: z.string().min(1),
  
  // Sender identity (always "sysmaint")
  from: z.string().min(1),
  
  createdAt: z.number().int().positive()
});

// ============================================================================
// TELEMETRY SCHEMA
// ============================================================================

/**
 * SysmaintTelemetryReportSchema - System telemetry report.
 * 
 * This is a periodic report sent by diag-probe to sysmaint-agent.
 * It contains both host-level metrics (CPU, memory) and relay-level
 * statistics, providing a complete picture of system health.
 * 
 * WORKFLOW:
 * 1. diag-probe collects metrics from /proc filesystem
 * 2. diag-probe queries relay server /diagnostics endpoint
 * 3. diag-probe bundles into SysmaintTelemetryReport
 * 4. diag-probe encrypts via Signal Protocol and sends to sysmaint
 * 5. sysmaint-agent decrypts and stores in state database
 * 
 * USAGE:
 * - Real-time monitoring in web UI dashboard
 * - Historical trend analysis
 * - Anomaly detection by AI agent
 * - Capacity planning
 * 
 * FIELDS:
 * - reportId: Unique identifier for this report
 * - source: Identity that generated the report (e.g., "diagprobe")
 * - relay: Relay server diagnostics snapshot
 * - host: Host system resource metrics
 * - createdAt: Report timestamp
 */
export const SysmaintTelemetryReportSchema = z.object({
  version: z.literal(1),
  kind: z.literal("telemetry.report"),
  
  // Unique report identifier (UUID)
  // Allows deduplication and tracking
  reportId: z.string().min(1),
  
  // Identity that generated this report
  // Usually "diagprobe" but could be other probes in future
  source: z.string().min(1),
  
  // Relay server diagnostics
  // Snapshot of relay state at report time
  relay: RelaySnapshotSchema,
  
  // Host system metrics
  // Resource utilization at report time
  host: HostMetricsSchema,
  
  createdAt: z.number().int().positive()
});

// ============================================================================
// CONTROL MESSAGE SCHEMA
// ============================================================================

/**
 * SysmaintControlSchema - Simple control/ping message.
 * 
 * This is a basic control message type for simple signaling.
 * Currently only implements "ping" but could be extended for:
 * - Keepalive messages
 * - Configuration updates
 * - Shutdown signals
 * 
 * WORKFLOW:
 * 1. Sender creates control message with current timestamp
 * 2. Encrypts and sends to recipient
 * 3. Recipient can use for latency measurement or connectivity check
 */
export const SysmaintControlSchema = z.object({
  version: z.literal(1),
  kind: z.literal("control.ping"),
  createdAt: z.number().int().positive()
});

// ============================================================================
// DISCRIMINATED UNION
// ============================================================================

/**
 * SysmaintMessageSchema - Discriminated union of all message types.
 * 
 * This is the master schema that encompasses all valid SysMaint protocol
 * messages. It uses Zod's discriminatedUnion to enable type-safe handling
 * based on the 'kind' field.
 * 
 * DISCRIMINATED UNIONS:
 * 
 * A discriminated union is a TypeScript pattern where objects share a
 * common "discriminator" field that indicates which variant they are.
 * 
 * Benefits:
 * 1. TYPE NARROWING: TypeScript knows exact type after checking 'kind'
 * 2. EXHAUSTIVENESS CHECKING: Compiler ensures all cases are handled
 * 3. TYPE SAFETY: Can't access fields that don't exist on a variant
 * 
 * Example:
 * ```typescript
 * function handleMessage(msg: SysmaintMessage) {
 *   switch (msg.kind) {
 *     case "chat.prompt":
 *       // TypeScript knows msg is SysmaintChatPrompt here
 *       console.log(msg.prompt);  // Valid
 *       break;
 *     case "telemetry.report":
 *       // TypeScript knows msg is SysmaintTelemetryReport here
 *       console.log(msg.host.cpuPct);  // Valid
 *       break;
 *   }
 * }
 * ```
 * 
 * The 'kind' field is the discriminator. Based on its value, we know
 * which other fields are present.
 */
export const SysmaintMessageSchema = z.discriminatedUnion("kind", [
  SysmaintChatPromptSchema,
  SysmaintChatReplySchema,
  SysmaintTelemetryReportSchema,
  SysmaintControlSchema
]);

// ============================================================================
// TYPE EXPORTS
// ============================================================================

/**
 * TypeScript types inferred from Zod schemas.
 * 
 * These types are automatically generated from the schemas above.
 * They provide compile-time type checking that matches the runtime
 * validation provided by Zod.
 * 
 * Usage:
 * ```typescript
 * import { SysmaintTelemetryReport, SysmaintChatPrompt } from "@mega/sysmaint-protocol";
 * 
 * function processTelemetry(report: SysmaintTelemetryReport) {
 *   console.log(report.host.cpuPct);  // Type-safe access
 * }
 * ```
 */

/** Relay statistics type */
export type RelaySnapshot = z.infer<typeof RelaySnapshotSchema>;

/** Host system metrics type */
export type HostMetrics = z.infer<typeof HostMetricsSchema>;

/** Chat prompt message type */
export type SysmaintChatPrompt = z.infer<typeof SysmaintChatPromptSchema>;

/** Chat reply message type */
export type SysmaintChatReply = z.infer<typeof SysmaintChatReplySchema>;

/** Telemetry report message type */
export type SysmaintTelemetryReport = z.infer<typeof SysmaintTelemetryReportSchema>;

/** Union type of all SysMaint messages */
export type SysmaintMessage = z.infer<typeof SysmaintMessageSchema>;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate a unique request ID.
 * 
 * Uses UUID v4 (random) for guaranteed uniqueness across distributed systems.
 * This is used for:
 * - Chat request IDs (matching prompts with replies)
 * - Telemetry report IDs (deduplication)
 * 
 * @returns A random UUID string (e.g., "550e8400-e29b-41d4-a716-446655440000")
 */
export function createRequestId(): string {
  return randomUUID();
}

/**
 * Encode a SysMaint message to JSON string.
 * 
 * This serializes a message object to a JSON string suitable for:
 * - Encryption (before sending via Signal Protocol)
 * - Storage (if needed in plaintext)
 * 
 * The resulting string is the input to Signal encryption functions.
 * 
 * Example:
 * ```typescript
 * const prompt: SysmaintChatPrompt = {
 *   version: 1,
 *   kind: "chat.prompt",
 *   requestId: createRequestId(),
 *   prompt: "Hello!",
 *   from: "alice",
 *   createdAt: Date.now()
 * };
 * 
 * const jsonString = encodeSysmaintMessage(prompt);
 * // jsonString: '{"version":1,"kind":"chat.prompt",...}'
 * 
 * // Then encrypt and send
 * const envelope = await encryptMessage(state, "sysmaint", jsonString);
 * ```
 * 
 * @param message - The message object to encode
 * @returns JSON string representation
 */
export function encodeSysmaintMessage(message: SysmaintMessage): string {
  return JSON.stringify(message);
}

/**
 * Decode and validate a SysMaint message from JSON string.
 * 
 * This parses a JSON string and validates it against the SysmaintMessageSchema.
 * It determines which message type it is based on the 'kind' field and
 * validates the corresponding schema.
 * 
 * Use this when receiving a message (after Signal decryption):
 * 
 * Example:
 * ```typescript
 * // After decrypting Signal message
 * const plaintext = await decryptMessage(state, envelope);
 * 
 * // Parse and validate
 * const message = decodeSysmaintMessage(plaintext);
 * 
 * // Type-safe handling
 * if (message.kind === "telemetry.report") {
 *   console.log(message.host.cpuPct);  // Valid - TypeScript knows type
 * }
 * ```
 * 
 * @param raw - JSON string to parse
 * @returns Validated SysmaintMessage object (typed based on 'kind')
 * @throws ZodError if validation fails
 */
export function decodeSysmaintMessage(raw: string): SysmaintMessage {
  // Parse JSON string to object
  const parsed = JSON.parse(raw);
  
  // Validate against discriminated union schema
  // Zod will check the 'kind' field and validate against the appropriate schema
  return SysmaintMessageSchema.parse(parsed);
}

/**
 * ============================================================================
 * PROTOCOL VERSIONING NOTES
 * ============================================================================
 * 
 * VERSION 1 (Current):
 * - Initial protocol implementation
 * - Four message types: chat.prompt, chat.reply, telemetry.report, control.ping
 * - Relay and host metrics as defined above
 * 
 * FUTURE VERSIONS:
 * 
 * To add new message types in version 2:
 * 1. Create new schema with version: z.literal(2)
 * 2. Add to discriminated union
 * 3. Update decodeSysmaintMessage to handle version detection
 * 
 * For backward compatibility:
 * - Receivers should accept messages with lower versions
 * - Senders should use the highest version both sides support
 * - Version negotiation could be added if needed
 * 
 * ============================================================================
 */
