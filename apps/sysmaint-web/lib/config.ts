/**
 * ============================================================================
 * CONFIGURATION MODULE
 * ============================================================================
 *
 * Centralized configuration management for the sysmaint-web application.
 * All environment variables are resolved here with sensible defaults.
 *
 * PURPOSE:
 * - Single source of truth for configuration
 * - Type-safe configuration access
 * - Sensible defaults for development
 * - Environment-based configuration
 *
 * ENVIRONMENT VARIABLES:
 * - RELAY_URL: Signal relay server URL
 * - ALICE_ID: Web app Signal identity
 * - BOB_ID: Demo user Signal identity
 * - SYSMAINT_ID: AI agent Signal identity
 * - SYSMAINT_WEB_SIGNAL_DB: Path to Alice's Signal database
 * - BOB_SIGNAL_DB: Path to Bob's Signal database (for demo)
 * - SYSMAINT_STATE_DB: Path to shared state database
 * - SYSMAINT_CHAT_TIMEOUT_MS: AI reply timeout
 *
 * ============================================================================
 */

import path from "node:path";

/**
 * Default data directory for databases.
 * Located in project root under .sysmaint/
 */
const defaultDataDir = path.join(process.cwd(), ".sysmaint");

/**
 * Relay server URL for Signal Protocol communication.
 * 
 * Environment: RELAY_URL
 * Default: "http://relay:8080" (Docker internal networking)
 */
export const relayUrl = process.env.RELAY_URL ?? "http://relay:8080";

/**
 * Signal identity name for the web app (Alice).
 * 
 * This is the identity used when chatting with SysMaint agent.
 * Environment: ALICE_ID
 * Default: "alice"
 */
export const aliceId = process.env.ALICE_ID ?? "alice";

/**
 * Signal identity name for demo user (Bob).
 * 
 * Used in the 3-panel demo for Alice <-> Bob chat.
 * Environment: BOB_ID
 * Default: "bob"
 */
export const bobId = process.env.BOB_ID ?? "bob";

/**
 * Signal identity name for SysMaint AI agent.
 * 
 * This is who we send chat prompts to.
 * Environment: SYSMAINT_ID
 * Default: "sysmaint"
 */
export const sysmaintId = process.env.SYSMAINT_ID ?? "sysmaint";

/**
 * Path to Alice's encrypted Signal database.
 * 
 * Stores identity keys, sessions, and prekeys for Alice.
 * Environment: SYSMAINT_WEB_SIGNAL_DB
 * Default: .sysmaint/alice-web.db
 */
export const signalDbPath = process.env.SYSMAINT_WEB_SIGNAL_DB ?? path.join(defaultDataDir, "alice-web.db");

/**
 * Path to Bob's encrypted Signal database (for demo).
 * 
 * Stores cryptographic state for demo user Bob.
 * Environment: BOB_SIGNAL_DB
 * Default: .sysmaint/bob-web.db
 */
export const bobSignalDbPath = process.env.BOB_SIGNAL_DB ?? path.join(defaultDataDir, "bob-web.db");

/**
 * Path to shared state database.
 * 
 * This is shared with sysmaint-agent and stores:
 * - Telemetry snapshots
 * - Chat history
 * - Tool call logs
 * - Usage statistics
 * 
 * Environment: SYSMAINT_STATE_DB
 * Default: .sysmaint/sysmaint-state.db
 */
export const stateDbPath = process.env.SYSMAINT_STATE_DB ?? path.join(defaultDataDir, "sysmaint-state.db");

/**
 * Maximum wait time for AI chat replies (milliseconds).
 * 
 * If SysMaint agent doesn't respond within this time,
 * the API returns a timeout error.
 * 
 * Environment: SYSMAINT_CHAT_TIMEOUT_MS
 * Default: 25000 (25 seconds)
 */
export const waitTimeoutMs = Number(process.env.SYSMAINT_CHAT_TIMEOUT_MS ?? "25000");
