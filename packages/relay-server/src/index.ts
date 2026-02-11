/**
 * ============================================================================
 * SIGNAL PROTOCOL RELAY SERVER
 * ============================================================================
 * 
 * This module implements the relay server for the Signal Protocol messaging
 * system. The relay provides message routing and storage services without
 * having access to message content (which is end-to-end encrypted).
 * 
 * ARCHITECTURE:
 * 
 * The relay is a hybrid HTTP/WebSocket server:
 * - HTTP endpoints: Registration, prekey management, message sending, diagnostics
 * - WebSocket: Real-time message delivery to connected clients
 * 
 * This hybrid approach provides:
 * 1. RELIABLE DELIVERY: Messages are queued in SQLite if recipient offline
 * 2. LOW LATENCY: WebSocket provides instant delivery when recipient online
 * 3. SCALABILITY: HTTP endpoints can be load balanced
 * 4. SIMPLICITY: Clear separation of concerns
 * 
 * SECURITY MODEL:
 * 
 * The relay operates on a "need to know" basis:
 * - CAN SEE: Sender ID, recipient ID, message timestamps, message size
 * - CANNOT SEE: Message content (end-to-end encrypted by Signal Protocol)
 * 
 * This is the same security model as Signal's official servers. The relay
 * facilitates communication but cannot decrypt messages.
 * 
 * DATA STORAGE:
 * 
 * SQLite database with three tables:
 * - users: Registered identity names
 * - prekeys: Uploaded prekey bundles (public keys only)
 * - messages: Queued messages awaiting delivery (encrypted payloads)
 * 
 * PRIVACY CONSIDERATIONS:
 * 
 * While the relay can't read message content, it can see metadata:
 * - Who is talking to whom (social graph)
 * - When messages are sent (timing patterns)
 * - Message sizes (could leak information about content type)
 * 
 * For production use, additional privacy measures would be needed:
 * - Message padding to hide size
 * - Traffic shaping to hide timing patterns
 * - Mix networks or onion routing to hide relationships
 * 
 * ============================================================================
 */

// Node.js built-in HTTP module for the web server
import http from "node:http";

// File system utilities for directory creation
import { mkdirSync } from "node:fs";

// UUID generation for message IDs
import { randomUUID } from "node:crypto";

// Path utilities for cross-platform file paths
import path from "node:path";

// SQLite database - synchronous, high-performance
import Database from "better-sqlite3";

// WebSocket server for real-time communication
import { WebSocketServer, type WebSocket } from "ws";

// Zod for request validation
import { z } from "zod";

// Import envelope schema from shared package
import { EnvelopeSchema } from "@mega/shared";

// ============================================================================
// REQUEST VALIDATION SCHEMAS
// ============================================================================

/**
 * Schema for user registration requests.
 * 
 * POST /v1/register
 * Body: { "id": "alice" }
 * 
 * Registers a new Signal identity with the relay. This identity can then:
 * - Upload prekey bundles
 * - Receive messages
 * - Connect via WebSocket
 */
const RegisterSchema = z.object({
  // Identity name - non-empty string
  // Must be unique across the relay
  id: z.string().min(1)
});

/**
 * Schema for prekey bundles.
 * 
 * Prekey bundles contain the public keys needed to establish Signal sessions.
 * They're uploaded by clients and downloaded by peers who want to message them.
 * 
 * Contains:
 * - identityKey: Curve25519 identity public key
 * - signedPreKey: Medium-term key + signature
 * - preKey: One-time ephemeral key
 * - kyberPreKey: Post-quantum key + signature
 */
const BundleSchema = z.object({
  id: z.string().min(1),
  deviceId: z.number().int().positive(),
  registrationId: z.number().int().positive(),
  identityKey: z.string().min(1),
  signedPreKey: z.object({
    keyId: z.number().int().nonnegative(),
    publicKey: z.string().min(1),
    signature: z.string().min(1)
  }),
  preKey: z.object({
    keyId: z.number().int().nonnegative(),
    publicKey: z.string().min(1)
  }),
  kyberPreKey: z.object({
    keyId: z.number().int().nonnegative(),
    publicKey: z.string().min(1),
    signature: z.string().min(1)
  })
});

/**
 * Schema for prekey upload requests.
 * 
 * POST /v1/prekeys
 * Body: { "id": "alice", "bundle": {...} }
 * 
 * Uploads a prekey bundle for a registered identity. Old bundles are replaced.
 */
const PreKeyUploadSchema = z.object({
  id: z.string().min(1),
  bundle: BundleSchema
});

/**
 * Schema for message sending requests.
 * 
 * POST /v1/messages
 * Body: { "from": "alice", "to": "bob", "envelope": {...} }
 * 
 * Sends a message from one identity to another. The envelope contains the
 * encrypted Signal Protocol message. The relay queues it for delivery.
 */
const MessageSchema = z.object({
  // Sender's identity
  from: z.string().min(1),
  // Recipient's identity
  to: z.string().min(1),
  // Signal envelope containing encrypted message
  envelope: EnvelopeSchema
});

// Type inference from schemas
type Bundle = z.infer<typeof BundleSchema>;
type Envelope = z.infer<typeof EnvelopeSchema>;

/**
 * Database row type for messages table.
 * 
 * This represents how messages are stored in SQLite.
 * The envelope_json field contains the serialized, encrypted envelope.
 */
type MessageRow = {
  id: string;              // UUID message identifier
  to_id: string;           // Recipient identity
  from_id: string;         // Sender identity
  envelope_json: string;   // Serialized envelope (JSON)
  created_at: number;      // Timestamp (milliseconds)
};

/**
 * Type for diagnostics metrics.
 * 
 * POST /diagnostics/metrics
 * Body: { "cpuPct": 45.2, "memPct": 67.5, ... }
 * 
 * System metrics collected by the diagnostics service.
 */
type DiagnosticsMetrics = {
  cpuPct: number;          // CPU usage percentage
  memPct: number;          // Memory usage percentage
  swapPct: number;         // Swap usage percentage
  netInBytes: number;      // Network bytes received
  netOutBytes: number;     // Network bytes transmitted
  load: [number, number, number];  // Load averages [1m, 5m, 15m]
  updatedAt: number;       // Timestamp of metrics collection
};

// ============================================================================
// DATABASE SETUP
// ============================================================================

/**
 * Resolve database path from environment or use default.
 * 
 * Environment variable RELAY_DB overrides the default path.
 * This allows flexible deployment configuration.
 * 
 * @returns Absolute path to SQLite database file
 */
function resolveDbPath(): string {
  const envPath = process.env.RELAY_DB;
  if (envPath) return envPath;
  return path.join(process.cwd(), "data", "relay.db");
}

/**
 * Ensure directory exists for database file.
 * 
 * Creates parent directories recursively if they don't exist.
 * This prevents "directory not found" errors when opening database.
 * 
 * @param dbPath - Path to database file
 */
function ensureDbDir(dbPath: string): void {
  const dir = path.dirname(dbPath);
  mkdirSync(dir, { recursive: true });
}

/**
 * Initialize SQLite database with schema.
 * 
 * This function:
 * 1. Creates database directory if needed
 * 2. Opens/creates the SQLite database
 * 3. Enables WAL mode for better concurrency
 * 4. Creates tables if they don't exist
 * 
 * DATABASE SCHEMA:
 * 
 * users table:
 *   - id: TEXT PRIMARY KEY - Identity name (e.g., "alice")
 *   - created_at: INTEGER - Registration timestamp
 * 
 * prekeys table:
 *   - id: TEXT PRIMARY KEY - Identity name
 *   - bundle_json: TEXT - Serialized prekey bundle
 *   - updated_at: INTEGER - Upload timestamp
 * 
 * messages table:
 *   - id: TEXT PRIMARY KEY - Message UUID
 *   - to_id: TEXT - Recipient identity
 *   - from_id: TEXT - Sender identity
 *   - envelope_json: TEXT - Serialized encrypted envelope
 *   - created_at: INTEGER - Send timestamp
 *   - delivered: INTEGER DEFAULT 0 - 0=queued, 1=delivered
 * 
 * @param dbPath - Path to database file
 * @returns Database instance
 */
function openDb(dbPath: string): InstanceType<typeof Database> {
  // Create directory structure
  ensureDbDir(dbPath);
  
  // Open database (creates if doesn't exist)
  const db = new Database(dbPath);
  
  // Enable Write-Ahead Logging mode
  // WAL mode provides better concurrency and crash safety
  db.pragma("journal_mode = WAL");
  
  // Create tables with a single exec() call
  // Each CREATE TABLE IF NOT EXISTS only runs if table doesn't exist
  db.exec(
    // Users table - registered identities
    "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);" +
    
    // Prekeys table - uploaded prekey bundles
    "CREATE TABLE IF NOT EXISTS prekeys (id TEXT PRIMARY KEY, bundle_json TEXT NOT NULL, updated_at INTEGER NOT NULL);" +
    
    // Messages table - queued messages
    "CREATE TABLE IF NOT EXISTS messages (" +
      "id TEXT PRIMARY KEY, " +
      "to_id TEXT NOT NULL, " +
      "from_id TEXT NOT NULL, " +
      "envelope_json TEXT NOT NULL, " +
      "created_at INTEGER NOT NULL, " +
      "delivered INTEGER NOT NULL DEFAULT 0);"
  );
  
  return db;
}

// ============================================================================
// HTTP RESPONSE HELPERS
// ============================================================================

/**
 * Send JSON response.
 * 
 * Helper function to send JSON data with proper headers.
 * Sets Content-Type and Content-Length automatically.
 * 
 * @param res - HTTP response object
 * @param status - HTTP status code
 * @param payload - Data to serialize as JSON
 */
function json<T>(res: http.ServerResponse, status: number, payload: T): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

/**
 * Send plain text response.
 * 
 * Helper for simple text responses (like health checks).
 * 
 * @param res - HTTP response object
 * @param status - HTTP status code
 * @param payload - Text to send
 */
function text(res: http.ServerResponse, status: number, payload: string): void {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

/**
 * Read and parse JSON body from request.
 * 
 * Accumulates all data chunks from the request stream,
 * then parses as JSON. Returns empty object if no body.
 * 
 * @param req - HTTP request object
 * @returns Promise resolving to parsed JSON
 * @throws Error if body is invalid JSON
 */
async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  
  // Collect all data chunks
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  
  // Combine chunks and convert to string
  const raw = Buffer.concat(chunks).toString("utf8");
  
  // Return empty object if no body
  if (!raw) return {};
  
  // Parse JSON
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body.");
  }
}

/**
 * Parse URL with default base.
 * 
 * Ensures we always have a valid URL object, even for relative URLs.
 * Used to parse request URLs consistently.
 * 
 * @param reqUrl - URL string from request
 * @returns URL object
 */
function normalizeServerUrl(reqUrl: string | undefined): URL {
  return new URL(reqUrl ?? "/", "http://localhost");
}

/**
 * Send WebSocket message with Promise-based error handling.
 * 
 * WebSocket.send() is normally callback-based. This wraps it in a Promise
 * for easier async/await usage and error handling.
 * 
 * @param ws - WebSocket connection
 * @param payload - Data to send (will be JSON serialized)
 * @returns Promise that resolves on success, rejects on error
 */
async function sendWsMessage(ws: WebSocket, payload: unknown): Promise<void> {
  return await new Promise((resolve, reject) => {
    ws.send(JSON.stringify(payload), (err?: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Build message payload from database row.
 * 
 * Converts a database MessageRow into the format sent to clients.
 * Parses the envelope JSON and structures the payload.
 * 
 * @param row - Database row
 * @returns Formatted message payload
 */
function buildMessagePayload(row: MessageRow): { from: string; to: string; envelope: Envelope } {
  return {
    from: row.from_id,
    to: row.to_id,
    envelope: JSON.parse(row.envelope_json) as Envelope
  };
}

// ============================================================================
// MAIN SERVER FUNCTION
// ============================================================================

/**
 * Main relay server function.
 * 
 * Initializes and starts the HTTP/WebSocket relay server.
 * Handles all routing, message queueing, and real-time delivery.
 */
async function main(): Promise<void> {
  // Resolve database path from environment or default
  const dbPath = resolveDbPath();
  
  // Get port from environment or use default 8080
  const port = Number(process.env.RELAY_PORT ?? process.env.PORT ?? "8080");
  
  // Get host from environment or bind to all interfaces
  const host = process.env.RELAY_HOST ?? "0.0.0.0";

  // Initialize database
  const db = openDb(dbPath);

  // Prepare SQL statements for reuse
  // Prepared statements are faster and prevent SQL injection
  
  // User management
  const stmtUserInsert = db.prepare("INSERT OR IGNORE INTO users (id, created_at) VALUES (?, ?)");
  const stmtUserExists = db.prepare("SELECT 1 FROM users WHERE id = ?");
  
  // Prekey management
  const stmtPrekeyUpsert = db.prepare(
    "INSERT OR REPLACE INTO prekeys (id, bundle_json, updated_at) VALUES (?, ?, ?)"
  );
  const stmtPrekeyGet = db.prepare("SELECT bundle_json FROM prekeys WHERE id = ?");
  
  // Message queueing
  const stmtMsgInsert = db.prepare(
    "INSERT INTO messages (id, to_id, from_id, envelope_json, created_at, delivered) VALUES (?, ?, ?, ?, ?, 0)"
  );
  const stmtMsgPending = db.prepare(
    "SELECT id, to_id, from_id, envelope_json, created_at FROM messages WHERE to_id = ? AND delivered = 0 ORDER BY created_at ASC"
  );
  const stmtMsgMarkDelivered = db.prepare("UPDATE messages SET delivered = 1 WHERE id = ?");
  
  // Statistics queries
  const stmtUserCount = db.prepare("SELECT COUNT(1) as count FROM users");
  const stmtPrekeyCount = db.prepare("SELECT COUNT(1) as count FROM prekeys");
  const stmtQueuedCount = db.prepare("SELECT COUNT(1) as count FROM messages WHERE delivered = 0");
  const stmtQueueByRecipient = db.prepare(
    "SELECT to_id, COUNT(1) as count FROM messages WHERE delivered = 0 GROUP BY to_id"
  );

  // Track active WebSocket connections
  // Map: identityId -> WebSocket
  const connections = new Map<string, WebSocket>();
  
  // Track server start time for uptime calculation
  const startedAt = Date.now();
  
  // Latest system metrics (received from diagnostics service)
  let latestMetrics: DiagnosticsMetrics | null = null;

  /**
   * Deliver pending messages to a connected client.
   * 
   * When a client connects via WebSocket, this function retrieves
   * all undelivered messages for them and sends them.
   * 
   * @param toId - Recipient identity
   * @param ws - WebSocket connection
   */
  async function deliverPending(toId: string, ws: WebSocket): Promise<void> {
    // Query all pending messages for this recipient
    const rows = stmtMsgPending.all(toId) as MessageRow[];
    
    // Send each message
    for (const row of rows) {
      try {
        // Send via WebSocket
        await sendWsMessage(ws, buildMessagePayload(row));
        
        // Mark as delivered in database
        stmtMsgMarkDelivered.run(row.id);
      } catch {
        // If send fails (client disconnected), stop trying
        // Remaining messages will be delivered on next connect
        break;
      }
    }
  }

  /**
   * Attempt immediate delivery if recipient is connected.
   * 
   * Called when a new message arrives. If recipient is online,
   * deliver immediately. Otherwise, it stays queued.
   * 
   * @param row - Message row from database
   * @returns true if delivered, false if queued for later
   */
  async function deliverIfConnected(row: MessageRow): Promise<boolean> {
    const ws = connections.get(row.to_id);
    
    // Check if recipient is connected
    if (!ws || ws.readyState !== ws.OPEN) return false;
    
    try {
      // Attempt delivery
      await sendWsMessage(ws, buildMessagePayload(row));
      
      // Mark as delivered
      stmtMsgMarkDelivered.run(row.id);
      return true;
    } catch {
      // Delivery failed (connection dropped)
      return false;
    }
  }

  // ============================================================================
  // WEBSOCKET SERVER SETUP
  // ============================================================================
  
  // Create WebSocket server
  // noServer: true means we'll handle the upgrade manually
  // This gives us control over authentication
  const wss = new WebSocketServer({ noServer: true });
  
  // Handle WebSocket connections
  wss.on("connection", (ws: WebSocket, _request: http.IncomingMessage, clientId: string) => {
    // Check if this identity already has a connection
    const existing = connections.get(clientId);
    if (existing && existing !== ws) {
      // Close existing connection (client reconnected from elsewhere)
      existing.close(4000, "superseded");
    }
    
    // Register new connection
    connections.set(clientId, ws);
    
    // Deliver any queued messages
    void deliverPending(clientId, ws);

    // Clean up when connection closes
    ws.on("close", () => {
      if (connections.get(clientId) === ws) connections.delete(clientId);
    });

    // Clean up on error
    ws.on("error", () => {
      if (connections.get(clientId) === ws) connections.delete(clientId);
    });
  });

  // ============================================================================
  // HTTP SERVER SETUP
  // ============================================================================
  
  // Create HTTP server
  const server = http.createServer(async (req, res) => {
    try {
      // Parse URL and method
      const url = normalizeServerUrl(req.url);
      const method = req.method ?? "GET";

      // -------------------- HEALTH CHECK --------------------
      if (method === "GET" && url.pathname === "/health") {
        return text(res, 200, "ok");
      }

      // -------------------- DIAGNOSTICS --------------------
      if (method === "GET" && url.pathname === "/diagnostics") {
        // Get current statistics
        const users = (stmtUserCount.get() as { count: number }).count;
        const prekeys = (stmtPrekeyCount.get() as { count: number }).count;
        const queued = (stmtQueuedCount.get() as { count: number }).count;
        const byRecipient = stmtQueueByRecipient.all() as { to_id: string; count: number }[];

        // Build queue depth histogram
        // Shows distribution of queue depths across users
        const histogram = { "0": 0, "1-5": 0, "6-20": 0, "21+": 0 };
        for (const row of byRecipient) {
          if (row.count <= 0) histogram["0"] += 1;
          else if (row.count <= 5) histogram["1-5"] += 1;
          else if (row.count <= 20) histogram["6-20"] += 1;
          else histogram["21+"] += 1;
        }

        return json(res, 200, {
          uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
          dbPath,
          counts: { users, prekeys, queuedMessages: queued, activeConnections: connections.size },
          queueDepthHistogram: histogram,
          metrics: latestMetrics
        });
      }

      // -------------------- RECEIVE METRICS --------------------
      if (method === "POST" && url.pathname === "/diagnostics/metrics") {
        const payload = await readJson(req);
        
        // Validate metrics schema
        const schema = z.object({
          cpuPct: z.number().min(0),
          memPct: z.number().min(0),
          swapPct: z.number().min(0),
          netInBytes: z.number().min(0),
          netOutBytes: z.number().min(0),
          load: z.tuple([z.number(), z.number(), z.number()]),
          updatedAt: z.number().int().positive()
        });
        
        latestMetrics = schema.parse(payload);
        return json(res, 200, { ok: true });
      }

      // -------------------- USER REGISTRATION --------------------
      if (method === "POST" && url.pathname === "/v1/register") {
        const payload = RegisterSchema.parse(await readJson(req));
        
        // Insert user (OR IGNORE prevents error if already exists)
        stmtUserInsert.run(payload.id, Date.now());
        
        return json(res, 200, { id: payload.id });
      }

      // -------------------- UPLOAD PREKEYS --------------------
      if (method === "POST" && url.pathname === "/v1/prekeys") {
        const payload = PreKeyUploadSchema.parse(await readJson(req));
        
        // Verify user is registered
        const user = stmtUserExists.get(payload.id);
        if (!user) return json(res, 404, { error: "User not registered." });
        
        // Store prekey bundle (replaces any existing bundle)
        stmtPrekeyUpsert.run(payload.id, JSON.stringify(payload.bundle), Date.now());
        
        return json(res, 200, { ok: true });
      }

      // -------------------- FETCH PREKEYS --------------------
      if (method === "GET" && url.pathname.startsWith("/v1/prekeys/")) {
        // Extract identity from URL path
        const id = decodeURIComponent(url.pathname.replace("/v1/prekeys/", ""));
        
        // Query database
        const row = stmtPrekeyGet.get(id) as { bundle_json: string } | undefined;
        if (!row) return json(res, 404, { error: "Prekeys not found." });
        
        return json(res, 200, { id, bundle: JSON.parse(row.bundle_json) as Bundle });
      }

      // -------------------- SEND MESSAGE --------------------
      if (method === "POST" && url.pathname === "/v1/messages") {
        const payload = MessageSchema.parse(await readJson(req));
        
        // Verify recipient is registered
        const user = stmtUserExists.get(payload.to);
        if (!user) return json(res, 404, { error: "Recipient not registered." });

        // Generate message ID and timestamp
        const messageId = randomUUID();
        const createdAt = Date.now();
        const envelopeJson = JSON.stringify(payload.envelope);
        
        // Store in message queue
        stmtMsgInsert.run(messageId, payload.to, payload.from, envelopeJson, createdAt);

        // Attempt immediate delivery if recipient online
        const delivered = await deliverIfConnected({
          id: messageId,
          to_id: payload.to,
          from_id: payload.from,
          envelope_json: envelopeJson,
          created_at: createdAt
        });

        return json(res, 200, { ok: true, queued: true, delivered });
      }

      // -------------------- 404 NOT FOUND --------------------
      return json(res, 404, { error: "Not found." });
      
    } catch (err) {
      // Handle validation errors with detailed messages
      if (err instanceof z.ZodError) {
        return json(res, 400, { error: "Invalid request.", details: err.flatten() });
      }
      
      // Handle invalid JSON
      if (err instanceof Error && err.message === "Invalid JSON body.") {
        return json(res, 400, { error: "Invalid JSON body." });
      }
      
      // Log unexpected errors and return generic message
      console.error(err);
      return json(res, 500, { error: "Internal server error." });
    }
  });

  // ============================================================================
  // WEBSOCKET UPGRADE HANDLING
  // ============================================================================
  
  server.on("upgrade", (req, socket, head) => {
    try {
      const url = normalizeServerUrl(req.url);
      
      // Only allow WebSocket upgrade on /ws path
      if (url.pathname !== "/ws") {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }

      // Require client_id query parameter
      const clientId = url.searchParams.get("client_id");
      if (!clientId) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
      }

      // Verify user is registered before allowing WebSocket
      const user = stmtUserExists.get(clientId);
      if (!user) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      // Complete the WebSocket upgrade
      wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        wss.emit("connection", ws, req, clientId);
      });
    } catch {
      // Handle unexpected errors during upgrade
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      socket.destroy();
    }
  });

  // ============================================================================
  // SERVER STARTUP
  // ============================================================================
  
  server.listen(port, host, () => {
    console.log(`Relay server listening on http://${host}:${port}`);
    console.log(`SQLite DB at ${dbPath}`);
  });

  // ============================================================================
  // GRACEFUL SHUTDOWN
  // ============================================================================
  
  process.on("SIGINT", () => {
    // Close HTTP server (stop accepting new connections)
    server.close();
    
    // Close WebSocket server
    wss.close();
    
    // Close database connection
    db.close();
    
    // Exit cleanly
    process.exit(0);
  });
}

// Start the server
void main();
