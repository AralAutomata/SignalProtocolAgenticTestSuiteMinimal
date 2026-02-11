import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createKdfParams, decryptJson, deriveKey, encryptJson } from "../src/crypto";

describe("crypto", () => {
  it("encrypt/decrypt roundtrip", () => {
    const params = createKdfParams();
    const key = deriveKey("passphrase", params);
    const payload = { hello: "world", count: 42 };
    const encrypted = encryptJson(key, payload);
    const decrypted = decryptJson(key, encrypted);
    assert.deepEqual(decrypted, payload);
  });
});
