/**
 * ============================================================================
 * SIGNAL PROTOCOL CORE OPERATIONS MODULE
 * ============================================================================
 * 
 * This module provides the high-level operations for the Signal Protocol,
 * built on top of the official @signalapp/libsignal-client library.
 * 
 * PURPOSE:
 * This module serves as the main API for Signal Protocol operations in this
 * application. It provides a simplified interface over the official Signal
 * library, handling identity initialization, prekey management, session
 * establishment, and encryption/decryption.
 * 
 * ARCHITECTURE:
 * - SignalState: Aggregates all storage for a Signal identity
 * - High-level operations: initializeIdentity, generatePreKeys, exportBundle, etc.
 * - Message operations: encryptMessage, decryptMessage
 * - Inbox management: saveInboxMessage, listInboxMessages
 * 
 * SIGNAL PROTOCOL OVERVIEW:
 * 
 * The Signal Protocol (formerly TextSecure Protocol) provides end-to-end
 * encryption with these security properties:
 * 
 * 1. END-TO-END ENCRYPTION: Only sender and recipient can read messages
 * 2. FORWARD SECRECY: Compromised keys can't decrypt past messages
 * 3. FUTURE SECRECY: Compromised keys can't decrypt future messages
 * 4. INTEGRITY: Tampered messages are detected and rejected
 * 5. AUTHENTICITY: Recipients verify sender identity
 * 
 * KEY COMPONENTS:
 * 
 * - Identity Key: Long-term Curve25519 key pair
 * - Signed Prekey: Medium-term key, signed by identity key
 * - One-Time Prekeys: Ephemeral keys, deleted after use
 * - Kyber Prekeys: Post-quantum keys (CRYSTALS-Kyber)
 * - Sessions: Established secure channels (Double Ratchet)
 * 
 * WORKFLOW:
 * 
 * 1. INITIALIZE IDENTITY: Generate identity key pair, registration ID
 * 2. GENERATE PREKEYS: Create signed prekey, one-time prekeys, Kyber prekeys
 * 3. EXPORT BUNDLE: Share public prekeys with relay server
 * 4. ESTABLISH SESSION: X3DH key agreement using peer's prekey bundle
 * 5. ENCRYPT/DECRYPT: Send/receive messages using established session
 * 
 * ============================================================================
 */

// Node.js crypto module for random number generation
// Used for generating registration IDs
import crypto from "node:crypto";

// ============================================================================
// SIGNAL CLIENT LIBRARY IMPORTS
// ============================================================================

// Import required classes from the official Signal client library
// These are the building blocks of the Signal Protocol
import {
  // Message type constants
  CiphertextMessageType,        // Enum: PreKey (2) or Whisper (1) message types
  
  // Key types
  IdentityKeyPair,              // Contains public and private identity keys
  KEMKeyPair,                   // CRYSTALS-Kyber key encapsulation pair
  KEMPublicKey,                 // Kyber public key for encapsulation
  PreKeyBundle,                 // Collection of prekeys for X3DH
  PreKeyRecord,                 // One-time prekey storage format
  PreKeySignalMessage,          // Initial message format (contains prekey info)
  PrivateKey,                   // Curve25519 private key
  ProtocolAddress,              // Address format: "userId.deviceId"
  PublicKey,                    // Curve25519 public key
  SignalMessage,                // Regular message format
  SignedPreKeyRecord,           // Signed prekey storage format
  KyberPreKeyRecord,            // Kyber prekey storage format
  
  // Core protocol functions
  processPreKeyBundle,          // X3DH key agreement function
  signalDecrypt,                // Decrypt regular Signal message
  signalDecryptPreKey,          // Decrypt initial PreKey message
  signalEncrypt                 // Encrypt message using Signal protocol
} from "@signalapp/libsignal-client";

// Import envelope schema from shared package
// Envelope is the transport format for encrypted messages
import { parseEnvelope, type Envelope } from "@mega/shared";

// Import our crypto utilities
import { fromBase64, toBase64 } from "./crypto.js";

// Import our store classes
import {
  EncryptedStore,
  SqliteIdentityStore,
  SqliteKyberPreKeyStore,
  SqlitePreKeyStore,
  SqliteSessionStore,
  SqliteSignedPreKeyStore,
  loadIdentityKeyPair,
  saveIdentityKeyPair
} from "./store.js";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Bundle type - Represents a prekey bundle that can be shared with peers.
 * 
 * A prekey bundle contains all the public keys necessary for someone to
 * establish a Signal session with us. It's uploaded to the relay server
 * where peers can download it to start messaging us.
 * 
 * SECURITY: This contains ONLY public keys. Private keys are never shared.
 */
export type Bundle = {
  /** Signal identity name (e.g., "alice", "sysmaint") */
  id: string;
  
  /** Device identifier (for multi-device support) */
  deviceId: number;
  
  /** Signal registration ID (random 0-16380) */
  registrationId: number;
  
  /** Base64-encoded Curve25519 identity public key */
  identityKey: string;
  
  /** Signed prekey - medium term, signed by identity key */
  signedPreKey: {
    keyId: number;
    publicKey: string;    // Base64-encoded Curve25519 public key
    signature: string;    // Base64-encoded signature
  };
  
  /** One-time prekey - ephemeral, used once per session */
  preKey: {
    keyId: number;
    publicKey: string;    // Base64-encoded Curve25519 public key
  };
  
  /** Kyber post-quantum prekey - quantum-resistant */
  kyberPreKey: {
    keyId: number;
    publicKey: string;    // Base64-encoded Kyber public key
    signature: string;    // Base64-encoded signature
  };
};

/**
 * InboxMessage type - Represents a decrypted message in the inbox.
 * 
 * When messages are received, they're decrypted and stored in the inbox
 * for later retrieval. This type represents the stored message format.
 */
export type InboxMessage = {
  /** Unique message identifier (timestamp + sender + random) */
  id: string;
  
  /** Signal identity of the sender */
  senderId: string;
  
  /** Message timestamp (milliseconds since epoch) */
  timestamp: number;
  
  /** Decrypted plaintext content */
  plaintext: string;
  
  /** Original envelope (for reference/debugging) */
  envelope: Envelope;
};

// ============================================================================
// COUNTER KEYS FOR PREKEY ID GENERATION
// ============================================================================

/**
 * Counter keys for tracking prekey IDs.
 * 
 * Each type of prekey (one-time, signed, Kyber) has its own counter that
 * increments each time a new prekey is generated. This ensures unique IDs
 * for all prekeys.
 * 
 * These are stored in the SignalState and persist across sessions.
 */
const COUNTER_PREKEY = "counter:prekey";                    // One-time prekeys
const COUNTER_SIGNED_PREKEY = "counter:signedprekey";      // Signed prekeys
const COUNTER_KYBER_PREKEY = "counter:kyberprekey";        // Kyber prekeys

// ============================================================================
// SIGNAL STATE - AGGREGATED STORAGE CONTAINER
// ============================================================================

/**
 * SignalState aggregates all storage components for a Signal identity.
 * 
 * This class provides a unified interface to all the storage required by
 * the Signal Protocol. It wraps the EncryptedStore and provides specialized
 * store instances for each type of Signal data.
 * 
 * USAGE:
 * ```typescript
 * const state = openStore("/path/to/db", "passphrase");
 * await initializeIdentity(state, "alice");
 * await generatePreKeys(state);
 * const bundle = await exportBundle(state);
 * ```
 * 
 * COMPONENTS:
 * - EncryptedStore: Core encrypted SQLite storage
 * - SqliteIdentityStore: Identity key management
 * - SqliteSessionStore: Established sessions
 * - SqlitePreKeyStore: One-time prekeys
 * - SqliteSignedPreKeyStore: Signed prekeys
 * - SqliteKyberPreKeyStore: Post-quantum prekeys
 */
export class SignalState {
  /** Core encrypted storage - handles SQLite and AES-256-GCM encryption */
  readonly store: EncryptedStore;
  
  /** Identity key storage - manages our identity and contact identities */
  readonly identityStore: SqliteIdentityStore;
  
  /** Session storage - manages established Signal sessions */
  readonly sessionStore: SqliteSessionStore;
  
  /** One-time prekey storage */
  readonly preKeyStore: SqlitePreKeyStore;
  
  /** Signed prekey storage */
  readonly signedPreKeyStore: SqliteSignedPreKeyStore;
  
  /** Kyber post-quantum prekey storage */
  readonly kyberPreKeyStore: SqliteKyberPreKeyStore;

  /**
   * Create a new SignalState instance.
   * 
   * This initializes all the storage components needed for Signal Protocol
   * operations. The database is created if it doesn't exist.
   * 
   * @param dbPath - Path to SQLite database file
   * @param passphrase - Passphrase for encryption key derivation
   */
  constructor(dbPath: string, passphrase: string) {
    // Initialize the core encrypted store
    // This sets up SQLite with WAL mode and derives the encryption key
    this.store = new EncryptedStore(dbPath, passphrase);
    
    // Create specialized store instances that use the encrypted store
    // Each store implements a Signal Protocol interface
    this.identityStore = new SqliteIdentityStore(this.store);
    this.sessionStore = new SqliteSessionStore(this.store);
    this.preKeyStore = new SqlitePreKeyStore(this.store);
    this.signedPreKeyStore = new SqliteSignedPreKeyStore(this.store);
    this.kyberPreKeyStore = new SqliteKyberPreKeyStore(this.store);
  }

  /**
   * Get the local Signal identity name.
   * 
   * @returns The identity name (e.g., "alice"), or undefined if not initialized
   */
  getLocalIdentity(): string | undefined {
    return this.store.getLocalId();
  }

  /**
   * Set the local Signal identity name.
   * 
   * @param id - The identity name to set
   */
  setLocalIdentity(id: string): void {
    this.store.setLocalId(id);
  }

  /**
   * Get the device ID.
   * 
   * @returns The device ID (defaults to 1 if not set)
   */
  getDeviceId(): number {
    return this.store.getDeviceId() ?? 1;
  }

  /**
   * Set the device ID.
   * 
   * @param id - The device identifier
   */
  setDeviceId(id: number): void {
    this.store.setDeviceId(id);
  }

  /**
   * Get the Signal registration ID.
   * 
   * @returns The registration ID, or undefined if not initialized
   */
  getRegistrationId(): number | undefined {
    return this.store.getRegistrationId();
  }

  /**
   * Set the Signal registration ID.
   * 
   * @param id - The registration ID (should be 1-16380)
   */
  setRegistrationId(id: number): void {
    this.store.setRegistrationId(id);
  }

  /**
   * Get our identity key pair.
   * 
   * This contains both our public and private identity keys.
   * The private key is used for signing prekeys and messages.
   * 
   * SECURITY: Use with caution - this includes the private key!
   * 
   * @returns Our IdentityKeyPair
   */
  getIdentityKeyPair(): IdentityKeyPair {
    return loadIdentityKeyPair(this.store);
  }

  /**
   * Set our identity key pair.
   * 
   * @param pair - The IdentityKeyPair to store
   */
  setIdentityKeyPair(pair: IdentityKeyPair): void {
    saveIdentityKeyPair(this.store, pair);
  }

  /**
   * Get a custom value from the store.
   * 
   * This is used for storing arbitrary data associated with this identity.
   * 
   * @param key - The key to retrieve
   * @returns The stored value, or undefined if not found
   */
  getValue<T>(key: string): T | undefined {
    return this.store.get<T>(key);
  }

  /**
   * Store a custom value.
   * 
   * @param key - The key name
   * @param value - The value to store
   */
  setValue(key: string, value: unknown): void {
    this.store.set(key, value);
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Factory function to create a SignalState instance.
 * 
 * This is the recommended way to create a SignalState. It's a convenience
 * wrapper around the constructor.
 * 
 * EXAMPLE:
 * ```typescript
 * const state = openStore("/home/node/.mega/alice.db", "myPassphrase");
 * ```
 * 
 * @param dbPath - Path to SQLite database
 * @param passphrase - Encryption passphrase
 * @returns A new SignalState instance
 */
export function openStore(dbPath: string, passphrase: string): SignalState {
  return new SignalState(dbPath, passphrase);
}

// ============================================================================
// IDENTITY INITIALIZATION
// ============================================================================

/**
 * Initialize a new Signal identity.
 * 
 * This function sets up a new Signal identity with:
 * 1. A random registration ID (1-16380)
 * 2. A new Curve25519 identity key pair
 * 
 * This is the FIRST operation needed for any new Signal user. It creates
 * the cryptographic foundation for all Signal Protocol operations.
 * 
 * X3DH CONTEXT:
 * The identity key pair is the long-term key used in X3DH. The public key
 * is shared with others so they can verify our signatures. The private key
 * is used to sign our prekeys and messages.
 * 
 * EXAMPLE:
 * ```typescript
 * const state = openStore("alice.db", "passphrase");
 * await initializeIdentity(state, "alice", 1);
 * ```
 * 
 * @param state - The SignalState to initialize
 * @param localId - The identity name (e.g., "alice")
 * @param deviceId - The device identifier (default: 1)
 */
export async function initializeIdentity(
  state: SignalState,
  localId: string,
  deviceId = 1
): Promise<void> {
  // Generate a random registration ID
  // Signal uses registration IDs to prevent certain attacks
  // Range is 1-16380 (0 is reserved, 16383 max for 14-bit field)
  const registrationId = crypto.randomInt(1, 16380);
  
  // Generate a new Curve25519 identity key pair
  // Curve25519 is an elliptic curve designed for fast, secure key exchange
  // The private key is 32 random bytes
  // The public key is derived from the private key via scalar multiplication
  const identityKeyPair = IdentityKeyPair.generate();

  // Store all identity information in the state
  state.setLocalIdentity(localId);
  state.setDeviceId(deviceId);
  state.setRegistrationId(registrationId);
  state.setIdentityKeyPair(identityKeyPair);
}

// ============================================================================
// PREKEY GENERATION
// ============================================================================

/**
 * Helper to increment and retrieve counter values.
 * 
 * Prekeys are identified by numeric IDs. This function ensures each prekey
 * gets a unique ID by incrementing a stored counter.
 * 
 * @param state - The SignalState containing counters
 * @param key - The counter key name
 * @param start - Starting value if counter doesn't exist (default: 1)
 * @returns The current counter value (before increment)
 */
function nextCounter(state: SignalState, key: string, start = 1): number {
  // Get current value, or use start value if not set
  const current = state.getValue<number>(key) ?? start;
  
  // Store the next value (current + 1)
  state.setValue(key, current + 1);
  
  // Return the current value for use as ID
  return current;
}

/**
 * Generate a new set of prekeys.
 * 
 * This creates three types of prekeys that are needed for the Signal Protocol:
 * 
 * 1. ONE-TIME PREKEYS: Ephemeral Curve25519 keys
 *    - Used once per session establishment
 *    - Deleted after use for forward secrecy
 *    - Multiple can be generated (count parameter)
 * 
 * 2. SIGNED PREKEY: Medium-term Curve25519 key
 *    - Signed by identity key
 *    - Reused for multiple sessions
 *    - Rotated periodically (e.g., weekly)
 * 
 * 3. KYBER PREKEY: Post-quantum KEM key
 *    - CRYSTALS-Kyber algorithm (quantum-resistant)
 *    - Signed by identity key
 *    - Provides protection against quantum attacks
 * 
 * SIGNAL PROTOCOL CONTEXT:
 * 
 * Prekeys enable asynchronous messaging. When Alice wants to message Bob,
 * she can do so even if Bob is offline. She downloads Bob's prekey bundle
 * from the server and uses it to perform X3DH key agreement.
 * 
 * EXAMPLE:
 * ```typescript
 * await generatePreKeys(state, 5);  // Generate 5 one-time prekeys + signed + Kyber
 * ```
 * 
 * @param state - The SignalState to store prekeys in
 * @param count - Number of one-time prekeys to generate (default: 1)
 */
export async function generatePreKeys(state: SignalState, count = 1): Promise<void> {
  // Get our identity key pair for signing prekeys
  const identityKeyPair = state.getIdentityKeyPair();

  // Generate one-time prekeys
  // These are simple Curve25519 key pairs
  for (let i = 0; i < count; i += 1) {
    // Get next available prekey ID
    const preKeyId = nextCounter(state, COUNTER_PREKEY);
    
    // Generate a new Curve25519 private key
    // The public key is derived from this private key
    const preKeyPrivate = PrivateKey.generate();
    
    // Create a PreKeyRecord containing both keys
    // PreKeyRecord.new(id, publicKey, privateKey)
    const preKeyRecord = PreKeyRecord.new(
      preKeyId,
      preKeyPrivate.getPublicKey(),
      preKeyPrivate
    );
    
    // Store the prekey in our encrypted database
    await state.preKeyStore.savePreKey(preKeyId, preKeyRecord);
  }

  // Generate signed prekey
  const signedPreKeyId = nextCounter(state, COUNTER_SIGNED_PREKEY);
  
  // Generate new Curve25519 key pair
  const signedPreKeyPrivate = PrivateKey.generate();
  const signedPreKeyPublic = signedPreKeyPrivate.getPublicKey();
  
  // Sign the public key with our identity private key
  // This proves the prekey belongs to us
  // The signature can be verified by anyone with our identity public key
  const signedSignature = identityKeyPair.privateKey.sign(signedPreKeyPublic.serialize());
  
  // Create SignedPreKeyRecord with all components
  // SignedPreKeyRecord.new(id, timestamp, publicKey, privateKey, signature)
  const signedPreKeyRecord = SignedPreKeyRecord.new(
    signedPreKeyId,
    Date.now(),  // Timestamp for rotation tracking
    signedPreKeyPublic,
    signedPreKeyPrivate,
    signedSignature
  );
  
  // Store the signed prekey
  await state.signedPreKeyStore.saveSignedPreKey(signedPreKeyId, signedPreKeyRecord);

  // Generate Kyber post-quantum prekey
  const kyberPreKeyId = nextCounter(state, COUNTER_KYBER_PREKEY);
  
  // Generate CRYSTALS-Kyber key pair
  // Kyber is a quantum-resistant key encapsulation mechanism
  const kemKeyPair = KEMKeyPair.generate();
  
  // Sign the Kyber public key with our identity key
  // Like the signed prekey, this proves ownership
  const kyberSignature = identityKeyPair.privateKey.sign(kemKeyPair.getPublicKey().serialize());
  
  // Create KyberPreKeyRecord
  // KyberPreKeyRecord.new(id, timestamp, keyPair, signature)
  const kyberRecord = KyberPreKeyRecord.new(
    kyberPreKeyId,
    Date.now(),
    kemKeyPair,
    kyberSignature
  );
  
  // Store the Kyber prekey
  await state.kyberPreKeyStore.saveKyberPreKey(kyberPreKeyId, kyberRecord);
}

// ============================================================================
// PREKEY BUNDLE EXPORT
// ============================================================================

/**
 * Export our prekey bundle to share with peers.
 * 
 * A prekey bundle contains all the PUBLIC information needed for someone
 * to establish a Signal session with us. It includes:
 * - Our identity public key
 * - Our signed prekey (public + signature)
 * - One one-time prekey (public)
 * - Our Kyber prekey (public + signature)
 * 
 * SECURITY: This contains ONLY public keys. Private keys never leave
 * the encrypted store.
 * 
 * This bundle is uploaded to the relay server where peers can download
 * it when they want to message us.
 * 
 * EXAMPLE:
 * ```typescript
 * const bundle = await exportBundle(state);
 * await uploadToRelay(bundle);
 * ```
 * 
 * @param state - The SignalState containing our prekeys
 * @returns A Bundle object with all public prekey information
 * @throws Error if identity not initialized
 */
export async function exportBundle(state: SignalState): Promise<Bundle> {
  // Get our identity key pair
  const identityKeyPair = state.getIdentityKeyPair();
  
  // Get our registration ID
  const registrationId = state.getRegistrationId();
  
  // Get our local identity name
  const localId = state.getLocalIdentity();
  
  // Verify we have all required identity information
  if (!localId || registrationId === undefined) {
    throw new Error("Local identity not set. Run 'mega init'.");
  }
  
  // Get our device ID
  const deviceId = state.getDeviceId();

  // Get current counter values
  // We store (next ID), so we subtract 1 to get the most recently generated
  const signedPreKeyId = (state.getValue<number>(COUNTER_SIGNED_PREKEY) ?? 2) - 1;
  const preKeyId = (state.getValue<number>(COUNTER_PREKEY) ?? 2) - 1;
  const kyberPreKeyId = (state.getValue<number>(COUNTER_KYBER_PREKEY) ?? 2) - 1;

  // Retrieve the actual prekey records from storage
  const signedPreKey = await state.signedPreKeyStore.getSignedPreKey(signedPreKeyId);
  const preKey = await state.preKeyStore.getPreKey(preKeyId);
  const kyberPreKey = await state.kyberPreKeyStore.getKyberPreKey(kyberPreKeyId);

  // Build the bundle with base64-encoded public keys
  return {
    // Identity information
    id: localId,
    deviceId,
    registrationId,
    
    // Identity public key (base64)
    identityKey: toBase64(identityKeyPair.publicKey.serialize()),
    
    // Signed prekey with signature
    signedPreKey: {
      keyId: signedPreKeyId,
      publicKey: toBase64(signedPreKey.publicKey().serialize()),
      signature: toBase64(signedPreKey.signature())
    },
    
    // One-time prekey
    preKey: {
      keyId: preKeyId,
      publicKey: toBase64(preKey.publicKey().serialize())
    },
    
    // Kyber post-quantum prekey
    kyberPreKey: {
      keyId: kyberPreKeyId,
      publicKey: toBase64(kyberPreKey.publicKey().serialize()),
      signature: toBase64(kyberPreKey.signature())
    }
  };
}

// ============================================================================
// SESSION ESTABLISHMENT
// ============================================================================

/**
 * Initialize a Signal session with a peer using their prekey bundle.
 * 
 * This performs X3DH (Extended Triple Diffie-Hellman) key agreement,
 * which establishes a shared secret between two parties who haven't
 * communicated before.
 * 
 * X3DH OVERVIEW:
 * 
 * X3DH is a key agreement protocol that combines multiple Diffie-Hellman
 * key exchanges to provide strong security guarantees:
 * 
 * Keys involved (Alice initiating to Bob):
 * - IKA: Alice's identity key pair
 * - EKA: Alice's ephemeral key pair (generated for this session)
 * - IKB: Bob's identity public key (from bundle)
 * - SPKB: Bob's signed prekey public (from bundle)
 * - OPKB: Bob's one-time prekey public (from bundle, optional)
 * 
 * The X3DH calculation computes a shared secret from 3-4 DH exchanges:
 * - DH1: IKA_private * IKB_public
 * - DH2: EKA_private * SPKB_public  
 * - DH3: EKA_private * IKB_public
 * - DH4: EKA_private * OPKB_public (if one-time prekey available)
 * 
 * The shared secret seeds the Double Ratchet for forward secrecy.
 * 
 * @param state - Our SignalState
 * @param bundle - The peer's prekey bundle (from relay server)
 */
export async function initSession(state: SignalState, bundle: Bundle): Promise<void> {
  // Create a ProtocolAddress for the peer
  // Format: "userId.deviceId" (e.g., "bob.1")
  const address = ProtocolAddress.new(bundle.id, bundle.deviceId);
  
  // Build a PreKeyBundle object from the bundle data
  // This deserializes all the base64-encoded keys
  const preKeyBundle = PreKeyBundle.new(
    // Registration ID
    bundle.registrationId,
    
    // Device ID
    bundle.deviceId,
    
    // One-time prekey info
    bundle.preKey.keyId,
    PublicKey.deserialize(fromBase64(bundle.preKey.publicKey)),
    
    // Signed prekey info
    bundle.signedPreKey.keyId,
    PublicKey.deserialize(fromBase64(bundle.signedPreKey.publicKey)),
    fromBase64(bundle.signedPreKey.signature),
    
    // Identity public key
    PublicKey.deserialize(fromBase64(bundle.identityKey)),
    
    // Kyber prekey info (post-quantum)
    bundle.kyberPreKey.keyId,
    KEMPublicKey.deserialize(fromBase64(bundle.kyberPreKey.publicKey)),
    fromBase64(bundle.kyberPreKey.signature)
  );

  // Process the prekey bundle to establish session state
  // This performs X3DH and creates a SessionRecord in our store
  // The session record contains the Double Ratchet state
  await processPreKeyBundle(
    preKeyBundle,
    address,
    state.sessionStore,
    state.identityStore
  );
}

// ============================================================================
// MESSAGE ENCRYPTION
// ============================================================================

/**
 * Encrypt a message to a recipient.
 * 
 * This encrypts a plaintext message using the Signal Protocol. If a session
 * doesn't exist with the recipient, it must be established first using
 * initSession().
 * 
 * ENCRYPTION PROCESS:
 * 
 * 1. Look up session for recipient
 * 2. Generate message key from Double Ratchet chain
 * 3. Encrypt plaintext with AES-256-CBC + HMAC-SHA256
 * 4. Advance ratchet for forward secrecy
 * 5. Create envelope with encrypted payload
 * 
 * SIGNAL MESSAGE TYPES:
 * 
 * - PreKey (type 2): First message to a new recipient, includes prekey info
 * - Whisper (type 1): Subsequent messages in established session
 * 
 * EXAMPLE:
 * ```typescript
 * const envelope = await encryptMessage(state, "bob", "Hello!");
 * await sendToRelay(envelope);
 * ```
 * 
 * @param state - Our SignalState
 * @param recipientId - The recipient's identity name
 * @param plaintext - The message to encrypt
 * @returns Envelope containing encrypted message
 */
export async function encryptMessage(
  state: SignalState,
  recipientId: string,
  plaintext: string
): Promise<Envelope> {
  // Create recipient's ProtocolAddress
  // Device ID defaults to 1
  const address = ProtocolAddress.new(recipientId, 1);
  
  // Encrypt using Signal protocol
  // signalEncrypt handles the Double Ratchet key derivation and encryption
  const ciphertext = await signalEncrypt(
    // Encode plaintext to UTF-8 bytes
    new TextEncoder().encode(plaintext),
    // Recipient address
    address,
    // Our session store (for reading/writing session state)
    state.sessionStore,
    // Our identity store (for our identity key)
    state.identityStore
  );

  // Get our identity name
  const senderId = state.getLocalIdentity();
  if (!senderId) throw new Error("Local identity not set. Run 'mega init'.");

  // Build the envelope
  // The envelope contains metadata + encrypted payload
  // It's what gets sent over the network via the relay
  return {
    // Protocol version
    version: 1,
    
    // Sender and recipient identities
    senderId,
    recipientId,
    
    // Session identifier (sender::recipient)
    sessionId: `${senderId}::${recipientId}`,
    
    // Message type: 2 = PreKey (first message), 1 = Whisper (subsequent)
    type: ciphertext.type(),
    
    // Base64-encoded encrypted payload
    body: toBase64(ciphertext.serialize()),
    
    // Timestamp for ordering and deduplication
    timestamp: Date.now()
  };
}

// ============================================================================
// MESSAGE DECRYPTION
// ============================================================================

/**
 * Decrypt a received message envelope.
 * 
 * This decrypts a Signal Protocol message. It handles both:
 * - PreKey messages (first message from a new sender)
 * - Whisper messages (subsequent messages in established session)
 * 
 * DECRYPTION PROCESS:
 * 
 * For PreKey messages:
 * 1. Decrypt using our one-time prekey
 * 2. Verify signatures
 * 3. Perform X3DH to establish session
 * 4. Decrypt message content
 * 5. Delete one-time prekey
 * 
 * For Whisper messages:
 * 1. Look up existing session
 * 2. Generate message key from Double Ratchet
 * 3. Decrypt and verify message
 * 4. Advance ratchet
 * 
 * @param state - Our SignalState
 * @param envelope - The received envelope
 * @returns Decrypted plaintext string
 * @throws Error if decryption fails (invalid message, tampered, etc.)
 */
export async function decryptMessage(state: SignalState, envelope: Envelope): Promise<string> {
  // Create sender's ProtocolAddress
  const address = ProtocolAddress.new(envelope.senderId, 1);
  
  // Decode base64 body to bytes
  const bytes = fromBase64(envelope.body);

  // Validate message type
  // Signal uses these types to distinguish initial vs subsequent messages
  if (envelope.type !== CiphertextMessageType.PreKey && 
      envelope.type !== CiphertextMessageType.Whisper) {
    throw new Error(`Unsupported ciphertext type: ${envelope.type}`);
  }

  // Decrypt based on message type
  const plaintextBuffer = envelope.type === CiphertextMessageType.PreKey
    ? // PREKEY MESSAGE: First message from sender
      // We need all the prekey stores to decrypt this
      await signalDecryptPreKey(
        // Deserialize the PreKeySignalMessage
        PreKeySignalMessage.deserialize(bytes),
        // Sender's address
        address,
        // Session store (will create new session)
        state.sessionStore,
        // Identity store (for verification)
        state.identityStore,
        // Prekey stores (to decrypt using our one-time prekey)
        state.preKeyStore,
        state.signedPreKeyStore,
        state.kyberPreKeyStore
      )
    : // WHISPER MESSAGE: Subsequent message in established session
      // Simpler decryption using existing session
      await signalDecrypt(
        // Deserialize the SignalMessage
        SignalMessage.deserialize(bytes),
        // Sender's address
        address,
        // Session store (must have existing session)
        state.sessionStore,
        // Identity store
        state.identityStore
      );

  // Decode UTF-8 bytes to string
  return new TextDecoder().decode(plaintextBuffer);
}

// ============================================================================
// ENVELOPE PARSING
// ============================================================================

/**
 * Parse and validate an envelope from unknown input.
 * 
 * This is a convenience wrapper around parseEnvelope from the shared package.
 * It validates that the input conforms to the Envelope schema.
 * 
 * @param input - Unknown data to parse (e.g., from JSON)
 * @returns Validated Envelope object
 * @throws Error if validation fails
 */
export function loadEnvelope(input: unknown): Envelope {
  return parseEnvelope(input);
}

// ============================================================================
// INBOX MANAGEMENT
// ============================================================================

/**
 * Key prefix for inbox messages in storage.
 * 
 * Inbox messages are stored with keys like:
 * - "inbox:1234567890:alice:abc123"
 * 
 * This allows listing all inbox entries with listKeysByPrefix("inbox:")
 */
const INBOX_PREFIX = "inbox:";

/**
 * Save a decrypted message to the inbox.
 * 
 * The inbox persists received messages for later retrieval.
 * Messages are stored encrypted in the database.
 * 
 * @param state - Our SignalState
 * @param message - The InboxMessage to save
 */
export function saveInboxMessage(state: SignalState, message: InboxMessage): void {
  state.store.set(`${INBOX_PREFIX}${message.id}`, message);
}

/**
 * List all inbox messages, sorted by timestamp.
 * 
 * Retrieves all messages from the inbox, sorts them chronologically,
 * and returns them as an array.
 * 
 * @param state - Our SignalState
 * @returns Array of InboxMessage objects, sorted by timestamp ascending
 */
export function listInboxMessages(state: SignalState): InboxMessage[] {
  // Find all keys starting with "inbox:"
  const keys = state.store.listKeysByPrefix(INBOX_PREFIX);
  
  // Load all messages
  const messages: InboxMessage[] = [];
  for (const key of keys) {
    const msg = state.store.get<InboxMessage>(key);
    if (msg) messages.push(msg);
  }
  
  // Sort by timestamp ascending (oldest first)
  messages.sort((a, b) => a.timestamp - b.timestamp);
  
  return messages;
}

// ============================================================================
// RE-EXPORTS
// ============================================================================

/**
 * Re-export store classes for external use.
 * 
 * These exports allow other modules to access the store implementations
 * if they need lower-level access.
 */
export {
  EncryptedStore,
  SqliteIdentityStore,
  SqliteSessionStore,
  SqlitePreKeyStore,
  SqliteSignedPreKeyStore,
  SqliteKyberPreKeyStore
};
