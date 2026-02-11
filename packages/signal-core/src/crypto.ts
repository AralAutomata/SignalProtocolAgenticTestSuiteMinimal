/**
 * ============================================================================
 * CRYPTOGRAPHIC UTILITIES MODULE
 * ============================================================================
 * 
 * This module provides the cryptographic foundation for the Signal Protocol
 * implementation. It handles:
 * 
 * 1. Key Derivation (scrypt) - Converting passphrases to encryption keys
 * 2. Symmetric Encryption (AES-256-GCM) - Encrypting data at rest
 * 3. Serialization - Converting binary data to/from JSON-safe formats
 * 4. Utility functions - Base64 encoding, constant-time comparison
 * 
 * SECURITY CONSIDERATIONS:
 * - scrypt parameters are chosen to be memory-hard (N=16384 = 16MB memory usage)
 * - AES-256-GCM provides authenticated encryption (confidentiality + integrity)
 * - IVs are randomly generated for each encryption operation
 * - Constant-time comparison prevents timing attacks
 * 
 * ============================================================================
 */

// Import Node.js built-in crypto module for cryptographic operations
// This is the standard, audited cryptography library for Node.js
import crypto from "node:crypto";

// Import Buffer utilities for handling binary data in Node.js
// Buffer provides a way to work with raw binary data in JavaScript
import { Buffer } from "node:buffer";

// ============================================================================
// CONSTANTS FOR AES-256-GCM ENCRYPTION
// ============================================================================

/**
 * IV (Initialization Vector) length in bytes for AES-GCM mode.
 * 
 * AES-GCM requires a 96-bit (12 byte) IV for optimal security.
 * The IV doesn't need to be secret, but it MUST be unique for each encryption
 * with the same key. Reusing an IV with the same key completely breaks security.
 * 
 * We generate a random IV for each encryption operation.
 */
const IV_LENGTH = 12;

/**
 * Authentication tag length in bytes for AES-GCM.
 * 
 * GCM mode produces an authentication tag that ensures integrity.
 * The tag is 128 bits (16 bytes) and is appended to the ciphertext.
 * During decryption, this tag is verified - if verification fails, it means
 * the ciphertext was tampered with and decryption will throw an error.
 */
const TAG_LENGTH = 16;

// ============================================================================
// KEY DERIVATION FUNCTION (KDF) PARAMETERS
// ============================================================================

/**
 * Type definition for scrypt key derivation parameters.
 * 
 * scrypt is a memory-hard password-based key derivation function designed to be
 * resistant to hardware brute-force attacks (ASICs, GPUs). It was created by
 * Colin Percival and is the recommended KDF for password hashing.
 * 
 * The parameters control the computational cost:
 * - salt: Random value that ensures identical passwords produce different keys
 * - n: CPU/memory cost parameter (must be a power of 2)
 * - r: Block size parameter (affects memory access pattern)
 * - p: Parallelization parameter (number of parallel threads)
 * - keyLen: Desired output key length in bytes
 * 
 * Higher n, r, p values = more secure but slower
 */
export type KdfParams = {
  /** Base64-encoded random salt (16 bytes = 128 bits recommended) */
  salt: string;
  /** CPU/memory cost parameter. N=16384 means 2^14 iterations */
  n: number;
  /** Block size parameter. Larger values increase memory usage */
  r: number;
  /** Parallelization parameter. Higher values enable more parallelism */
  p: number;
  /** Desired key length in bytes. 32 bytes = 256 bits for AES-256 */
  keyLen: number;
};

/**
 * Factory function to create new KDF parameters.
 * 
 * This generates a fresh random salt and returns recommended scrypt parameters.
 * These parameters are chosen to balance security and performance:
 * 
 * - N=16384 (2^14): Uses 16MB of memory (r=8 * N=16384 * 128 bytes = 16MB)
 * - r=8: Standard block size
 * - p=1: Single-threaded (increase for more parallelism)
 * - keyLen=32: 256-bit key for AES-256 encryption
 * 
 * Memory calculation: Memory = r * N * 128 bytes
 * With r=8, N=16384: 8 * 16384 * 128 = 16,777,216 bytes = 16MB
 * 
 * @returns A new KdfParams object with random salt
 */
export function createKdfParams(): KdfParams {
  return {
    // Generate 16 random bytes (128 bits) for the salt
    // randomBytes is cryptographically secure (uses OS entropy source)
    // toString("base64") encodes binary as ASCII-safe string for storage
    salt: crypto.randomBytes(16).toString("base64"),
    
    // scrypt N parameter: must be power of 2, higher = more secure/slower
    // 16384 is a good balance for modern hardware (~100ms on typical CPU)
    n: 16384,
    
    // scrypt r parameter: block size, affects memory access pattern
    // r=8 is the standard recommendation
    r: 8,
    
    // scrypt p parameter: parallelization factor
    // p=1 means single-threaded, increase for more parallelism
    p: 1,
    
    // Output key length: 32 bytes = 256 bits
    // This matches AES-256 key requirements
    keyLen: 32
  };
}

/**
 * Derive an encryption key from a passphrase using scrypt.
 * 
 * scrypt is designed to be memory-hard, meaning it requires significant memory
 * to compute. This makes hardware brute-force attacks (ASICs, GPUs) much more
 * expensive compared to CPU-friendly algorithms like PBKDF2.
 * 
 * The same passphrase + salt will ALWAYS produce the same key, which is why
 * the salt must be unique and stored alongside the encrypted data.
 * 
 * @param passphrase - The user's password/passphrase
 * @param params - KDF parameters including salt and cost factors
 * @returns A Buffer containing the derived 32-byte (256-bit) key
 */
export function deriveKey(passphrase: string, params: KdfParams): Buffer {
  // Decode the base64-encoded salt back to a binary Buffer
  // The salt was base64-encoded for JSON storage, now we need raw bytes
  const salt = Buffer.from(params.salt, "base64");
  
  // Use scryptSync for synchronous key derivation
  // Parameters:
   {/* - passphrase: User's password (string converted to UTF-8 bytes) */}
   {/* - salt: Random bytes to prevent rainbow table attacks */}
   {/* - keyLen: Desired output length (32 bytes for AES-256) */}
   {/* - N, r, p: Computational cost parameters from params object */}
  return crypto.scryptSync(passphrase, salt, params.keyLen, {
    N: params.n,
    r: params.r,
    p: params.p
  });
}

// ============================================================================
// AES-256-GCM ENCRYPTION/DECRYPTION
// ============================================================================

/**
 * Encrypt binary data using AES-256-GCM.
 * 
 * AES-256-GCM (Galois/Counter Mode) provides:
 * - Confidentiality: Data is encrypted and unreadable without the key
 * - Authenticity: Authentication tag ensures data hasn't been tampered with
 * - Integrity: Any modification to ciphertext is detected during decryption
 * 
 * The encryption process:
 * 1. Generate random 12-byte IV
 * 2. Create AES-256-GCM cipher with key and IV
 * 3. Encrypt plaintext
 * 4. Get authentication tag
 * 5. Concatenate: IV (12 bytes) + Tag (16 bytes) + Ciphertext (variable)
 * 
 * Output format: [IV: 12 bytes][Auth Tag: 16 bytes][Ciphertext: N bytes]
 * Total overhead: 28 bytes per encryption
 * 
 * @param key - 32-byte (256-bit) encryption key from deriveKey()
 * @param plaintext - The data to encrypt as a Buffer
 * @returns Buffer containing IV + auth tag + ciphertext
 */
export function encryptBuffer(key: Buffer, plaintext: Buffer): Buffer {
  // Step 1: Generate a random 12-byte IV
  // IV must be unique for each encryption with the same key
  // randomBytes provides cryptographically secure randomness
  const iv = crypto.randomBytes(IV_LENGTH);
  
  // Step 2: Create AES-256-GCM cipher instance
  // "aes-256-gcm" specifies:
  // - AES algorithm
  // - 256-bit key (32 bytes)
  // - GCM mode (provides both encryption and authentication)
  // Parameters: algorithm, key, initialization vector
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  
  // Step 3: Encrypt the plaintext
  // cipher.update() processes the data and returns encrypted chunks
  // cipher.final() finalizes encryption and returns any remaining data
  // Buffer.concat combines all chunks into a single Buffer
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  
  // Step 4: Get the authentication tag
  // GCM generates a 16-byte authentication tag during encryption
  // This tag will be verified during decryption to detect tampering
  const tag = cipher.getAuthTag();
  
  // Step 5: Combine IV + tag + ciphertext into final format
  // This format allows us to extract components during decryption
  // Order matters: IV comes first (needed to initialize decipher),
  // then tag (needed for verification), then actual ciphertext
  return Buffer.concat([iv, tag, ciphertext]);
}

/**
 * Decrypt and verify data encrypted with encryptBuffer().
 * 
 * The decryption process:
 * 1. Extract IV (first 12 bytes), tag (next 16 bytes), and ciphertext
 * 2. Create AES-256-GCM decipher with key and IV
 * 3. Set the expected authentication tag
 * 4. Decrypt ciphertext
 * 5. Finalize (verifies auth tag - throws if tampered)
 * 
 * SECURITY: If the ciphertext was modified, setAuthTag() or final() will throw
 * an error indicating authentication failure. This prevents decryption of
 * tampered data.
 * 
 * @param key - 32-byte (256-bit) encryption key (must match encryption key)
 * @param payload - Buffer containing IV + auth tag + ciphertext
 * @returns Buffer containing the decrypted plaintext
 * @throws Error if authentication fails (data was tampered with)
 */
export function decryptBuffer(key: Buffer, payload: Buffer): Buffer {
  // Step 1: Extract components from payload
  // 
  // Payload structure: [IV: 12 bytes][Auth Tag: 16 bytes][Ciphertext: remaining]
  // 
  // subarray() creates a view (not a copy) into the original buffer
  // This is more memory-efficient than slice()
  
  // Extract IV: bytes 0-11 (12 bytes total)
  const iv = payload.subarray(0, IV_LENGTH);
  
  // Extract authentication tag: bytes 12-27 (16 bytes total)
  const tag = payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  
  // Extract ciphertext: everything after byte 27
  const ciphertext = payload.subarray(IV_LENGTH + TAG_LENGTH);
  
  // Step 2: Create decipher instance
  // Same algorithm as encryption: AES-256-GCM
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  
  // Step 3: Set the expected authentication tag
  // During decryption, GCM will compute what the tag should be
  // and compare it to this expected value
  // If they don't match, final() will throw an authentication error
  decipher.setAuthTag(tag);
  
  // Step 4 & 5: Decrypt and verify
  // decipher.update() decrypts the ciphertext
  // decipher.final() finalizes and verifies the authentication tag
  // If verification fails, an error is thrown
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ============================================================================
// JSON SERIALIZATION WITH BINARY DATA SUPPORT
// ============================================================================

/**
 * Serialize any JavaScript value to JSON, with special handling for ArrayBuffers.
 * 
 * PROBLEM: JSON.stringify() doesn't natively support binary data types like
 * ArrayBuffer, Uint8Array, etc. It treats them as empty objects {}.
 * 
 * SOLUTION: We use a custom replacer function that detects binary data and
 * converts it to a special object format that we can recognize during parsing.
 * 
 * The special format is: { "__type": "ab", "data": "<base64-encoded bytes>" }
 * 
 * This allows us to store binary cryptographic keys and data in JSON format
 * while preserving the ability to reconstruct the original binary types.
 * 
 * @param value - Any JavaScript value to serialize
 * @returns JSON string with binary data encoded as base64
 */
export function encodeValue(value: unknown): string {
  // JSON.stringify takes an optional replacer function
  // This function is called for each property being stringified
  return JSON.stringify(value, (_key, val) => {
    // Check if value is a raw ArrayBuffer (not a view like Uint8Array)
    if (val instanceof ArrayBuffer) {
      // Convert ArrayBuffer to Buffer, then to base64 string
      // The __type marker lets us identify this as binary data during parsing
      return {
        __type: "ab",  // "ab" = ArrayBuffer type marker
        data: Buffer.from(val).toString("base64")
      };
    }
    
    // Check if value is a TypedArray view (Uint8Array, Uint16Array, etc.)
    // ArrayBuffer.isView returns true for all TypedArray types and DataView
    if (ArrayBuffer.isView(val)) {
      // Extract the underlying ArrayBuffer slice
      // val.buffer may be larger than the view, so we use byteOffset and byteLength
      // to get exactly the bytes that belong to this view
      const buf = Buffer.from(val.buffer, val.byteOffset, val.byteLength);
      return {
        __type: "ab",
        data: buf.toString("base64")
      };
    }
    
    // For all other values, return as-is for default JSON serialization
    return val;
  });
}

/**
 * Deserialize JSON string, restoring ArrayBuffers from special format.
 * 
 * This is the inverse of encodeValue(). It parses JSON and uses a reviver
 * function to convert our special { __type: "ab", data: "..." } objects
 * back into Uint8Array instances.
 * 
 * Note: We restore as Uint8Array rather than ArrayBuffer because:
 * 1. Uint8Array is more useful (provides array-like interface)
 * 2. We can't directly create an ArrayBuffer from base64 without a view
 * 
 * @param text - JSON string previously created by encodeValue()
 * @returns The original JavaScript value with binary data restored
 */
export function decodeValue(text: string): unknown {
  // JSON.parse takes an optional reviver function
  // This is called for each property being parsed
  return JSON.parse(text, (_key, val) => {
    // Check if this value is our special binary data marker
    if (val && typeof val === "object" && val.__type === "ab") {
      // Decode base64 data back to bytes
      const buf = Buffer.from(val.data, "base64");
      // Return as Uint8Array (most useful typed array for raw bytes)
      return new Uint8Array(buf);
    }
    
    // Return all other values as-is
    return val;
  });
}

// ============================================================================
// CONVENIENCE FUNCTIONS FOR JSON ENCRYPTION
// ============================================================================

/**
 * Encrypt any JSON-serializable value.
 * 
 * This combines encodeValue() and encryptBuffer() for convenient encryption
 * of JavaScript objects. Binary data within the object is automatically
 * handled by encodeValue().
 * 
 * Use case: Encrypting Signal protocol key objects that contain binary data
 * 
 * @param key - 32-byte encryption key
 * @param value - Any JSON-serializable value
 * @returns Encrypted Buffer containing the serialized value
 */
export function encryptJson(key: Buffer, value: unknown): Buffer {
  // First serialize to JSON string with binary handling
  const encoded = encodeValue(value);
  // Convert string to Buffer (UTF-8 encoding)
  const plaintext = Buffer.from(encoded, "utf8");
  // Encrypt the buffer
  return encryptBuffer(key, plaintext);
}

/**
 * Decrypt buffer to JSON value.
 * 
 * This is the inverse of encryptJson(). It decrypts the buffer and then
 * parses the resulting JSON, restoring any binary data that was encoded.
 * 
 * @param key - 32-byte encryption key (must match encryption key)
 * @param payload - Encrypted buffer from encryptJson()
 * @returns The original JavaScript value
 */
export function decryptJson(key: Buffer, payload: Buffer): unknown {
  // Decrypt to get JSON string
  const decoded = decryptBuffer(key, payload).toString("utf8");
  // Parse JSON with binary data restoration
  return decodeValue(decoded);
}

// ============================================================================
// SECURITY UTILITY FUNCTIONS
// ============================================================================

/**
 * Constant-time comparison of ArrayBuffers.
 * 
 * SECURITY CRITICAL: Normal comparison operators (===, !==) short-circuit,
 * meaning they return as soon as they find a difference. This creates a
 * timing side-channel that can leak information about the data being compared.
 * 
 * Example attack: An attacker can measure comparison time to determine
 * how many bytes at the start of their guess are correct, reducing the
 * search space dramatically.
 * 
 * timingSafeEqual compares ALL bytes regardless of differences, ensuring
 * the comparison takes the same amount of time regardless of where (or if)
 * differences occur.
 * 
 * @param a - First ArrayBuffer to compare
 * @param b - Second ArrayBuffer to compare
 * @returns true if buffers are identical, false otherwise
 */
export function buffersEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  // Convert ArrayBuffers to Buffer objects for comparison
  // Buffer.from creates a view (not a copy) for ArrayBuffer
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  
  // First check lengths - timingSafeEqual requires equal-length buffers
  // This check itself isn't constant-time, but length differences are
  // typically not considered sensitive information
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  
  // Use crypto.timingSafeEqual for constant-time comparison
  // This function always compares all bytes and takes constant time
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Convert ArrayBuffer or Uint8Array to base64 string.
 * 
 * Base64 encoding represents binary data using ASCII characters.
 * This is useful for:
 * - Including binary data in JSON
 * - Transmitting binary data over text protocols (HTTP, WebSocket)
 * - Storing binary data in text fields (databases, localStorage)
 * 
 * The encoded string is approximately 33% larger than the original binary data.
 * 
 * @param input - ArrayBuffer or Uint8Array containing binary data
 * @returns Base64-encoded string
 */
export function toBase64(input: ArrayBuffer | Uint8Array): string {
  // Normalize input to Uint8Array for consistent handling
  // If input is already Uint8Array, use it directly
  // If input is ArrayBuffer, create a Uint8Array view of it
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  
  // Convert to Node.js Buffer and encode as base64
  return Buffer.from(bytes).toString("base64");
}

/**
 * Convert base64 string to Uint8Array.
 * 
 * This is the inverse of toBase64(). It decodes a base64 string back to
 * binary data as a Uint8Array.
 * 
 * @param input - Base64-encoded string
 * @returns Uint8Array containing the decoded binary data
 */
export function fromBase64(input: string): Uint8Array {
  // Decode base64 string to Buffer
  const buf = Buffer.from(input, "base64");
  // Convert Buffer to Uint8Array
  // The Uint8Array constructor creates a view of the Buffer's underlying ArrayBuffer
  return new Uint8Array(buf);
}
