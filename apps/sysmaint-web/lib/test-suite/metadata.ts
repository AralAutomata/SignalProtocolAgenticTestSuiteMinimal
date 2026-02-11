/**
 * ============================================================================
 * TEST SUITE METADATA
 * ============================================================================
 *
 * Test metadata for UI display (browser-safe).
 * Contains NO native modules - safe to import in client components.
 *
 * @module apps/sysmaint-web/lib/test-suite/metadata
 * ============================================================================
 */

export interface TestMetadata {
  id: string;
  name: string;
  category: "signal" | "e2ee" | "ai" | "web";
  description: string;
  estimatedDuration: number; // milliseconds
  estimatedCost?: number; // USD
}

/**
 * All 15 tests metadata (no implementations)
 */
export const allTestsMetadata: TestMetadata[] = [
  // Signal Protocol Tests (4)
  {
    id: "signal-identity",
    name: "Signal Identity Generation",
    category: "signal",
    description: "Generate identity key pair (Curve25519) and registration ID for secure messaging",
    estimatedDuration: 300,
  },
  {
    id: "signal-prekeys",
    name: "Prekey Bundle Generation",
    category: "signal",
    description: "Generate signed prekeys (ED25519), one-time prekeys, and post-quantum Kyber prekeys",
    estimatedDuration: 400,
  },
  {
    id: "signal-session",
    name: "X3DH Session Establishment",
    category: "signal",
    description: "Establish Signal session using X3DH key agreement",
    estimatedDuration: 500,
  },
  {
    id: "signal-persistence",
    name: "Session Persistence",
    category: "signal",
    description: "Verify sessions survive database close/reopen",
    estimatedDuration: 200,
  },

  // E2EE Tests (4)
  {
    id: "e2ee-encryption",
    name: "E2EE Encryption/Decryption",
    category: "e2ee",
    description: "Encrypt message using AES-CBC + HMAC-SHA256 and verify ciphertext differs from plaintext",
    estimatedDuration: 200,
  },
  {
    id: "e2ee-prekey",
    name: "PreKey Message Format",
    category: "e2ee",
    description: "Verify first message uses PreKey format with correct fields",
    estimatedDuration: 300,
  },
  {
    id: "e2ee-ratchet",
    name: "Double Ratchet Advancement",
    category: "e2ee",
    description: "Verify forward secrecy by sending 5 messages with unique encryption keys each time",
    estimatedDuration: 800,
  },
  {
    id: "e2ee-integrity",
    name: "Integrity Verification",
    category: "e2ee",
    description: "Verify HMAC-SHA256 authentication detects tampered ciphertext and rejects decryption",
    estimatedDuration: 100,
  },

  // AI Agent Tests (5)
  {
    id: "ai-tool-selection",
    name: "AI Tool Selection",
    category: "ai",
    description: "Verify AI correctly routes 'check status' queries to the status tool",
    estimatedDuration: 1200,
    estimatedCost: 0.0003,
  },
  {
    id: "ai-history",
    name: "Historical Data Query",
    category: "ai",
    description: "Verify AI queries historical metrics with correct time range parameters",
    estimatedDuration: 1500,
    estimatedCost: 0.0004,
  },
  {
    id: "ai-anomaly",
    name: "Anomaly Detection Query",
    category: "ai",
    description: "Verify AI routes 'find problems' queries to the anomaly detection tool",
    estimatedDuration: 900,
    estimatedCost: 0.0002,
  },
  {
    id: "ai-context",
    name: "Conversation Context",
    category: "ai",
    description: "Verify AI maintains context across consecutive messages in same session",
    estimatedDuration: 1100,
    estimatedCost: 0.0003,
  },
  {
    id: "ai-multi-tool",
    name: "Multi-Tool Reasoning",
    category: "ai",
    description: "Verify AI chains status + history + anomaly tools for complex diagnostic queries",
    estimatedDuration: 2300,
    estimatedCost: 0.0005,
  },

  // Web API Tests (2)
  {
    id: "web-database",
    name: "Database Query Operations",
    category: "web",
    description: "Test SQLite state database insert, query, and indexing operations",
    estimatedDuration: 100,
  },
  {
    id: "web-chat-api",
    name: "Chat API End-to-End",
    category: "web",
    description: "Test chat API with Signal Protocol encryption and OpenAI response",
    estimatedDuration: 500,
  },
];

/**
 * Tests organized by category for UI display
 */
export const testsByCategory = {
  signal: allTestsMetadata.filter((t) => t.category === "signal"),
  e2ee: allTestsMetadata.filter((t) => t.category === "e2ee"),
  ai: allTestsMetadata.filter((t) => t.category === "ai"),
  web: allTestsMetadata.filter((t) => t.category === "web"),
};

/**
 * Get a test by its ID
 */
export function getTestById(id: string): TestMetadata | undefined {
  return allTestsMetadata.find((t) => t.id === id);
}

/**
 * Calculate total estimated cost for all tests
 */
export function calculateEstimatedCost(): number {
  return allTestsMetadata.reduce((sum, test) => sum + (test.estimatedCost || 0), 0);
}

/**
 * Calculate total estimated duration for all tests
 */
export function calculateEstimatedDuration(): number {
  return allTestsMetadata.reduce((sum, test) => sum + test.estimatedDuration, 0);
}

/**
 * Get category display name
 */
export function getCategoryDisplayName(category: string): string {
  const names: Record<string, string> = {
    signal: "Signal Protocol",
    e2ee: "E2EE Health",
    ai: "AI Agent",
    web: "Web API",
  };
  return names[category] || category;
}
