import { describe, it } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert";
import { withMockedModules } from "./test-utils";

function makeHex64(): string {
  return "a".repeat(64);
}

const MOCK_MEASUREMENT_TYPE = "https://tinfoil.sh/predicate/sev-snp-guest/v1";

describe("Verifier", () => {
  it("verify() success flow with verification document", async (t: TestContext) => {
    const fetchMock = t.mock.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/releases/latest")) {
        return new Response(JSON.stringify({ body: `Digest: \`${makeHex64()}\`` }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(new Uint8Array([0x00]), {
        headers: { "content-type": "application/wasm" },
      });
    });

    const originalInstantiateStreaming = WebAssembly.instantiateStreaming;
    const originalInstantiate = WebAssembly.instantiate;
    const originalFetch = globalThis.fetch;
    (WebAssembly as any).instantiateStreaming = async () => ({ module: {}, instance: {} });
    (WebAssembly as any).instantiate = async () => ({ module: {}, instance: {} });
    globalThis.fetch = fetchMock as any;

    try {
      await withMockedModules(
        {
          "./wasm-exec.js": {
            default: undefined,
            __esModule: true,
          },
        },
        ["../verifier"],
        async () => {
          (globalThis as any).Go = class {
            importObject: Record<string, unknown> = {};
            run() {
              return Promise.resolve();
            }
          };
          (globalThis as any).verify = async (_host: string, _repo: string) =>
            JSON.stringify({
              tls_public_key: "tls-fp",
              hpke_public_key: "hpke-key",
              digest: makeHex64(),
              code_measurement: { type: MOCK_MEASUREMENT_TYPE, registers: ["r1", "r2"] },
              enclave_measurement: { type: MOCK_MEASUREMENT_TYPE, registers: ["r1", "r2"] },
              code_fingerprint: "code-fp",
              enclave_fingerprint: "enclave-fp",
            });

          const { Verifier } = await import("../verifier");
          const verifier = new Verifier({
            serverURL: "https://host/v1",
            configRepo: "owner/repo"
          });

          await verifier.verify();
          const doc = verifier.getVerificationDocument();

          assert.ok(doc, "verification document should exist");
          assert.strictEqual(fetchMock.mock.callCount() > 0, true);
          assert.strictEqual(doc!.securityVerified, true);
          assert.strictEqual(doc!.steps.verifyEnclave.status, "success");
          assert.strictEqual(doc!.steps.verifyCode.status, "success");
          assert.strictEqual(doc!.steps.compareMeasurements.status, "success");
          assert.deepStrictEqual(doc!.enclaveMeasurement.measurement, { type: MOCK_MEASUREMENT_TYPE, registers: ["r1", "r2"] });
          assert.strictEqual(doc!.enclaveMeasurement.tlsPublicKeyFingerprint, "tls-fp");
          assert.strictEqual(doc!.enclaveMeasurement.hpkePublicKey, "hpke-key");
          assert.strictEqual(typeof doc!.releaseDigest, "string");
        },
      );
    } finally {
      (WebAssembly as any).instantiateStreaming = originalInstantiateStreaming;
      (WebAssembly as any).instantiate = originalInstantiate;
      globalThis.fetch = originalFetch;
    }
  });

  it("verify() handles errors with appropriate step states", async (t: TestContext) => {
    const fetchMock = t.mock.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/releases/latest")) {
        return new Response(null, { status: 500, statusText: "Bad" });
      }
      return new Response(new Uint8Array([0x00]), {
        headers: { "content-type": "application/wasm" },
      });
    });

    const originalInstantiateStreaming = WebAssembly.instantiateStreaming;
    const originalInstantiate = WebAssembly.instantiate;
    const originalFetch = globalThis.fetch;
    (WebAssembly as any).instantiateStreaming = async () => ({ module: {}, instance: {} });
    (WebAssembly as any).instantiate = async () => ({ module: {}, instance: {} });
    globalThis.fetch = fetchMock as any;

    try {
      await withMockedModules(
        {
          "./wasm-exec.js": {
            default: undefined,
            __esModule: true,
          },
        },
        ["../verifier"],
        async () => {
          (globalThis as any).Go = class {
            importObject: Record<string, unknown> = {};
            run() {
              return Promise.resolve();
            }
          };
          (globalThis as any).verify = async (_host: string, _repo: string) => {
            throw new Error("fetchDigest: GitHub API request failed");
          };

          const { Verifier } = await import("../verifier");
          const verifier = new Verifier({
            serverURL: "https://h/v1",
            configRepo: "o/r"
          });

          await assert.rejects(() => verifier.verify(), /fetchDigest: GitHub API request failed/);

          // Check that the verification document shows the correct failed step
          const doc = verifier.getVerificationDocument();
          assert.ok(doc, "verification document should exist even on failure");
          assert.strictEqual(doc!.securityVerified, false);
          assert.strictEqual(doc!.steps.fetchDigest.status, "failed");
          assert.ok(doc!.steps.fetchDigest.error?.includes("GitHub API request failed"));
        },
      );
    } finally {
      (WebAssembly as any).instantiateStreaming = originalInstantiateStreaming;
      (WebAssembly as any).instantiate = originalInstantiate;
      globalThis.fetch = originalFetch;
    }
  });
});
