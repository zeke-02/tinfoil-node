import { describe, it } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert";
import { TINFOIL_CONFIG } from "../config";
import { withMockedModules } from "./test-utils";

describe("Secure transport integration", () => {
  it("configures the OpenAI SDK to use the encrypted body transport", async (t: TestContext) => {
    const verifyMock = t.mock.fn(async () => ({
      tlsPublicKeyFingerprint: "fingerprint",
      hpkePublicKey: "mock-hpke-public-key",
      measurement: { type: "eif", registers: [] },
    }));
    const mockFetch = t.mock.fn(async () => new Response(null));
    const createEncryptedBodyFetchMock = t.mock.fn(
      (_baseURL: string, _hpkePublicKey: string) => mockFetch,
    );
    const openAIConstructorMock = t.mock.fn(function (this: unknown, options: {
      fetch?: typeof fetch;
    }) {
      return {
        options,
        chat: {},
        files: {},
        images: {},
        audio: {},
        embeddings: {},
        models: {},
        moderations: {},
        beta: {},
      };
    });
    const createOpenAICompatibleMock = t.mock.fn(
      (options: { fetch: typeof fetch }) => ({ __mockProvider: true }),
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
                repo: "test-repo",
                enclaveHost: "test-host",
                digest: "test-digest",
                codeMeasurement: { type: "eif", registers: [] },
                enclaveMeasurement: {
                  tlsPublicKeyFingerprint: "fingerprint",
                  hpkePublicKey: "mock-hpke-public-key",
                  measurement: { type: "eif", registers: [] },
                },
                match: true,
              };
            }
          },
        },
        "./encrypted-body-fetch": {
          createEncryptedBodyFetch: createEncryptedBodyFetchMock,
        },
        openai: Object.assign(openAIConstructorMock, {
          OpenAI: openAIConstructorMock,
        }),
        "@ai-sdk/openai-compatible": {
          createOpenAICompatible: createOpenAICompatibleMock,
        },
      },
      ["../client"],
      async () => {
        const { TinfoilAI } = await import("../client");
        const client = new TinfoilAI({ apiKey: "test" });
        await client.ready();

        assert.strictEqual(verifyMock.mock.callCount(), 1);
        assert.deepStrictEqual(createEncryptedBodyFetchMock.mock.calls[0]?.arguments, [
          TINFOIL_CONFIG.INFERENCE_BASE_URL,
          "mock-hpke-public-key",
        ]);
        assert.strictEqual(openAIConstructorMock.mock.callCount(), 1);
        const options = openAIConstructorMock.mock.calls[0]?.arguments[0] as {
          baseURL: string;
          fetch: typeof fetch;
        } | undefined;
        assert.ok(options, "OpenAI constructor options should be provided");
        assert.strictEqual(options.baseURL, TINFOIL_CONFIG.INFERENCE_BASE_URL);
        assert.strictEqual(options.fetch, mockFetch);
      },
    );
  });

  it("provides the encrypted body transport to the AI SDK provider", async (t: TestContext) => {
    const verifyMock = t.mock.fn(async () => ({
      tlsPublicKeyFingerprint: "fingerprint",
      hpkePublicKey: "mock-hpke-public-key",
      measurement: { type: "eif", registers: [] },
    }));
    const mockFetch = t.mock.fn(async () => new Response(null));
    const createEncryptedBodyFetchMock = t.mock.fn(
      (_baseURL: string, _hpkePublicKey: string) => mockFetch,
    );
    const createOpenAICompatibleMock = t.mock.fn(
      (options: { fetch: typeof fetch }) => ({ __mockProvider: true }),
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
                repo: "test-repo",
                enclaveHost: "test-host",
                digest: "test-digest",
                codeMeasurement: { type: "eif", registers: [] },
                enclaveMeasurement: {
                  tlsPublicKeyFingerprint: "fingerprint",
                  hpkePublicKey: "mock-hpke-public-key",
                  measurement: { type: "eif", registers: [] },
                },
                match: true,
              };
            }
          },
        },
        "./encrypted-body-fetch": {
          createEncryptedBodyFetch: createEncryptedBodyFetchMock,
        },
        "@ai-sdk/openai-compatible": {
          createOpenAICompatible: createOpenAICompatibleMock,
        },
      },
      ["../ai-sdk-provider"],
      async () => {
        const { createTinfoilAI } = await import("../ai-sdk-provider");
        const provider = await createTinfoilAI("api-key");

        assert.strictEqual(verifyMock.mock.callCount(), 1);
        assert.deepStrictEqual(createEncryptedBodyFetchMock.mock.calls[0]?.arguments, [
          TINFOIL_CONFIG.INFERENCE_BASE_URL,
          "mock-hpke-public-key",
        ]);
        assert.strictEqual(createOpenAICompatibleMock.mock.callCount(), 1);
        const options = createOpenAICompatibleMock.mock.calls[0]?.arguments[0] as {
          fetch: typeof fetch;
        } | undefined;
        assert.ok(options, "Provider options should be provided");
        assert.strictEqual(options.fetch, mockFetch);
        assert.deepStrictEqual(provider, { __mockProvider: true });
      },
    );
  });
});
