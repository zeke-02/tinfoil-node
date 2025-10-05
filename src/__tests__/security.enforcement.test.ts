import { describe, it } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert";
import { withMockedModules } from "./test-utils";
import {
  __resetEhbpModuleStateForTests,
  __setEhbpModuleForTests,
  encryptedBodyRequest,
  createEncryptedBodyFetch,
} from "../encrypted-body-fetch";

const MOCK_FP = "a3b1c5d7e9f0a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f506172839a";
const MOCK_MEASUREMENT_TYPE = "https://tinfoil.sh/predicate/sev-snp-guest/v1";
const MOCK_HPKE_PUBLIC_KEY = "hpke-key";

// Mock PROTOCOL constants matching the actual EHBP module
const MOCK_PROTOCOL = {
  ENCAPSULATED_KEY_HEADER: 'Ehbp-Encapsulated-Key',
  CLIENT_PUBLIC_KEY_HEADER: 'Ehbp-Client-Public-Key',
  KEYS_MEDIA_TYPE: 'application/ohttp-keys',
  KEYS_PATH: '/.well-known/hpke-keys',
  FALLBACK_HEADER: 'Ehbp-Fallback'
};

describe("Security enforcement", () => {
  const mockEhbpModule = (
    transportRequest: (url: string, init?: RequestInit) => Promise<Response>,
    identityGenerate: () => Promise<unknown>,
  ) => ({
    Identity: { 
      generate: identityGenerate,
      unmarshalPublicConfig: async () => ({
        getPublicKey: () => ({ /* mock public key */ })
      })
    } as any,
    createTransport: async () => ({
      request: async () => new Response(null),
      getServerPublicKey: () => ({ __mockHex: MOCK_HPKE_PUBLIC_KEY }),
      getServerPublicKeyHex: async () => MOCK_HPKE_PUBLIC_KEY,
    }),
    Transport: class {
      async getServerPublicKeyHex(): Promise<string> {
        return MOCK_HPKE_PUBLIC_KEY;
      }
      async request(): Promise<Response> {
        return new Response();
      }
    } as any,
    PROTOCOL: MOCK_PROTOCOL,
    HPKE_CONFIG: {},
  });

  const withEhbpMock = async (
    stub: ReturnType<typeof mockEhbpModule>,
    run: () => Promise<void>,
  ) => {
    // Mock global fetch for getHPKEKey function
    const originalFetch = globalThis.fetch;
    const mockFetch = async (url: string | URL | Request) => {
      const urlString = url.toString();
      if (urlString.includes(MOCK_PROTOCOL.KEYS_PATH)) {
        // Mock the keys endpoint response with correct content type
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { 'content-type': MOCK_PROTOCOL.KEYS_MEDIA_TYPE }
        });
      }
      // For other requests, return a generic response
      return new Response('OK', { status: 200 });
    };
    
    try {
      globalThis.fetch = mockFetch as typeof globalThis.fetch;
      __setEhbpModuleForTests(stub as any);
      await run();
    } finally {
      globalThis.fetch = originalFetch;
      __resetEhbpModuleStateForTests();
    }
  };

  it("EHBP helpers allow HTTP origins while keeping HPKE enforcement", async (t: TestContext) => {
    const transportRequest = t.mock.fn(
      async (_url: string, _init?: RequestInit) => new Response("ok"),
    );
    const identityGenerate = t.mock.fn(async () => ({ __mockIdentity: true }));

    // Stub Transport class used by composite path; it routes to request host
    class TransportStub {
      private key: any;
      constructor(_id: any, _serverHost: string, serverPublicKey: any) {
        this.key = serverPublicKey;
      }
      getServerPublicKey(): any {
        return this.key;
      }
      async getServerPublicKeyHex(): Promise<string> {
        return MOCK_HPKE_PUBLIC_KEY; // Return the expected mock key
      }
      async request(url: string, init?: RequestInit): Promise<Response> {
        return transportRequest(url, init);
      }
    }

    await withEhbpMock(
      {
        Identity: { 
          generate: identityGenerate,
          unmarshalPublicConfig: async () => ({
            getPublicKey: () => ({ /* mock public key */ })
          })
        } as any,
        createTransport: mockEhbpModule(transportRequest, identityGenerate).createTransport,
        Transport: TransportStub as any,
        PROTOCOL: MOCK_PROTOCOL as any,
        HPKE_CONFIG: {} as any,
      },
      async () => {
        await encryptedBodyRequest("http://localhost:8080/v1/models", MOCK_HPKE_PUBLIC_KEY);

        const fetchThroughProxy = createEncryptedBodyFetch(
          "http://localhost:8080/v1/",
          MOCK_HPKE_PUBLIC_KEY,
        );
        await fetchThroughProxy("models");
      },
    );

    assert.strictEqual(identityGenerate.mock.callCount(), 1);
    assert.strictEqual(transportRequest.mock.callCount(), 2);
  });

  it("TinfoilAI TLS fallback uses pinned fetch that rejects HTTP", async (t: TestContext) => {
    const verifyMock = t.mock.fn(async () => ({
      tlsPublicKeyFingerprint: MOCK_FP,
      // No HPKE key triggers TLS fallback
      measurement: { type: MOCK_MEASUREMENT_TYPE, registers: [] },
    }));

    let capturedFetch: typeof fetch | undefined;
    const openAIConstructorMock = t.mock.fn(function (this: unknown, options: { fetch?: typeof fetch }) {
      capturedFetch = options.fetch;
      return { options } as any;
    });

    await withMockedModules(
      {
        "./verifier": {
          Verifier: class {
            verify() {
              return verifyMock();
            }
            getVerificationDocument() {
              return {
                repo: "owner/repo",
                configRepo: "owner/repo",
                enclaveHost: "insecure.test",
                releaseDigest: "deadbeef",
                codeMeasurement: { type: MOCK_MEASUREMENT_TYPE, registers: [] },
                enclaveMeasurement: {
                  tlsPublicKeyFingerprint: MOCK_FP,
                  measurement: { type: MOCK_MEASUREMENT_TYPE, registers: [] },
                },
                match: true,
              };
            }
          },
        },
        openai: Object.assign(openAIConstructorMock, { OpenAI: openAIConstructorMock }),
      },
      ["../client"],
      async () => {
        const { TinfoilAI } = await import("../tinfoilai");
        const client = new TinfoilAI({ apiKey: "key", baseURL: "https://secure.test/v1/" });
        await client.ready();
        assert.ok(capturedFetch, "Pinned TLS fetch should be provided in fallback");
        await assert.rejects(
          capturedFetch!("http://insecure.test/v1/models"),
          /HTTP connections are not allowed/i,
        );
      },
    );
  });

  it("AI SDK provider TLS fallback uses pinned fetch that rejects HTTP", async (t: TestContext) => {
    const verifyMock = t.mock.fn(async () => ({
      tlsPublicKeyFingerprint: MOCK_FP,
      measurement: { type: MOCK_MEASUREMENT_TYPE, registers: [] },
    }));

    let capturedFetch: typeof fetch | undefined;
    const createOpenAICompatibleMock = t.mock.fn((options: { fetch: typeof fetch }) => {
      capturedFetch = options.fetch;
      return { __mockProvider: true } as any;
    });

    await withMockedModules(
      {
        "./verifier": {
          Verifier: class {
            verify() {
              return verifyMock();
            }
            getVerificationDocument() {
              return {
                repo: "owner/repo",
                configRepo: "owner/repo",
                enclaveHost: "secure.test",
                releaseDigest: "deadbeef",
                codeMeasurement: { type: MOCK_MEASUREMENT_TYPE, registers: [] },
                enclaveMeasurement: {
                  tlsPublicKeyFingerprint: MOCK_FP,
                  measurement: { type: MOCK_MEASUREMENT_TYPE, registers: [] },
                },
                match: true,
              };
            }
          },
        },
        "@ai-sdk/openai-compatible": {
          createOpenAICompatible: createOpenAICompatibleMock,
        },
      },
      ["../ai-sdk-provider"],
      async () => {
        const { createTinfoilAI } = await import("../ai-sdk-provider");
        await createTinfoilAI("key", { baseURL: "https://secure.test/v1/" });
        assert.ok(capturedFetch, "Pinned TLS fetch should be provided in fallback provider");
        await assert.rejects(
          capturedFetch!("http://insecure.test/v1/models"),
          /HTTP connections are not allowed/i,
        );
      },
    );
  });
});
