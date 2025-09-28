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

function createModuleStub(
  identityGenerate: unknown,
  createTransport: unknown,
): EhbpModuleForTest {
  return {
    Identity: { generate: identityGenerate } as unknown as EhbpModuleForTest["Identity"],
    createTransport: createTransport as unknown as EhbpModuleForTest["createTransport"],
    Transport: class {} as unknown as EhbpModuleForTest["Transport"],
    PROTOCOL: {} as unknown as EhbpModuleForTest["PROTOCOL"],
    HPKE_CONFIG: {} as unknown as EhbpModuleForTest["HPKE_CONFIG"],
  } as EhbpModuleForTest;
}

async function withEhbpModuleMock(module: EhbpModuleForTest, fn: AsyncFn) {
  try {
    __setEhbpModuleForTests(module);
    await fn();
  } finally {
    __resetEhbpModuleStateForTests();
  }
}

describe("encrypted body fetch helper", () => {
  it("reuses cached transports for repeated origins", async (t: TestContext) => {
    const transportRequest = t.mock.fn(
      async (_url: string, _init?: RequestInit) => new Response(null),
    );
    const getServerPublicKeyHex = t.mock.fn(async () => MOCK_HPKE_PUBLIC_KEY);
    const createTransport = t.mock.fn(async () => ({
      request: transportRequest,
      getServerPublicKeyHex,
    }));
    const identityGenerate = t.mock.fn(async () => ({ __mockIdentity: true }));

    await withEhbpModuleMock(
      createModuleStub(identityGenerate, createTransport),
      async () => {
        await encryptedBodyRequest(
          "https://secure.test/v1/models",
          MOCK_HPKE_PUBLIC_KEY,
        );
        await encryptedBodyRequest("https://secure.test/v1/chat", MOCK_HPKE_PUBLIC_KEY);
      },
    );

    assert.strictEqual(identityGenerate.mock.callCount(), 1);
    assert.strictEqual(createTransport.mock.callCount(), 1);
    assert.strictEqual(transportRequest.mock.callCount(), 2);
    assert.strictEqual(getServerPublicKeyHex.mock.callCount(), 2);
  });

  it("normalizes Request objects before forwarding", async (t: TestContext) => {
    const transportRequest = t.mock.fn(
      async (_url: string, _init?: RequestInit) => new Response(null),
    );
    const getServerPublicKeyHex = t.mock.fn(async () => MOCK_HPKE_PUBLIC_KEY);
    const createTransport = t.mock.fn(async () => ({
      request: transportRequest,
      getServerPublicKeyHex,
    }));
    const identityGenerate = t.mock.fn(async () => ({ __mockIdentity: true }));

    const controller = new AbortController();
    const request = new Request("https://secure.test/v1/create", {
      method: "POST",
      headers: { "x-test": "1" },
      body: "payload",
      signal: controller.signal,
    });

    await withEhbpModuleMock(
      createModuleStub(identityGenerate, createTransport),
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
      request: transportRequest,
      getServerPublicKeyHex,
    }));
    const identityGenerate = t.mock.fn(async () => ({ __mockIdentity: true }));

    await withEhbpModuleMock(
      createModuleStub(identityGenerate, createTransport),
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
});
