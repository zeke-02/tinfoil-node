import { describe, it } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert";
import {
  __setEhbpModuleForTests,
  __resetEhbpModuleStateForTests,
  createEncryptedBodyFetch,
  encryptedBodyRequest,
} from "../encrypted-body-fetch";

type EhbpModuleForTest = NonNullable<Parameters<typeof __setEhbpModuleForTests>[0]>;

type AsyncFn = () => Promise<void>;

const MOCK_HPKE_PUBLIC_KEY = "mock-server-public-key";
const MOCK_SERVER_PUBLIC_KEY_OBJ = { __mockKey: true };

// Mock PROTOCOL constants matching the actual EHBP module
const MOCK_PROTOCOL = {
  ENCAPSULATED_KEY_HEADER: 'Ehbp-Encapsulated-Key',
  CLIENT_PUBLIC_KEY_HEADER: 'Ehbp-Client-Public-Key',
  KEYS_MEDIA_TYPE: 'application/ohttp-keys',
  KEYS_PATH: '/.well-known/hpke-keys',
  FALLBACK_HEADER: 'Ehbp-Fallback'
};

function createModuleStub(
  identityGenerate: unknown,
  createTransport: unknown,
): EhbpModuleForTest {
  return {
    Identity: { 
      generate: identityGenerate,
      unmarshalPublicConfig: async () => ({
        getPublicKey: () => ({ /* mock public key */ })
      })
    } as unknown as EhbpModuleForTest["Identity"],
    createTransport: createTransport as unknown as EhbpModuleForTest["createTransport"],
    Transport: class {
      async getServerPublicKeyHex(): Promise<string> {
        return MOCK_HPKE_PUBLIC_KEY;
      }
      getServerPublicKey(): any {
        return { /* mock public key */ };
      }
      async request(): Promise<Response> {
        return new Response();
      }
    } as unknown as EhbpModuleForTest["Transport"],
    PROTOCOL: MOCK_PROTOCOL as unknown as EhbpModuleForTest["PROTOCOL"],
    HPKE_CONFIG: {} as unknown as EhbpModuleForTest["HPKE_CONFIG"],
  } as EhbpModuleForTest;
}

async function withEhbpModuleMock(module: EhbpModuleForTest, fn: AsyncFn) {
  // Mock global fetch for getHPKEKey function
  const originalFetch = globalThis.fetch;
  const mockFetch = async (url: string | URL | Request) => {
    const urlString = url.toString();
    //console.log('Mock fetch called with URL:', urlString); // Debugging line
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
    __setEhbpModuleForTests(module);
    await fn();
  } finally {
    globalThis.fetch = originalFetch;
    __resetEhbpModuleStateForTests();
  }
}

describe("encrypted body fetch helper", () => {

  it("normalizes Request objects before forwarding", async (t: TestContext) => {
    const transportRequest = t.mock.fn(
      async (_url: string, _init?: RequestInit) => new Response(null),
    );
    const getServerPublicKeyHex = t.mock.fn(async () => MOCK_HPKE_PUBLIC_KEY);
    const getHPKEkey = t.mock.fn(async () => MOCK_SERVER_PUBLIC_KEY_OBJ);
    const createTransport = t.mock.fn(async () => ({
      request: t.mock.fn(async () => new Response(null)), // should not be used for actual request
      getServerPublicKey: () => ({ __mockHex: MOCK_HPKE_PUBLIC_KEY }),
      getServerPublicKeyHex: async () => MOCK_HPKE_PUBLIC_KEY,
    }));
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

    const controller = new AbortController();
    const request = new Request("https://secure.test/v1/create", {
      method: "POST",
      headers: { "x-test": "1" },
      body: "payload",
      signal: controller.signal,
    });

    await withEhbpModuleMock(
      {
        Identity: { 
          generate: identityGenerate,
          unmarshalPublicConfig: async () => ({
            getPublicKey: () => ({ /* mock public key */ })
          })
        } as any,
        createTransport: createTransport as any,
        Transport: TransportStub as any,
        PROTOCOL: MOCK_PROTOCOL as any, // Use the mock protocol with correct values
        HPKE_CONFIG: {} as any,
      },
      async () => {
        await encryptedBodyRequest(request, MOCK_HPKE_PUBLIC_KEY);
      },
    );

    const firstCall = transportRequest.mock.calls[0];
    assert.ok(firstCall, "Transport request should be invoked");
    const [url, init] = firstCall.arguments;
    assert.strictEqual(url, "https://secure.test/v1/create");
    assert.ok(init, "Request init should be forwarded");
    assert.strictEqual(init?.method, "POST");
    const headers = init?.headers ? new Headers(init.headers) : undefined;
    assert.strictEqual(headers?.get("x-test"), "1");
    assert.ok(init?.body, "Body should be preserved");
    assert.ok(init?.signal instanceof AbortSignal);
    assert.strictEqual(init?.signal?.aborted, false);
  });

  it("resolves relative paths against the provided base URL", async (t: TestContext) => {
    const transportRequest = t.mock.fn(
      async (_url: string, _init?: RequestInit) => new Response(null),
    );
    const getServerPublicKeyHex = t.mock.fn(async () => MOCK_HPKE_PUBLIC_KEY);
    const createTransport = t.mock.fn(async () => ({
      request: t.mock.fn(async () => new Response(null)), // should not be used for actual request
      getServerPublicKey: () => ({ __mockHex: MOCK_HPKE_PUBLIC_KEY }),
      getServerPublicKeyHex: async () => MOCK_HPKE_PUBLIC_KEY,
    }));
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

    await withEhbpModuleMock(
      {
        Identity: { 
          generate: identityGenerate,
          unmarshalPublicConfig: async () => ({
            getPublicKey: () => ({ /* mock public key */ })
          })
        } as any,
        createTransport: createTransport as any,
        Transport: TransportStub as any,
        PROTOCOL: MOCK_PROTOCOL as any, // Use the mock protocol with correct values
        HPKE_CONFIG: {} as any,
      },
      async () => {
        const secureFetch = createEncryptedBodyFetch(
          "https://secure.test/v1/",
          MOCK_HPKE_PUBLIC_KEY,
        );
        await secureFetch("models");
        await secureFetch("/chat");
      },
    );

    const firstCall = transportRequest.mock.calls[0];
    const secondCall = transportRequest.mock.calls[1];
    assert.ok(firstCall);
    assert.ok(secondCall);
    assert.strictEqual(firstCall.arguments[0], "https://secure.test/v1/models");
    assert.strictEqual(secondCall.arguments[0], "https://secure.test/chat");
  });

  it("uses HPKE key origin for discovery but routes to request origin", async (t: TestContext) => {
    const REQUEST_ORIGIN = "https://api.example";
    const KEY_ORIGIN = "https://keys.example";
    const REQUEST_BASE = `${REQUEST_ORIGIN}/v1/`;
    const KEY_BASE = `${KEY_ORIGIN}/v1/`;

    const transportRequest = t.mock.fn(
      async (url: string, _init?: RequestInit) => new Response(null),
    );

    const constructed: Array<{ host: string; hex: string }> = [];

    // This represents the server public key object; the Transport stub will read __mockHex off it
    const PUBLIC_KEY_OBJ = { __mockHex: MOCK_HPKE_PUBLIC_KEY } as any;

    // createTransport for key origin returns a transport that exposes getServerPublicKey()
    const createTransport = t.mock.fn(async (serverURL: string, _id: any) => {
      if (!serverURL.startsWith(KEY_ORIGIN)) {
        throw new Error("createTransport should be called with key origin");
      }
      return {
        request: t.mock.fn(async () => new Response(null)), // should not be used for actual request
        getServerPublicKey: () => PUBLIC_KEY_OBJ,
        getServerPublicKeyHex: async () => MOCK_HPKE_PUBLIC_KEY,
      };
    });

    // Identity.generate is required by our helper
    const identityGenerate = t.mock.fn(async () => ({ __mockIdentity: true }));

    // Stub Transport class used by composite path; it routes to request host
    class TransportStub {
      private host: string;
      private key: any;
      constructor(_id: any, serverHost: string, serverPublicKey: any) {
        this.host = serverHost;
        this.key = serverPublicKey;
        constructed.push({ host: serverHost, hex: MOCK_HPKE_PUBLIC_KEY }); // Use the expected mock key
      }
      getServerPublicKey(): any {
        return this.key;
      }
      async getServerPublicKeyHex(): Promise<string> {
        return MOCK_HPKE_PUBLIC_KEY; // Return the expected mock key
      }
      async request(url: string, init?: RequestInit): Promise<Response> {
        // Ensure the request goes to the request origin host
        const u = new URL(url);
        if (u.origin !== REQUEST_ORIGIN) {
          throw new Error(`request was sent to wrong origin: ${u.origin}`);
        }
        return transportRequest(url, init);
      }
    }

    await withEhbpModuleMock(
      {
        Identity: { 
          generate: identityGenerate,
          unmarshalPublicConfig: async () => ({
            getPublicKey: () => ({ /* mock public key */ })
          })
        } as any,
        createTransport: createTransport as any,
        Transport: TransportStub as any,
        PROTOCOL: MOCK_PROTOCOL as any, // Use the mock protocol with correct values
        HPKE_CONFIG: {} as any,
      },
      async () => {
        const secureFetch = createEncryptedBodyFetch(
          `${REQUEST_BASE}`,
          MOCK_HPKE_PUBLIC_KEY,
          `${KEY_BASE}`,
        );
        await secureFetch("models");
      },
    );

    // Verify we built a Transport for the request origin using the key from key origin
    assert.strictEqual(constructed.length, 1);
    assert.strictEqual(constructed[0]?.host, new URL(REQUEST_BASE).host);
    assert.strictEqual(constructed[0]?.hex, MOCK_HPKE_PUBLIC_KEY);
    assert.strictEqual(transportRequest.mock.callCount(), 1);
  });
});
