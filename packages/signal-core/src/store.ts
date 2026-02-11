/**
 * ============================================================================
 * ENCRYPTED SQLITE STORAGE MODULE
 * ============================================================================
 * 
 * This module provides persistent, encrypted storage for Signal Protocol
 * cryptographic material. It implements the storage interfaces required by
 * the official Signal client library (@signalapp/libsignal-client).
 * 
 * ARCHITECTURE OVERVIEW:
 * 
 * 1. EncryptedStore - Core encrypted key-value storage using SQLite
 *    - Stores metadata in plaintext (identity names, KDF params)
 *    - Stores sensitive data encrypted (keys, sessions, prekeys)
 *    - Uses AES-256-GCM for encryption
 *    - Uses scrypt for key derivation
 * 
 * 2. Signal Protocol Store Adapters - Implement Signal's abstract interfaces:
 *    - SqliteIdentityStore: Stores identity keys for self and contacts
 *    - SqliteSessionStore: Stores established Signal sessions
 *    - SqlitePreKeyStore: Stores one-time prekeys
 *    - SqliteSignedPreKeyStore: Stores signed prekeys
 *    - SqliteKyberPreKeyStore: Stores post-quantum Kyber prekeys
 * 
 * SECURITY FEATURES:
 * - All cryptographic material encrypted at rest with AES-256-GCM
 * - Passphrase-derived keys using memory-hard scrypt
 * - WAL mode for safe concurrent access
 * - Parameterized queries to prevent SQL injection
 * 
 * ============================================================================
 */

// better-sqlite3 is a high-performance, synchronous SQLite library for Node.js
// It's faster than async alternatives for most use cases because SQLite is
// inherently single-threaded and synchronous access avoids Promise overhead
import Database from "better-sqlite3";

// Import Signal Protocol types and abstract classes from the official library
// These abstract classes define the interface that Signal expects for storage
import {
  Direction,                    // Enum indicating message direction (sending/receiving)
  IdentityChange,              // Enum for identity key changes (new/changed)
  IdentityKeyPair,             // Contains both public and private identity keys
  IdentityKeyStore,            // Abstract base class for identity storage
  KyberPreKeyRecord,           // Post-quantum Kyber prekey data
  KyberPreKeyStore,            // Abstract base class for Kyber storage
  PreKeyRecord,                // One-time prekey data
  PreKeyStore,                 // Abstract base class for prekey storage
  ProtocolAddress,             // Address format: userId.deviceId
  PublicKey,                   // Curve25519 public key
  SessionRecord,               // Signal session state
  SessionStore,                // Abstract base class for session storage
  SignedPreKeyRecord,          // Signed prekey data
  SignedPreKeyStore,           // Abstract base class for signed prekey storage
  PrivateKey                   // Curve25519 private key
} from "@signalapp/libsignal-client";

// Import our cryptographic utilities from the crypto module
// These handle encryption, decryption, and key derivation
import { createKdfParams, decryptJson, deriveKey, encryptJson, type KdfParams } from "./crypto.js";

// ============================================================================
// METADATA KEYS
// ============================================================================

/**
 * Metadata keys stored in the unencrypted 'meta' table.
 * 
 * These are stored in plaintext because:
 * - They're needed to bootstrap the encryption system
 * - They're not sensitive (identity names, device IDs)
 * - KDF params must be readable to derive the encryption key
 * 
 * SECURITY: The actual cryptographic keys are ALWAYS stored encrypted in the 'kv' table
 */
const META_KDF = "kdf";             // Key derivation parameters (salt, N, r, p)
const META_LOCAL_ID = "localId";    // Local Signal identity name (e.g., "alice")
const META_DEVICE_ID = "deviceId";  // Device identifier (default: 1)
const META_REG_ID = "registrationId"; // Signal registration ID (0-16380)

// ============================================================================
// ENCRYPTED STORE - CORE STORAGE CLASS
// ============================================================================

/**
 * EncryptedStore provides encrypted key-value storage backed by SQLite.
 * 
 * This is the foundation of all Signal Protocol storage in this application.
 * It creates two tables:
 * - 'meta': Plaintext metadata (key-value pairs as strings)
 * - 'kv': Encrypted key-value pairs (keys as strings, values as encrypted BLOBs)
 * 
 * ENCRYPTION SCHEME:
 * 1. User provides a passphrase (e.g., "alpha")
 * 2. If new database: Generate random KDF parameters (salt, N=16384, r=8, p=1)
 * 3. Store KDF parameters in plaintext 'meta' table
 * 4. Derive 32-byte key using scrypt(passphrase, salt, N, r, p)
 * 5. All values in 'kv' table are encrypted with AES-256-GCM using this key
 * 
 * SECURITY NOTE: The passphrase is never stored. Only the KDF parameters are
 * stored so the same key can be derived on subsequent access.
 */
export class EncryptedStore {
  /** SQLite database connection instance */
  private db: InstanceType<typeof Database>;
  
  /** 32-byte encryption key derived from passphrase using scrypt */
  private key: Buffer;

  /**
   * Create a new EncryptedStore instance.
   * 
   * This constructor:
   * 1. Opens/creates the SQLite database file
   * 2. Enables WAL (Write-Ahead Logging) mode for better concurrency
   * 3. Creates necessary tables if they don't exist
   * 4. Retrieves or generates KDF parameters
   * 5. Derives the encryption key from passphrase + KDF params
   * 
   * @param dbPath - Path to SQLite database file (e.g., "/home/node/.mega/alice.db")
   * @param passphrase - User's passphrase for encryption key derivation
   */
  constructor(dbPath: string, passphrase: string) {
    // Open SQLite database file
    // If the file doesn't exist, it will be created automatically
    this.db = new Database(dbPath);
    
    // Enable WAL (Write-Ahead Logging) mode
    // 
    // WAL mode provides significant benefits over default rollback journal:
    // 1. READERS DON'T BLOCK WRITERS: Multiple readers can access the database
    //    while a writer is making changes
    // 2. WRITERS DON'T BLOCK READERS: Readers see a consistent snapshot even
    //    during a write transaction
    // 3. FASTER: Generally faster than rollback journal mode
    // 4. SAFER: Less likely to corrupt during crashes
    //
    // How WAL works: Changes are written to a separate "write-ahead log" file.
    // Periodically, changes are moved from the log to the main database file
    // in a "checkpoint" operation.
    this.db.pragma("journal_mode = WAL");
    
    // Create tables if they don't exist
    // We use a single exec() call with multiple CREATE TABLE statements
    // 
    // 'meta' table: Stores plaintext metadata
    // - key: TEXT PRIMARY KEY - The metadata key name
    // - value: TEXT NOT NULL - The metadata value as JSON string
    //
    // 'kv' table: Stores encrypted key-value pairs
    // - key: TEXT PRIMARY KEY - The storage key
    // - value: BLOB NOT NULL - AES-256-GCM encrypted data
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);" +
        "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value BLOB NOT NULL);"
    );

    // Initialize or retrieve KDF (Key Derivation Function) parameters
    // 
    // Try to get existing KDF params from the database
    // If this is a new database, createKdfParams() will generate new random params
    const kdf = this.getMeta<KdfParams>(META_KDF);
    const params = kdf ?? createKdfParams();
    
    // If this is a new database, store the KDF parameters
    // We store these in plaintext because we need them to derive the key
    // The KDF params are not sensitive - they include a random salt, but without
    // the passphrase, the salt doesn't help an attacker
    if (!kdf) {
      this.setMeta(META_KDF, params);
    }
    
    // Derive the encryption key using scrypt
    // This is the CRITICAL security step - the passphrase is converted to a
    // fixed-length key suitable for AES encryption
    // The same passphrase + params will always produce the same key
    this.key = deriveKey(passphrase, params);
  }

  /**
   * Retrieve a metadata value from the plaintext 'meta' table.
   * 
   * Metadata is stored as JSON strings and includes non-sensitive information
   * like identity names, device IDs, and KDF parameters.
   * 
   * @param key - The metadata key to retrieve
   * @returns The parsed value, or undefined if key doesn't exist
   */
  getMeta<T>(key: string): T | undefined {
    // Prepare a parameterized query
    // The '?' placeholder will be replaced with the actual key value
    // This prevents SQL injection attacks
    const stmt = this.db.prepare("SELECT value FROM meta WHERE key = ?");
    
    // Execute query with the key as parameter
    // .get() returns the first matching row, or undefined if none
    const row = stmt.get(key) as { value: string } | undefined;
    
    // If no row found, return undefined
    if (!row) return undefined;
    
    // Parse the JSON value and cast to the expected type
    return JSON.parse(row.value) as T;
  }

  /**
   * Store a metadata value in the plaintext 'meta' table.
   * 
   * Values are serialized to JSON before storage.
   * Uses INSERT OR REPLACE to handle both insert and update in one operation.
   * 
   * @param key - The metadata key name
   * @param value - The value to store (will be JSON serialized)
   */
  setMeta<T>(key: string, value: T): void {
    // Prepare INSERT OR REPLACE statement
    // This is SQLite's "upsert" operation - inserts if key doesn't exist,
    // replaces if it does
    const stmt = this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
    
    // Execute with key and JSON-serialized value
    stmt.run(key, JSON.stringify(value));
  }

  /**
   * Retrieve and decrypt a value from the encrypted 'kv' table.
   * 
   * This is the primary method for accessing encrypted Signal Protocol data.
   * The value is decrypted using AES-256-GCM with the key derived from the
   * user's passphrase.
   * 
   * @param key - The storage key
   * @returns The decrypted and parsed value, or undefined if not found
   */
  get<T>(key: string): T | undefined {
    // Prepare query to fetch encrypted blob
    const stmt = this.db.prepare("SELECT value FROM kv WHERE key = ?");
    const row = stmt.get(key) as { value: Buffer } | undefined;
    
    // Return undefined if key not found
    if (!row) return undefined;
    
    // Decrypt the stored buffer using our derived key
    // decryptJson handles both decryption and JSON parsing
    return decryptJson(this.key, row.value) as T;
  }

  /**
   * Encrypt and store a value in the 'kv' table.
   * 
   * The value is:
   * 1. Serialized to JSON (with special handling for binary data)
   * 2. Encrypted using AES-256-GCM
   * 3. Stored as a BLOB in SQLite
   * 
   * @param key - The storage key
   * @param value - The value to encrypt and store
   */
  set(key: string, value: unknown): void {
    // Encrypt the value using our derived key
    // encryptJson handles JSON serialization and AES-256-GCM encryption
    const payload = encryptJson(this.key, value);
    
    // Prepare upsert statement for encrypted kv table
    const stmt = this.db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)");
    
    // Execute with key and encrypted payload (Buffer)
    stmt.run(key, payload);
  }

  /**
   * Delete a key from the encrypted store.
   * 
   * @param key - The key to delete
   */
  delete(key: string): void {
    const stmt = this.db.prepare("DELETE FROM kv WHERE key = ?");
    stmt.run(key);
  }

  /**
   * List all keys matching a prefix.
   * 
   * This uses SQL's LIKE operator with '%' wildcard to match keys
   * starting with the given prefix.
   * 
   * Use case: Listing all inbox messages with prefix "inbox:"
   * 
   * @param prefix - The key prefix to search for
   * @returns Array of matching key names
   */
  listKeysByPrefix(prefix: string): string[] {
    // Prepare query with LIKE pattern
    // '%' is SQL wildcard matching any sequence of characters
    // So 'inbox:%' matches 'inbox:msg1', 'inbox:msg2', etc.
    const stmt = this.db.prepare("SELECT key FROM kv WHERE key LIKE ?");
    const rows = stmt.all(`${prefix}%`) as { key: string }[];
    
    // Extract just the key names from the result rows
    return rows.map((row) => row.key);
  }

  /**
   * Get the local Signal identity name (e.g., "alice", "sysmaint").
   * 
   * This is stored as metadata because it's not sensitive - it's how
   * other users identify this device on the network.
   * 
   * @returns The identity name, or undefined if not set
   */
  getLocalId(): string | undefined {
    return this.getMeta<string>(META_LOCAL_ID);
  }

  /**
   * Set the local Signal identity name.
   * 
   * @param id - The identity name (e.g., "alice")
   */
  setLocalId(id: string): void {
    this.setMeta(META_LOCAL_ID, id);
  }

  /**
   * Get the device ID.
   * 
   * Signal supports multiple devices per user (e.g., phone + desktop).
   * The device ID distinguishes between devices for the same user.
   * Default is 1 for single-device setups.
   * 
   * @returns The device ID, or undefined if not set
   */
  getDeviceId(): number | undefined {
    return this.getMeta<number>(META_DEVICE_ID);
  }

  /**
   * Set the device ID.
   * 
   * @param id - The device identifier (typically 1)
   */
  setDeviceId(id: number): void {
    this.setMeta(META_DEVICE_ID, id);
  }

  /**
   * Get the Signal registration ID.
   * 
   * This is a random 0-16380 identifier generated during identity creation.
   * It's used in the Signal protocol to prevent certain attacks.
   * 
   * @returns The registration ID, or undefined if not set
   */
  getRegistrationId(): number | undefined {
    return this.getMeta<number>(META_REG_ID);
  }

  /**
   * Set the Signal registration ID.
   * 
   * @param id - The registration ID (should be 0-16380)
   */
  setRegistrationId(id: number): void {
    this.setMeta(META_REG_ID, id);
  }
}

// ============================================================================
// SIGNAL PROTOCOL STORE ADAPTERS
// ============================================================================

/**
 * Helper function to convert a ProtocolAddress to a string key.
 * 
 * ProtocolAddress consists of a name (user ID) and device ID.
 * Signal represents this as "userId.deviceId" (e.g., "alice.1")
 * 
 * We use this as a key prefix for storing per-contact data.
 * 
 * @param address - The Signal protocol address
 * @returns String representation suitable for use as a key
 */
function addressKey(address: ProtocolAddress): string {
  return address.toString();
}

/**
 * SqliteIdentityStore - Implements Signal's IdentityKeyStore interface.
 * 
 * This store manages identity keys:
 * - Our own identity key pair (private key for signing, public key for distribution)
 * - Identity keys of our contacts (for verifying their signatures)
 * 
 * SIGNAL PROTOCOL CONTEXT:
 * 
 * In Signal, each user has a long-term Curve25519 identity key pair.
 * When you first message someone, you verify their identity key (trust on first
 * use, or TOFU). If their key ever changes, Signal warns you (potential MITM).
 * 
 * This store implements the persistence layer for that key management.
 */
export class SqliteIdentityStore extends IdentityKeyStore {
  /**
   * Constructor takes an EncryptedStore for underlying storage.
   * 
   * All identity keys are encrypted at rest using the EncryptedStore's
   * encryption scheme.
   * 
   * @param store - The encrypted store instance
   */
  constructor(private store: EncryptedStore) {
    super(); // Call parent abstract class constructor
  }

  /**
   * Get our private identity key.
   * 
   * This key is used to:
   * - Sign prekeys (proving we own them)
   * - Sign messages (proving they came from us)
   * 
   * SECURITY: This is one of the most sensitive keys. Never expose it!
   * It's stored encrypted and only decrypted when needed.
   * 
   * @returns Promise resolving to our Curve25519 private key
   * @throws Error if identity not initialized
   */
  async getIdentityKey(): Promise<PrivateKey> {
    // Load our identity key pair from encrypted storage
    const data = this.store.get<Uint8Array>("local:identityKeyPair");
    if (!data) throw new Error("Identity key pair not found. Run 'mega init'.");
    
    // Deserialize the bytes into an IdentityKeyPair object
    // Then return just the private key component
    return IdentityKeyPair.deserialize(data).privateKey;
  }

  /**
   * Get our Signal registration ID.
   * 
   * This is used in the X3DH key agreement protocol.
   * 
   * @returns Promise resolving to our registration ID (0-16380)
   * @throws Error if not initialized
   */
  async getLocalRegistrationId(): Promise<number> {
    const value = this.store.getRegistrationId();
    if (value === undefined) throw new Error("Registration id not found. Run 'mega init'.");
    return value;
  }

  /**
   * Save a contact's public identity key.
   * 
   * This is called when we receive a prekey bundle from someone.
   * We store their identity key so we can verify their signatures later.
   * 
   * SECURITY IMPLICATIONS:
   * - If this returns IdentityChange.NewOrUnchanged: First time seeing this contact
   * - If this returns IdentityChange.ReplacedExisting: Their key changed!
   *   This could indicate a MITM attack, or they reinstalled the app.
   * 
   * @param name - The contact's protocol address (userId.deviceId)
   * @param key - Their public identity key
   * @returns Promise resolving to whether this is a new or changed identity
   */
  async saveIdentity(name: ProtocolAddress, key: PublicKey): Promise<IdentityChange> {
    // Build storage key for this contact's identity
    const keyName = `identity:${addressKey(name)}`;
    
    // Check if we already have an identity stored for this contact
    const stored = this.store.get<Uint8Array>(keyName);
    
    // Serialize the new public key to bytes for storage
    const serialized = key.serialize();
    
    // Store the new identity key (encrypted)
    this.store.set(keyName, serialized);
    
    // If we didn't have a previous identity, this is new
    if (!stored) {
      return IdentityChange.NewOrUnchanged;
    }
    
    // Compare the stored key with the new key
    const existing = PublicKey.deserialize(stored);
    if (existing.equals(key)) {
      // Keys are identical - no change
      return IdentityChange.NewOrUnchanged;
    } else {
      // Keys are different - identity has changed!
      // In production Signal clients, this triggers a security warning
      return IdentityChange.ReplacedExisting;
    }
  }

  /**
   * Check if a public key matches our stored identity for a contact.
   * 
   * This is called during message decryption to verify the sender's identity.
   * It implements Signal's "trust on first use" (TOFU) model:
   * - If we haven't seen this contact before: trust them (return true)
   * - If we have seen them: their key must match exactly
   * 
   * @param name - The contact's protocol address
   * @param key - The public key to verify
   * @param _direction - Whether we're sending or receiving (unused)
   * @returns Promise resolving to whether the key is trusted
   */
  async isTrustedIdentity(name: ProtocolAddress, key: PublicKey, _direction: Direction): Promise<boolean> {
    const keyName = `identity:${addressKey(name)}`;
    const stored = this.store.get<Uint8Array>(keyName);
    
    if (!stored) {
      // Trust on first use - we haven't seen this contact before
      return true;
    }
    
    // We have a stored key - it must match exactly
    const existing = PublicKey.deserialize(stored);
    return existing.equals(key);
  }

  /**
   * Get a contact's stored public identity key.
   * 
   * @param name - The contact's protocol address
   * @returns Promise resolving to their public key, or null if not stored
   */
  async getIdentity(name: ProtocolAddress): Promise<PublicKey | null> {
    const keyName = `identity:${addressKey(name)}`;
    const stored = this.store.get<Uint8Array>(keyName);
    if (!stored) return null;
    return PublicKey.deserialize(stored);
  }
}

/**
 * SqliteSessionStore - Implements Signal's SessionStore interface.
 * 
 * This store manages Signal protocol sessions. A session represents an
 * established secure communication channel with another user.
 * 
 * SIGNAL PROTOCOL SESSIONS:
 * 
 * When you first message someone using Signal, you perform X3DH key agreement
 * using their prekey bundle. This creates a "session" - a shared secret state
 * that enables the Double Ratchet algorithm for forward secrecy.
 * 
 * The session state includes:
 * - Root key (shared secret from X3DH)
 * - Chain keys for sending and receiving
 * - Message numbers for ordering and deduplication
 * 
 * Sessions are persisted so you can continue conversations across app restarts.
 */
export class SqliteSessionStore extends SessionStore {
  constructor(private store: EncryptedStore) {
    super();
  }

  /**
   * Save a session record for a contact.
   * 
   * Called after X3DH key agreement completes, and after each message
 * to update chain keys (forward secrecy).
   * 
   * @param name - The contact's protocol address
   * @param record - The session state to persist
   */
  async saveSession(name: ProtocolAddress, record: SessionRecord): Promise<void> {
    const keyName = `session:${addressKey(name)}`;
    // Serialize session state to bytes and encrypt
    this.store.set(keyName, record.serialize());
  }

  /**
   * Retrieve a session record.
   * 
   * Called when sending a message to check if we have an existing session.
   * If no session exists, we need to fetch the recipient's prekey bundle
   * and perform X3DH to establish one.
   * 
   * @param name - The contact's protocol address
   * @returns Promise resolving to the session record, or null if not found
   */
  async getSession(name: ProtocolAddress): Promise<SessionRecord | null> {
    const keyName = `session:${addressKey(name)}`;
    const stored = this.store.get<Uint8Array>(keyName);
    if (!stored) return null;
    return SessionRecord.deserialize(stored);
  }

  /**
   * Get multiple sessions at once.
   * 
   * @param addresses - Array of protocol addresses to look up
   * @returns Promise resolving to array of found session records
   */
  async getExistingSessions(addresses: ProtocolAddress[]): Promise<SessionRecord[]> {
    const records: SessionRecord[] = [];
    for (const address of addresses) {
      const record = await this.getSession(address);
      if (record) records.push(record);
    }
    return records;
  }
}

/**
 * SqlitePreKeyStore - Implements Signal's PreKeyStore interface.
 * 
 * This store manages one-time prekeys.
 * 
 * ONE-TIME PREKEYS IN SIGNAL:
 * 
 * One-time prekeys are used during X3DH key agreement. Each prekey is used
 * exactly once (in theory) to establish a session. This provides forward
 * secrecy - even if a prekey is compromised later, it can't decrypt past
 * messages.
 * 
 * In practice, we generate many one-time prekeys and upload them to the
 * server. When someone wants to message us, they use one of these prekeys
 * in their X3DH calculation.
 * 
 * IMPORTANT NOTE ABOUT removePreKey:
 * In production Signal clients, used prekeys are deleted immediately.
 * In this implementation, we only mark them as used. This is a deliberate
 * choice for the demo/learning environment to handle race conditions where
 * multiple clients might try to use prekeys simultaneously.
 */
export class SqlitePreKeyStore extends PreKeyStore {
  constructor(private store: EncryptedStore) {
    super();
  }

  /**
   * Save a one-time prekey.
   * 
   * @param id - The prekey ID (unique identifier)
   * @param record - The prekey data (contains private key)
   */
  async savePreKey(id: number, record: PreKeyRecord): Promise<void> {
    this.store.set(`prekey:${id}`, record.serialize());
  }

  /**
   * Get a one-time prekey by ID.
   * 
   * @param id - The prekey ID
   * @returns Promise resolving to the prekey record
   * @throws Error if prekey not found
   */
  async getPreKey(id: number): Promise<PreKeyRecord> {
    const stored = this.store.get<Uint8Array>(`prekey:${id}`);
    if (!stored) throw new Error(`PreKey ${id} not found`);
    return PreKeyRecord.deserialize(stored);
  }

  /**
   * Mark a prekey as used.
   * 
   * NOTE: In production, this would DELETE the prekey. Here we just mark
   * it to avoid race conditions in the demo environment.
   * 
   * @param id - The prekey ID to mark as used
   */
  async removePreKey(id: number): Promise<void> {
    // Mark the prekey as used by storing a timestamp
    // This allows us to track usage without deleting the key
    this.store.set("prekey:used:" + id, { usedAt: Date.now() });
  }
}

/**
 * SqliteSignedPreKeyStore - Implements Signal's SignedPreKeyStore interface.
 * 
 * This store manages signed prekeys.
 * 
 * SIGNED PREKEYS IN SIGNAL:
 * 
 * Signed prekeys are medium-term keys (rotated every few days/weeks).
 * Unlike one-time prekeys, signed prekeys are reused for multiple sessions.
 * They're signed by the identity key to prove they're legitimate.
 * 
 * The signature allows recipients to verify that the prekey actually belongs
 * to the claimed identity, preventing MITM attacks during session setup.
 */
export class SqliteSignedPreKeyStore extends SignedPreKeyStore {
  constructor(private store: EncryptedStore) {
    super();
  }

  /**
   * Save a signed prekey.
   * 
   * @param id - The signed prekey ID
   * @param record - The signed prekey data (contains key + signature)
   */
  async saveSignedPreKey(id: number, record: SignedPreKeyRecord): Promise<void> {
    this.store.set(`signedprekey:${id}`, record.serialize());
  }

  /**
   * Get a signed prekey by ID.
   * 
   * @param id - The signed prekey ID
   * @returns Promise resolving to the signed prekey record
   * @throws Error if not found
   */
  async getSignedPreKey(id: number): Promise<SignedPreKeyRecord> {
    const stored = this.store.get<Uint8Array>(`signedprekey:${id}`);
    if (!stored) throw new Error(`SignedPreKey ${id} not found`);
    return SignedPreKeyRecord.deserialize(stored);
  }
}

/**
 * SqliteKyberPreKeyStore - Implements Signal's KyberPreKeyStore interface.
 * 
 * This store manages Kyber post-quantum prekeys.
 * 
 * KYBER (CRYSTALS-Kyber) POST-QUANTUM CRYPTOGRAPHY:
 * 
 * Kyber is a quantum-resistant key encapsulation mechanism (KEM).
 * It's being added to Signal to protect against future quantum computers
 * that could break traditional elliptic curve cryptography.
 * 
 * Signal uses a hybrid approach: Kyber + X25519
 * - X25519 provides the current security level
 * - Kyber provides protection against quantum attacks
 * - The combination is at least as secure as either alone
 * 
 * Like signed prekeys, Kyber prekeys are signed by the identity key.
 */
export class SqliteKyberPreKeyStore extends KyberPreKeyStore {
  constructor(private store: EncryptedStore) {
    super();
  }

  /**
   * Save a Kyber prekey.
   * 
   * @param id - The Kyber prekey ID
   * @param record - The Kyber prekey data
   */
  async saveKyberPreKey(id: number, record: KyberPreKeyRecord): Promise<void> {
    this.store.set(`kyberprekey:${id}`, record.serialize());
  }

  /**
   * Get a Kyber prekey by ID.
   * 
   * @param id - The Kyber prekey ID
   * @returns Promise resolving to the Kyber prekey record
   * @throws Error if not found
   */
  async getKyberPreKey(id: number): Promise<KyberPreKeyRecord> {
    const stored = this.store.get<Uint8Array>(`kyberprekey:${id}`);
    if (!stored) throw new Error(`KyberPreKey ${id} not found`);
    return KyberPreKeyRecord.deserialize(stored);
  }

  /**
   * Mark a Kyber prekey as used.
   * 
   * Stores metadata about when and how the prekey was used.
   * 
   * @param id - The Kyber prekey ID
   * @param signedPreKeyId - The associated signed prekey ID
   * @param baseKey - The base public key used
   */
  async markKyberPreKeyUsed(id: number, signedPreKeyId: number, baseKey: PublicKey): Promise<void> {
    this.store.set(`kyberprekey:used:${id}`, {
      signedPreKeyId,
      baseKey: baseKey.serialize(),
      usedAt: Date.now()
    });
  }
}

// ============================================================================
// HELPER FUNCTIONS FOR IDENTITY KEY PAIR
// ============================================================================

/**
 * Load our identity key pair from encrypted storage.
 * 
 * The identity key pair is the most important key in Signal. It consists of:
 * - Private key: Used to sign prekeys and messages (NEVER share this!)
 * - Public key: Shared with others so they can verify our signatures
 * 
 * This function is used during initialization and when we need to sign data.
 * 
 * @param store - The encrypted store instance
 * @returns The deserialized IdentityKeyPair
 * @throws Error if identity not initialized
 */
export function loadIdentityKeyPair(store: EncryptedStore): IdentityKeyPair {
  const data = store.get<Uint8Array>("local:identityKeyPair");
  if (!data) throw new Error("Identity key pair not found. Run 'mega init'.");
  return IdentityKeyPair.deserialize(data);
}

/**
 * Save our identity key pair to encrypted storage.
 * 
 * This is called during identity initialization (mega init command).
 * The key pair is encrypted with AES-256-GCM before being stored.
 * 
 * SECURITY: The private key never leaves this encrypted store in plaintext.
 * It's only decrypted temporarily when needed for signing operations.
 * 
 * @param store - The encrypted store instance
 * @param pair - The identity key pair to store
 */
export function saveIdentityKeyPair(store: EncryptedStore, pair: IdentityKeyPair): void {
  store.set("local:identityKeyPair", pair.serialize());
}
