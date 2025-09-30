import { describe, it } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert";
import { withMockedModules } from "./test-utils";
import { encryptedBodyRequest, createEncryptedBodyFetch } from "../encrypted-body-fetch";

const MOCK_FP = "a3b1c5d7e9f0a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f506172839a";

describe("Security enforcement", () => {
  it("EHBP helpers reject HTTP URLs and baseURL", async () => {
    await assert.rejects(
      encryptedBodyRequest("http://insecure.test/v1/models", "hpke-key"),
      /HTTP connections are not allowed/i,
    );

    const create = () => createEncryptedBodyFetch("http://insecure.test/v1/", "hpke-key");
    await assert.rejects(
      (async () => {
        const f = create();
        await f("models");
      })(),
      /must use HTTPS|HTTP connections are not allowed/i,
    );
  });

  it("TinfoilAI TLS fallback uses pinned fetch that rejects HTTP", async (t: TestContext) => {
    const verifyMock = t.mock.fn(async () => ({
      tlsPublicKeyFingerprint: MOCK_FP,
      // No HPKE key triggers TLS fallback
      measurement: { type: "eif", registers: [] },
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
                codeMeasurement: { type: "eif", registers: [] },
                enclaveMeasurement: {
                  tlsPublicKeyFingerprint: MOCK_FP,
                  measurement: { type: "eif", registers: [] },
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
        const { TinfoilAI } = await import("../client");
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
      measurement: { type: "eif", registers: [] },
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
                codeMeasurement: { type: "eif", registers: [] },
                enclaveMeasurement: {
                  tlsPublicKeyFingerprint: MOCK_FP,
                  measurement: { type: "eif", registers: [] },
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

