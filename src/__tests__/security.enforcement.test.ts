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

describe("Security enforcement", () => {
  const mockEhbpModule = (
    transportRequest: (url: string, init?: RequestInit) => Promise<Response>,
    getServerPublicKeyHex: () => Promise<string>,
    identityGenerate: () => Promise<unknown>,
  ) => ({
    Identity: { generate: identityGenerate } as any,
    createTransport: async () => ({
      request: transportRequest,
      getServerPublicKeyHex,
    }),
    Transport: class {},
    PROTOCOL: {},
    HPKE_CONFIG: {},
  });

  const withEhbpMock = async (
    stub: ReturnType<typeof mockEhbpModule>,
    run: () => Promise<void>,
  ) => {
    try {
      __setEhbpModuleForTests(stub as any);
      await run();
    } finally {
      __resetEhbpModuleStateForTests();
    }
  };

  it("EHBP helpers allow HTTP origins while keeping HPKE enforcement", async (t: TestContext) => {
    const transportRequest = t.mock.fn(
      async (_url: string, _init?: RequestInit) => new Response("ok"),
    );
    const getServerPublicKeyHex = t.mock.fn(async () => "hpke-key");
    const identityGenerate = t.mock.fn(async () => ({ __mockIdentity: true }));

    await withEhbpMock(
      mockEhbpModule(transportRequest, getServerPublicKeyHex, identityGenerate),
      async () => {
        await encryptedBodyRequest("http://localhost:8080/v1/models", "hpke-key");

        const fetchThroughProxy = createEncryptedBodyFetch(
          "http://localhost:8080/v1/",
          "hpke-key",
        );
        await fetchThroughProxy("models");
      },
    );

    assert.strictEqual(identityGenerate.mock.callCount(), 1);
    assert.strictEqual(getServerPublicKeyHex.mock.callCount(), 2);
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
