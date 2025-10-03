import { describe, it } from "node:test";
import assert from "node:assert";
import { withMockedModules } from "./test-utils";

const MOCK_MEASUREMENT_TYPE = "https://tinfoil.sh/predicate/sev-snp-guest/v1";

describe("SecureClient (browser)", () => {
  it("should create a client and initialize securely in browser environment", async (t) => {
    const verifyMock = t.mock.fn(async () => ({
      tlsPublicKeyFingerprint: undefined,
      hpkePublicKey: "mock-hpke-public-key",
      measurement: { type: MOCK_MEASUREMENT_TYPE, registers: [] },
    }));
    
    const mockFetch = t.mock.fn(async () => new Response(JSON.stringify({ message: "success" })));
    const createEncryptedBodyFetchMock = t.mock.fn(
      (_baseURL: string, _hpkePublicKey: string, _enclaveURL?: string) => mockFetch,
    );

    await withMockedModules(
      {
        "./verifier": {
          Verifier: class {
            verify() {
              return verifyMock();
            }
            getVerificationDocument() {
              return {
                configRepo: "test-repo",
                enclaveHost: "test-host",
                releaseDigest: "test-digest",
                codeMeasurement: { type: MOCK_MEASUREMENT_TYPE, registers: [] },
                enclaveMeasurement: {
                  hpkePublicKey: "mock-hpke-public-key",
                  measurement: { type: MOCK_MEASUREMENT_TYPE, registers: [] },
                },
                match: true,
              };
            }
          },
        },
        "./encrypted-body-fetch": { createEncryptedBodyFetch: createEncryptedBodyFetchMock },
        "./env": { isRealBrowser: () => true },
      },
      ["../secure-client.browser"],
      async () => {
        const { SecureClient } = await import("../secure-client.browser");
        
        const client = new SecureClient({
          baseURL: "https://test.example.com/",
          enclaveURL: "https://keys.test.example.com/",
          configRepo: "test-org/test-repo",
        });

        await client.ready();
        
        assert.strictEqual(verifyMock.mock.callCount(), 1, "verify should be called once");
        assert.strictEqual(createEncryptedBodyFetchMock.mock.callCount(), 1, "createEncryptedBodyFetch should be called once");
        assert.deepStrictEqual(createEncryptedBodyFetchMock.mock.calls[0]?.arguments, [
          "https://test.example.com/",
          "mock-hpke-public-key",
          "https://keys.test.example.com/",
        ]);
      },
    );
  });

  it("should reject initialization when HPKE is not available in browser", async (t) => {
    const verifyMock = t.mock.fn(async () => ({
      tlsPublicKeyFingerprint: "mock-tls-fingerprint",
      hpkePublicKey: undefined, // No HPKE key available
      measurement: { type: MOCK_MEASUREMENT_TYPE, registers: [] },
    }));

    await withMockedModules(
      {
        "./verifier": {
          Verifier: class {
            verify() {
              return verifyMock();
            }
            getVerificationDocument() {
              return {
                configRepo: "test-repo",
                enclaveHost: "test-host",
                releaseDigest: "test-digest",
                codeMeasurement: { type: MOCK_MEASUREMENT_TYPE, registers: [] },
                enclaveMeasurement: {
                  hpkePublicKey: undefined,
                  tlsPublicKeyFingerprint: "mock-tls-fingerprint",
                  measurement: { type: MOCK_MEASUREMENT_TYPE, registers: [] },
                },
                match: true,
              };
            }
          },
        },
        "./env": { isRealBrowser: () => true },
      },
      ["../secure-client.browser"],
      async () => {
        const { SecureClient } = await import("../secure-client.browser");
        
        const client = new SecureClient({
          baseURL: "https://test.example.com/",
        });

        await assert.rejects(
          async () => await client.ready(),
          /HPKE public key not available and TLS-only verification is not supported in browsers/,
          "Should reject with appropriate error message"
        );
        
        assert.strictEqual(verifyMock.mock.callCount(), 1, "verify should be called once");
      },
    );
  });

  it("should provide a fetch function that works correctly in browser", async (t) => {
    const verifyMock = t.mock.fn(async () => ({
      tlsPublicKeyFingerprint: undefined,
      hpkePublicKey: "mock-hpke-public-key",
      measurement: { type: MOCK_MEASUREMENT_TYPE, registers: [] },
    }));
    
    const mockResponseBody = { test: "browser response" };
    const mockFetch = t.mock.fn(async () => new Response(JSON.stringify(mockResponseBody)));
    const createEncryptedBodyFetchMock = t.mock.fn(
      (_baseURL: string, _hpkePublicKey: string, _enclaveURL?: string) => mockFetch,
    );

    await withMockedModules(
      {
        "./verifier": {
          Verifier: class {
            verify() {
              return verifyMock();
            }
            getVerificationDocument() {
              return {
                configRepo: "test-repo",
                enclaveHost: "test-host",
                releaseDigest: "test-digest",
                codeMeasurement: { type: MOCK_MEASUREMENT_TYPE, registers: [] },
                enclaveMeasurement: {
                  hpkePublicKey: "mock-hpke-public-key",
                  measurement: { type: MOCK_MEASUREMENT_TYPE, registers: [] },
                },
                match: true,
              };
            }
          },
        },
        "./encrypted-body-fetch": { createEncryptedBodyFetch: createEncryptedBodyFetchMock },
        "./env": { isRealBrowser: () => true },
      },
      ["../secure-client.browser"],
      async () => {
        const { SecureClient } = await import("../secure-client.browser");
        
        const client = new SecureClient({
          baseURL: "https://test.example.com/",
        });

        const response = await client.fetch("/test-browser-endpoint", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ test: "browser data" }),
        });
        
        const responseBody = await response.json();
        
        assert.strictEqual(verifyMock.mock.callCount(), 1, "verify should be called once");
        assert.strictEqual(mockFetch.mock.callCount(), 1, "mockFetch should be called once");
        assert.deepStrictEqual(responseBody, mockResponseBody, "Response body should match");
      },
    );
  });
});