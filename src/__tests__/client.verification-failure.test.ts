import { describe, it } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert";
import { withMockedModules } from "./test-utils";

describe("Client verification gating", () => {
  it("blocks client creation and requests when verification fails", async (t: TestContext) => {
    const createAttestedFetch = t.mock.fn((_baseURL: string, _hpkeKey: string) => {
      return (async () => new Response(null)) as typeof fetch;
    });

    await withMockedModules(
      {
        // Prevent ESM import issues by stubbing the OpenAI client
        openai: class OpenAI {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          constructor(_opts?: any) {}
        },
        "./verifier": {
          Verifier: class {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            constructor(_opts?: any) {}
            verify() {
              throw new Error("verify failed");
            }
          },
        },
        "./attested-fetch": { createAttestedFetch },
      },
      ["../client"],
      async () => {
        const { TinfoilAI } = await import("../client");
        const client = new TinfoilAI({ apiKey: "test" });

        await assert.rejects(() => client.ready(), /Failed to verify enclave/);

        await assert.rejects(
          () =>
            client.chat.completions.create({
              model: "llama-free",
              messages: [{ role: "user", content: "hi" }],
            } as any),
          /Failed to verify enclave/,
        );

        assert.strictEqual(
          createAttestedFetch.mock.callCount(),
          0,
          "transport should not be created when verification fails",
        );
      },
    );
  });
});


