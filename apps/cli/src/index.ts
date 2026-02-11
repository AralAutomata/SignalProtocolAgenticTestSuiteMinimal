/**
 * ============================================================================
 * SIGNAL PROTOCOL COMMAND LINE INTERFACE (CLI)
 * ============================================================================
 * 
 * This module implements a comprehensive CLI for Signal Protocol operations.
 * It provides commands for identity management, encryption/decryption,
 * session establishment, and interaction with the relay server.
 * 
 * CLI STRUCTURE:
 * 
 * mega [global-options] <command> [subcommand] [options]
 * 
 * Global Options:
 *   --db <path>          Path to local SQLite database
 *   --passphrase <pass>  Encryption passphrase for database
 *   --server <url>       Relay server URL (default: http://localhost:8080)
 * 
 * Commands:
 *   init                 Initialize a new Signal identity
 *   identity show        Display identity information
 *   prekey generate      Generate new prekeys
 *   bundle export        Export prekey bundle to share with peers
 *   session init         Initialize session from peer's bundle
 *   encrypt              Encrypt a message
 *   decrypt              Decrypt a message
 *   client register      Register with relay server
 *   client prekeys       Prekey operations via relay
 *   client send          Send encrypted message via relay
 *   client listen        Listen for incoming messages
 *   client inbox         List received messages
 *   admin diagnostics    Show relay server diagnostics
 *   repl                 Start interactive REPL
 * 
 * USE CASES:
 * 
 * 1. Local Testing (no network):
 *    mega init --id alice
 *    mega bundle export --out alice.bundle
 *    mega encrypt --to bob --in message.txt --out message.json
 *    mega decrypt --in message.json
 * 
 * 2. Network Communication:
 *    mega client register --id alice
 *    mega client prekeys upload
 *    mega client send --to bob --in message.txt
 *    mega client listen --id alice
 * 
 * SECURITY:
 * 
 * - Passphrase can be provided via:
 *   1. Command line option (--passphrase)
 *   2. Environment variable (MEGA_PASSPHRASE)
 *   3. Interactive prompt (most secure, not in shell history)
 * 
 * - Private keys never leave the encrypted database
 * - All cryptographic operations happen locally
 * 
 * ============================================================================
 */

// Commander.js - Command line interface framework
import { Command, CommanderError } from "commander";

// Node.js filesystem utilities
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

// Readline for interactive prompts
import { createInterface } from "node:readline/promises";

// Path utilities
import path from "node:path";

// OS utilities for home directory
import os from "node:os";

// WebSocket client for real-time message listening
import { WebSocket, type RawData } from "ws";

// Signal Protocol types
import { ProtocolAddress } from "@signalapp/libsignal-client";

// Import Signal operations from signal-core package
import {
  decryptMessage,
  encryptMessage,
  exportBundle,
  generatePreKeys,
  initSession,
  initializeIdentity,
  loadEnvelope,
  listInboxMessages,
  openStore,
  saveInboxMessage,
  type Bundle,
  type InboxMessage
} from "@mega/signal-core";

// ============================================================================
// CLI SETUP
// ============================================================================

/**
 * Create the main Commander program instance.
 * 
 * Commander provides declarative CLI definition with:
 * - Automatic help generation
 * - Option parsing and validation
 * - Subcommand support
 * - Error handling
 */
const program = new Command();

program
  .name("mega")
  .description("Minimal Signal Protocol CLI (phase zero)")
  // Global options available for all commands
  .option("--db <path>", "Path to local SQLite DB")
  .option("--passphrase <passphrase>", "Passphrase for local DB encryption")
  .option("--server <url>", "Relay server base URL", "http://localhost:8080");

// Override default exit behavior for better error handling
// This prevents Commander from calling process.exit() directly
program.exitOverride();

// ============================================================================
// PATH AND CONFIGURATION HELPERS
// ============================================================================

/**
 * Get default database path.
 * 
 * Stores database in user's home directory under ~/.mega/
 * This follows Unix conventions for application data storage.
 * 
 * @returns Default database path (e.g., /home/alice/.mega/mega.db)
 */
function defaultDbPath(): string {
  return path.join(os.homedir(), ".mega", "mega.db");
}

/**
 * Resolve database path from options or use default.
 * 
 * Priority:
 * 1. Command line --db option
 * 2. Default path
 * 
 * @param opts - Parsed options object
 * @returns Resolved database path
 */
function resolveDbPath(opts: { db?: string }): string {
  return opts.db ?? defaultDbPath();
}

/**
 * Ensure directory exists for database.
 * 
 * Creates parent directories recursively using mkdirSync.
 * Prevents "directory not found" errors when opening database.
 * 
 * @param dbPath - Path to database file
 */
function ensureDbDir(dbPath: string): void {
  const dir = path.dirname(dbPath);
  mkdirSync(dir, { recursive: true });
}

/**
 * Prompt for passphrase interactively.
 * 
 * This is the most secure way to provide a passphrase because:
 * - It doesn't appear in shell history
 * - It doesn't appear in process listings
 * - It can be hidden (though currently visible in this implementation)
 * 
 * @returns Promise resolving to entered passphrase
 * @throws Error if empty passphrase entered
 */
async function promptPassphrase(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const passphrase = await rl.question("Passphrase (input visible): ");
  rl.close();
  if (!passphrase) throw new Error("Passphrase required.");
  return passphrase;
}

/**
 * Resolve passphrase from options, environment, or prompt.
 * 
 * Priority:
 * 1. Command line --passphrase option (least secure, in shell history)
 * 2. MEGA_PASSPHRASE environment variable
 * 3. Interactive prompt (most secure)
 * 
 * @param opts - Parsed options object
 * @returns Promise resolving to passphrase
 */
async function resolvePassphrase(opts: { passphrase?: string }): Promise<string> {
  if (opts.passphrase) return opts.passphrase;
  if (process.env.MEGA_PASSPHRASE) return process.env.MEGA_PASSPHRASE;
  return await promptPassphrase();
}

// ============================================================================
// I/O HELPERS
// ============================================================================

/**
 * Read text from file or stdin.
 * 
 * Supports Unix convention where "-" means stdin:
 *   mega encrypt --in message.txt    # Read from file
 *   echo "hello" | mega encrypt      # Read from stdin (implied)
 *   mega encrypt --in -              # Read from stdin (explicit)
 * 
 * @param source - File path or "-" for stdin, undefined defaults to stdin
 * @returns Promise resolving to text content
 */
async function readText(source?: string): Promise<string> {
  if (!source || source === "-") {
    // Read from stdin
    return await new Promise((resolve, reject) => {
      let data = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => (data += chunk));
      process.stdin.on("end", () => resolve(data));
      process.stdin.on("error", reject);
    });
  }
  return await readFile(source, "utf8");
}

/**
 * Write text to file or stdout.
 * 
 * Supports Unix convention where "-" means stdout:
 *   mega encrypt --out message.json  # Write to file
 *   mega encrypt                     # Write to stdout (implied)
 *   mega encrypt --out -             # Write to stdout (explicit)
 * 
 * @param target - File path or "-" for stdout, undefined defaults to stdout
 * @param text - Content to write
 */
async function writeText(target: string | undefined, text: string): Promise<void> {
  if (!target || target === "-") {
    process.stdout.write(text);
    return;
  }
  await writeFile(target, text, "utf8");
}

/**
 * Read and parse JSON file.
 * 
 * Combines readText with JSON.parse for convenience.
 * Generic type T allows type inference of parsed result.
 * 
 * @param source - File path to read
 * @returns Promise resolving to parsed JSON as type T
 */
async function readJson<T>(source: string): Promise<T> {
  const content = await readText(source);
  return JSON.parse(content) as T;
}

// ============================================================================
// NETWORK HELPERS
// ============================================================================

/**
 * Resolve server URL from options or default.
 * 
 * @param opts - Parsed options object
 * @returns Server base URL
 */
function resolveServerUrl(opts: { server?: string }): string {
  return opts.server ?? "http://localhost:8080";
}

/**
 * Build WebSocket URL from HTTP URL.
 * 
 * Converts HTTP URL to WebSocket URL:
 * - http://  -> ws://
 * - https:// -> wss://
 * 
 * Example:
 *   http://localhost:8080 -> ws://localhost:8080/ws?client_id=alice
 * 
 * @param serverBase - Base HTTP URL
 * @param clientId - Client identity for WebSocket connection
 * @param wsOverride - Optional override URL
 * @returns WebSocket URL
 */
function resolveWsUrl(serverBase: string, clientId: string, wsOverride?: string): string {
  if (wsOverride) return wsOverride;
  const base = new URL(serverBase);
  const wsProtocol = base.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = new URL("/ws", `${wsProtocol}//${base.host}`);
  wsUrl.searchParams.set("client_id", clientId);
  return wsUrl.toString();
}

/**
 * HTTP POST helper with JSON body.
 * 
 * Sends JSON data to specified URL and parses JSON response.
 * Includes error handling for non-OK responses.
 * 
 * @param url - Target URL
 * @param body - Data to send (will be JSON serialized)
 * @returns Promise resolving to parsed response
 * @throws Error on HTTP error status
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
 * HTTP GET helper expecting JSON response.
 * 
 * @param url - Target URL
 * @returns Promise resolving to parsed JSON response
 * @throws Error on HTTP error status
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
 * Validate bundle payload.
 * 
 * Performs basic validation that a bundle object has required fields.
 * More detailed validation is done by the Signal library when processing.
 * 
 * @param input - Unknown object to validate
 * @returns Validated Bundle object
 * @throws Error if validation fails
 */
function ensureBundle(input: unknown): Bundle {
  if (!input || typeof input !== "object") throw new Error("Invalid bundle payload.");
  const bundle = input as Bundle;
  if (!bundle.id) throw new Error("Invalid bundle payload.");
  return bundle;
}

// ============================================================================
// LOCAL COMMANDS (NO NETWORK REQUIRED)
// ============================================================================

/**
 * COMMAND: init
 * 
 * Initialize a new local Signal identity.
 * 
 * This creates:
 * - Curve25519 identity key pair
 * - Registration ID
 * - Initial prekeys
 * 
 * Usage:
 *   mega init --id alice
 *   mega init --id alice --device 1
 */
program
  .command("init")
  .description("Initialize local identity and storage")
  .requiredOption("--id <id>", "Local identity id")
  .option("--device <id>", "Device id", "1")
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const dbPath = resolveDbPath(opts);
    ensureDbDir(dbPath);
    const passphrase = await resolvePassphrase(opts);

    const state = openStore(dbPath, passphrase);
    await initializeIdentity(state, cmdOpts.id, Number(cmdOpts.device));
    await generatePreKeys(state, 1);

    console.log(`Initialized identity '${cmdOpts.id}' in ${dbPath}`);
  });

/**
 * COMMAND: identity show
 * 
 * Display local identity information.
 * 
 * Shows:
 * - Identity name
 * - Registration ID
 * - Device ID
 * 
 * Usage:
 *   mega identity show
 */
program
  .command("identity")
  .description("Identity operations")
  .command("show")
  .description("Show local identity info")
  .action(async () => {
    const opts = program.opts();
    const dbPath = resolveDbPath(opts);
    const passphrase = await resolvePassphrase(opts);
    const state = openStore(dbPath, passphrase);
    console.log(
      JSON.stringify(
        {
          id: state.getLocalIdentity(),
          registrationId: state.getRegistrationId(),
          deviceId: state.getDeviceId()
        },
        null,
        2
      )
    );
  });

/**
 * COMMAND: prekey generate
 * 
 * Generate new prekeys.
 * 
 * Creates new one-time prekeys, signed prekeys, and Kyber prekeys.
 * Should be done periodically to replenish used prekeys.
 * 
 * Usage:
 *   mega prekey generate
 *   mega prekey generate --count 10
 */
program
  .command("prekey")
  .description("Prekey operations")
  .command("generate")
  .description("Generate new prekeys")
  .option("--count <n>", "Number of prekeys", "1")
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const dbPath = resolveDbPath(opts);
    const passphrase = await resolvePassphrase(opts);
    const state = openStore(dbPath, passphrase);
    await generatePreKeys(state, Number(cmdOpts.count));
    console.log(`Generated ${cmdOpts.count} prekeys.`);
  });

/**
 * COMMAND: bundle export
 * 
 * Export prekey bundle to share with peers.
 * 
 * The bundle contains public keys needed for others to message us.
 * It's JSON formatted and can be sent to peers or uploaded to relay.
 * 
 * Usage:
 *   mega bundle export --out alice.bundle.json
 */
program
  .command("bundle")
  .description("Bundle operations")
  .command("export")
  .description("Export local bundle")
  .requiredOption("--out <file>", "Output file")
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const dbPath = resolveDbPath(opts);
    const passphrase = await resolvePassphrase(opts);
    const state = openStore(dbPath, passphrase);

    const bundle = await exportBundle(state);
    await writeText(cmdOpts.out, JSON.stringify(bundle, null, 2));
    console.log(`Bundle exported to ${cmdOpts.out}`);
  });

/**
 * COMMAND: session init
 * 
 * Initialize session from peer's prekey bundle.
 * 
 * This performs X3DH key agreement to establish a Signal session
 * with another user. After this, you can encrypt messages to them.
 * 
 * Usage:
 *   mega session init --their-bundle bob.bundle.json
 */
program
  .command("session")
  .description("Session operations")
  .command("init")
  .description("Initialize a session from a peer bundle")
  .requiredOption("--their-bundle <file>", "Path to peer bundle JSON")
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const dbPath = resolveDbPath(opts);
    const passphrase = await resolvePassphrase(opts);
    const state = openStore(dbPath, passphrase);

    const bundle = await readJson<Bundle>(cmdOpts.theirBundle);
    await initSession(state, bundle);
    console.log(`Session initialized with ${bundle.id}`);
  });

/**
 * COMMAND: encrypt
 * 
 * Encrypt a message to a recipient.
 * 
 * Requires an established session with the recipient.
 * Input can be from file or stdin.
 * Output is JSON envelope.
 * 
 * Usage:
 *   mega encrypt --to bob --in message.txt --out message.json
 *   echo "hello" | mega encrypt --to bob
 */
program
  .command("encrypt")
  .description("Encrypt a message")
  .requiredOption("--to <id>", "Recipient id")
  .option("--in <file>", "Input file (default: stdin)")
  .option("--out <file>", "Output file (default: stdout)")
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const dbPath = resolveDbPath(opts);
    const passphrase = await resolvePassphrase(opts);
    const state = openStore(dbPath, passphrase);

    const plaintext = await readText(cmdOpts.in);
    const envelope = await encryptMessage(state, cmdOpts.to, plaintext);
    await writeText(cmdOpts.out, JSON.stringify(envelope, null, 2));
  });

/**
 * COMMAND: decrypt
 * 
 * Decrypt a message envelope.
 * 
 * Input is JSON envelope (from file or stdin).
 * Output is plaintext (to file or stdout).
 * 
 * Usage:
 *   mega decrypt --in message.json --out plaintext.txt
 *   cat message.json | mega decrypt
 */
program
  .command("decrypt")
  .description("Decrypt a message envelope")
  .option("--in <file>", "Input file (default: stdin)")
  .option("--out <file>", "Output file (default: stdout)")
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const dbPath = resolveDbPath(opts);
    const passphrase = await resolvePassphrase(opts);
    const state = openStore(dbPath, passphrase);

    const payload = await readJson(cmdOpts.in ?? "-");
    const envelope = loadEnvelope(payload);
    const plaintext = await decryptMessage(state, envelope);
    await writeText(cmdOpts.out, plaintext);
  });

// ============================================================================
// RELAY CLIENT COMMANDS
// ============================================================================

const client = program.command("client").description("Relay server client operations");

/**
 * COMMAND: client register
 * 
 * Register identity with relay server.
 * 
 * Must be done before uploading prekeys or receiving messages.
 * 
 * Usage:
 *   mega client register --id alice
 */
client
  .command("register")
  .description("Register a local identity with the relay server")
  .requiredOption("--id <id>", "Local identity id")
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const server = resolveServerUrl(opts);
    await httpPostJson(`${server}/v1/register`, { id: cmdOpts.id });
    console.log(`Registered ${cmdOpts.id} at ${server}`);
  });

const clientPrekeys = client.command("prekeys").description("Prekey operations via relay server");

/**
 * COMMAND: client prekeys upload
 * 
 * Upload prekey bundle to relay server.
 * 
 * Makes prekeys available for peers to download.
 * Replaces any existing prekey bundle.
 * 
 * Usage:
 *   mega client prekeys upload
 */
clientPrekeys
  .command("upload")
  .description("Upload local prekey bundle to relay server")
  .action(async () => {
    const opts = program.opts();
    const server = resolveServerUrl(opts);
    const dbPath = resolveDbPath(opts);
    const passphrase = await resolvePassphrase(opts);
    const state = openStore(dbPath, passphrase);
    const bundle = await exportBundle(state);
    await httpPostJson(`${server}/v1/prekeys`, { id: bundle.id, bundle });
    console.log(`Uploaded prekeys for ${bundle.id} to ${server}`);
  });

/**
 * COMMAND: client prekeys fetch
 * 
 * Download peer's prekey bundle from relay.
 * 
 * Needed to establish session with someone.
 * 
 * Usage:
 *   mega client prekeys fetch --id bob --out bob.bundle.json
 */
clientPrekeys
  .command("fetch")
  .description("Fetch a peer prekey bundle from relay server")
  .requiredOption("--id <id>", "Peer identity id")
  .option("--out <file>", "Output file (default: stdout)")
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const server = resolveServerUrl(opts);
    const payload = await httpGetJson<{ id: string; bundle: Bundle }>(`${server}/v1/prekeys/${cmdOpts.id}`);
    await writeText(cmdOpts.out, JSON.stringify(payload.bundle, null, 2));
    console.log(`Fetched prekeys for ${payload.id} from ${server}`);
  });

/**
 * COMMAND: client send
 * 
 * Send encrypted message via relay.
 * 
 * Automatically fetches recipient's prekeys and establishes session
 * if needed. Encrypts message and sends via relay.
 * 
 * Usage:
 *   mega client send --to bob --in message.txt
 */
client
  .command("send")
  .description("Encrypt and send a message via relay server")
  .requiredOption("--to <id>", "Recipient id")
  .option("--in <file>", "Input file (default: stdin)")
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const server = resolveServerUrl(opts);
    const dbPath = resolveDbPath(opts);
    const passphrase = await resolvePassphrase(opts);
    const state = openStore(dbPath, passphrase);

    const localId = state.getLocalIdentity();
    if (!localId) throw new Error("Local identity not set. Run 'mega init'.");

    // Check if session exists, fetch prekeys if not
    const address = ProtocolAddress.new(cmdOpts.to, 1);
    const existing = await state.sessionStore.getSession(address);
    if (!existing) {
      const payload = await httpGetJson<{ id: string; bundle: Bundle }>(`${server}/v1/prekeys/${cmdOpts.to}`);
      const bundle = ensureBundle(payload.bundle);
      await initSession(state, bundle);
    }

    const plaintext = await readText(cmdOpts.in);
    const envelope = await encryptMessage(state, cmdOpts.to, plaintext);
    await httpPostJson(`${server}/v1/messages`, { from: localId, to: cmdOpts.to, envelope });
    console.log(`Sent message from ${localId} to ${cmdOpts.to} via ${server}`);
  });

/**
 * COMMAND: client listen
 * 
 * Listen for incoming messages via WebSocket.
 * 
 * Connects to relay via WebSocket and waits for messages.
 * Decrypts messages and displays them.
 * Stores messages in inbox.
 * 
 * Usage:
 *   mega client listen --id alice
 */
client
  .command("listen")
  .description("Listen for incoming messages via relay server WebSocket")
  .requiredOption("--id <id>", "Local identity id")
  .option("--ws <url>", "WebSocket URL (default: derived from --server)")
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const server = resolveServerUrl(opts);
    const wsUrl = resolveWsUrl(server, cmdOpts.id, cmdOpts.ws);
    const dbPath = resolveDbPath(opts);
    const passphrase = await resolvePassphrase(opts);
    const state = openStore(dbPath, passphrase);

    const ws = new WebSocket(wsUrl);
    let exiting = false;
    let exitCode = 0;
    let forceExitTimer: NodeJS.Timeout | undefined;

    // Cleanup helpers
    const clearForceExitTimer = (): void => {
      if (!forceExitTimer) return;
      clearTimeout(forceExitTimer);
      forceExitTimer = undefined;
    };

    const cleanupSignalHandlers = (): void => {
      process.off("SIGINT", handleSigint);
      process.off("SIGTERM", handleSigterm);
    };

    const exitNow = (code: number): never => {
      clearForceExitTimer();
      cleanupSignalHandlers();
      process.exit(code);
    };

    // Graceful shutdown with timeout
    const beginShutdown = (code: number, reason: string): void => {
      if (exiting) return;
      exiting = true;
      exitCode = code;

      const isSocketActive = ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING;
      if (!isSocketActive) {
        exitNow(code);
      }

      // Force exit if graceful shutdown takes too long
      forceExitTimer = setTimeout(() => {
        console.error("Forcing listener shutdown.");
        exitNow(exitCode);
      }, 1500);
      forceExitTimer.unref();

      try {
        ws.close(code === 0 ? 1000 : 1011, reason);
      } catch {
        exitNow(code);
      }
    };

    // Signal handlers
    const handleSigint = (): void => {
      console.log("Received SIGINT, shutting down listener...");
      beginShutdown(0, "SIGINT");
    };

    const handleSigterm = (): void => {
      console.log("Received SIGTERM, shutting down listener...");
      beginShutdown(0, "SIGTERM");
    };

    process.once("SIGINT", handleSigint);
    process.once("SIGTERM", handleSigterm);

    // WebSocket event handlers
    ws.on("open", () => {
      console.log(`Listening for messages on ${wsUrl}`);
    });

    ws.on("message", async (data: RawData) => {
      try {
        const payload = JSON.parse(data.toString()) as { envelope?: unknown; from?: string };
        const envelope = loadEnvelope(payload.envelope ?? payload);
        const plaintext = await decryptMessage(state, envelope);
        
        // Store in inbox
        const inboxMessage: InboxMessage = {
          id: `${envelope.timestamp}:${envelope.senderId}:${Math.random().toString(36).slice(2)}`,
          senderId: envelope.senderId,
          timestamp: envelope.timestamp,
          plaintext,
          envelope
        };
        saveInboxMessage(state, inboxMessage);
        
        // Display message
        console.log(`[${envelope.senderId}] ${plaintext}`);
      } catch (err) {
        console.error(err);
      }
    });

    ws.on("close", () => {
      console.log("WebSocket closed.");
      exitNow(exitCode);
    });

    ws.on("error", (err: Error) => {
      console.error(err);
      beginShutdown(1, "socket-error");
    });
  });

/**
 * COMMAND: client inbox
 * 
 * List decrypted inbox messages.
 * 
 * Shows messages received while listening.
 * Supports filtering by time and limiting results.
 * 
 * Usage:
 *   mega client inbox
 *   mega client inbox --limit 10
 *   mega client inbox --since 1704067200000
 */
client
  .command("inbox")
  .description("List decrypted inbox messages stored locally")
  .option("--limit <n>", "Max messages to show (default: 20)", "20")
  .option("--since <epoch>", "Only show messages after this epoch ms")
  .option("--json", "Output as JSON")
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const dbPath = resolveDbPath(opts);
    const passphrase = await resolvePassphrase(opts);
    const state = openStore(dbPath, passphrase);

    const limit = Number(cmdOpts.limit ?? 20);
    const since = cmdOpts.since ? Number(cmdOpts.since) : undefined;

    let messages = listInboxMessages(state);
    if (Number.isFinite(since)) {
      messages = messages.filter((msg) => msg.timestamp > (since ?? 0));
    }
    if (Number.isFinite(limit)) {
      messages = messages.slice(-limit);
    }

    if (cmdOpts.json) {
      console.log(JSON.stringify(messages, null, 2));
      return;
    }

    if (messages.length === 0) {
      console.log("Inbox empty.");
      return;
    }

    for (const msg of messages) {
      const ts = formatTimestamp(msg.timestamp);
      console.log(`[${ts}] ${msg.senderId}: ${msg.plaintext}`);
    }
  });

// ============================================================================
// ADMIN COMMANDS
// ============================================================================

const admin = program.command("admin").description("Relay diagnostics (privacy-safe)");

/**
 * COMMAND: admin diagnostics
 * 
 * Show relay server diagnostics.
 * 
 * Fetches and displays relay server status including:
 * - Uptime
 * - Registered users count
 * - Message queue statistics
 * - System metrics (if available)
 * 
 * Usage:
 *   mega admin diagnostics
 *   mega admin diagnostics --json
 */
admin
  .command("diagnostics")
  .description("Fetch relay diagnostics snapshot")
  .option("--json", "Output raw JSON")
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const server = resolveServerUrl(opts);
    const payload = await httpGetJson<{
      uptimeSec: number;
      dbPath: string;
      counts: { users: number; prekeys: number; queuedMessages: number; activeConnections: number };
      queueDepthHistogram: Record<string, number>;
      metrics: {
        cpuPct: number; memPct: number; swapPct: number;
        netInBytes: number; netOutBytes: number;
        load: [number, number, number]; updatedAt: number;
      } | null;
    }>(`${server}/diagnostics`);

    if (cmdOpts.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(`Uptime: ${formatDuration(payload.uptimeSec)}`);
    console.log(`DB: ${payload.dbPath}`);
    console.log(`Counts: users=${payload.counts.users} prekeys=${payload.counts.prekeys} queued=${payload.counts.queuedMessages} active_ws=${payload.counts.activeConnections}`);
    const hist = payload.queueDepthHistogram;
    console.log(`Queue histogram: 0=${hist["0"] ?? 0} 1-5=${hist["1-5"] ?? 0} 6-20=${hist["6-20"] ?? 0} 21+=${hist["21+"] ?? 0}`);
    if (payload.metrics) {
      console.log(`Metrics: cpu=${payload.metrics.cpuPct.toFixed(1)}% mem=${payload.metrics.memPct.toFixed(1)}% swap=${payload.metrics.swapPct.toFixed(1)}%`);
      console.log(`Load: ${payload.metrics.load.map((v) => v.toFixed(2)).join(" ")}`);
    } else {
      console.log("Metrics: none (diagnostics worker not running)");
    }
  });

// ============================================================================
// REPL COMMAND
// ============================================================================

/**
 * COMMAND: repl
 * 
 * Start interactive REPL (Read-Eval-Print Loop).
 * 
 * Provides an interactive shell for running commands.
 * Useful for exploration and testing.
 * 
 * Usage:
 *   mega repl
 */
program
  .command("repl")
  .description("Start interactive REPL")
  .action(async () => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    console.log("Mega REPL. Type 'help' or 'exit'.");
    while (true) {
      const line = await rl.question("> ");
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === "exit" || trimmed === "quit") break;
      if (trimmed === "help") {
        console.log("Commands: init, identity show, prekey generate, bundle export, session init, encrypt, decrypt");
        continue;
      }
      // Parse command line into arguments
      const args = trimmed.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
      const cleaned = args.map((arg) => arg.replace(/^"|"$/g, ""));
      try {
        await program.parseAsync(["node", "mega", ...cleaned], { from: "user" });
      } catch (err) {
        if (err instanceof CommanderError) {
          console.error(err.message);
        } else {
          console.error(err);
        }
      }
    }
    rl.close();
  });

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Main function - parse command line and execute.
 * 
 * Wraps program.parseAsync with error handling.
 * Handles CommanderError separately for clean error messages.
 */
async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.code === "commander.helpDisplayed") return;
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

// Start CLI
void main();

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Format timestamp as ISO 8601 string.
 * 
 * @param epoch - Milliseconds since Unix epoch
 * @returns ISO 8601 formatted string (e.g., "2024-01-01T00:00:00.000Z")
 */
function formatTimestamp(epoch: number): string {
  return new Date(epoch).toISOString();
}

/**
 * Format seconds as human-readable duration.
 * 
 * Converts seconds to hours, minutes, seconds format.
 * 
 * @param seconds - Duration in seconds
 * @returns Formatted string (e.g., "2h 30m 45s")
 */
function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hrs}h ${mins}m ${secs}s`;
}
