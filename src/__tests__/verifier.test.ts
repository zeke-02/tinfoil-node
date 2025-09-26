import { describe, it } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert";
import { withMockedModules } from "./test-utils";

function makeHex64(): string {
  return "a".repeat(64);
}

describe("Verifier helpers", () => {
  it("loadVerifier + runVerification success flow with updates", async (t: TestContext) => {
    const undiciFetchMock = t.mock.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/releases/latest")) {
        return new Response(JSON.stringify({ body: `EIF hash: ${makeHex64()}` }), {
          headers: { "content-type": "application/json" },
        });
      }
      // WASM fetch
      return new Response(new Uint8Array([0x00]), {
        headers: { "content-type": "application/wasm" },
      });
    });

    const originalInstantiateStreaming = WebAssembly.instantiateStreaming;
    const originalInstantiate = WebAssembly.instantiate;
    (WebAssembly as any).instantiateStreaming = async () => ({ module: {}, instance: {} });
    (WebAssembly as any).instantiate = async () => ({ module: {}, instance: {} });

    try {
      await withMockedModules(
        {
          "./wasm-exec.js": {
            default: undefined,
            __esModule: true,
          },
          undici: {
            fetch: undiciFetchMock,
          },
        },
        ["../verifier", "../verifier-loader"],
        async () => {
          // Provide minimal Go runtime and WASM exports expected by initializeWasm
          (globalThis as any).Go = class {
            importObject: Record<string, unknown> = {};
            run() {
              return Promise.resolve();
            }
          };
          (globalThis as any).verifyEnclave = async (_h: string) => ({
            measurement: { type: "eif", registers: ["r1", "r2"] },
            tls_public_key: "tls-fp",
            hpke_public_key: "hpke-key",
          });
          (globalThis as any).verifyCode = async (_r: string, _d: string) => ({
            type: "eif",
            registers: ["r1", "r2"],
          });

          const { loadVerifier } = await import("../verifier-loader");
          const client = await loadVerifier();

          const updates: any[] = [];
          const unsubscribe = client.subscribe((s: any) => updates.push(s));

          const result = await client.runVerification({
            repo: "owner/repo",
            enclaveHost: "host",
            onUpdate: (s: any) => updates.push(s),
          });

          unsubscribe();

          assert.strictEqual(undiciFetchMock.mock.callCount() > 0, true);
          assert.strictEqual(result.security.status, "success");
          assert.strictEqual(result.security.match, true);
          assert.strictEqual(result.runtime.status, "success");
          assert.deepStrictEqual(result.runtime.measurement, { type: "eif", registers: ["r1", "r2"] });
          assert.strictEqual(result.runtime.tlsPublicKeyFingerprint, "tls-fp");
          assert.strictEqual(result.runtime.hpkePublicKey, "hpke-key");
          assert.strictEqual(typeof result.digest, "string");

          // We should have emitted multiple state transitions
          assert.ok(updates.length >= 5, "should emit multiple updates");
          assert.deepStrictEqual(result, updates[updates.length - 1]);
        },
      );
    } finally {
      (WebAssembly as any).instantiateStreaming = originalInstantiateStreaming;
      (WebAssembly as any).instantiate = originalInstantiate;
    }
  });

  it("verifyEnclave throws when keys are missing", async (t: TestContext) => {
    const undiciFetchMock = t.mock.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/releases/latest")) {
        return new Response(JSON.stringify({ body: `EIF hash: ${makeHex64()}` }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(new Uint8Array([0x00]), {
        headers: { "content-type": "application/wasm" },
      });
    });

    const originalInstantiateStreaming = WebAssembly.instantiateStreaming;
    const originalInstantiate = WebAssembly.instantiate;
    (WebAssembly as any).instantiateStreaming = async () => ({ module: {}, instance: {} });
    (WebAssembly as any).instantiate = async () => ({ module: {}, instance: {} });

    try {
      await withMockedModules(
        {
          "./wasm-exec.js": {
            default: undefined,
            __esModule: true,
          },
          undici: {
            fetch: undiciFetchMock,
          },
        },
        ["../verifier", "../verifier-loader"],
        async () => {
          (globalThis as any).Go = class {
            importObject: Record<string, unknown> = {};
            run() {
              return Promise.resolve();
            }
          };
          (globalThis as any).verifyEnclave = async (_h: string) => ({
            measurement: { type: "eif", registers: ["r1"] },
            // Missing keys on purpose
          });
          (globalThis as any).verifyCode = async (_r: string, _d: string) => ({
            type: "eif",
            registers: ["r1"],
          });

          const { loadVerifier } = await import("../verifier-loader");
          const client = await loadVerifier();

          await assert.rejects(() => client.verifyEnclave("host"), /Missing tls_public_key/);
        },
      );
    } finally {
      (WebAssembly as any).instantiateStreaming = originalInstantiateStreaming;
      (WebAssembly as any).instantiate = originalInstantiate;
    }
  });

  it("fetchLatestDigest failure bubbles into runVerification error state", async (t: TestContext) => {
    const undiciFetchMock = t.mock.fn(async (input: RequestInfo) => {
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
    (WebAssembly as any).instantiateStreaming = async () => ({ module: {}, instance: {} });
    (WebAssembly as any).instantiate = async () => ({ module: {}, instance: {} });

    try {
      await withMockedModules(
        {
          "./wasm-exec.js": {
            default: undefined,
            __esModule: true,
          },
          undici: {
            fetch: undiciFetchMock,
          },
        },
        ["../verifier", "../verifier-loader"],
        async () => {
          (globalThis as any).Go = class {
            importObject: Record<string, unknown> = {};
            run() {
              return Promise.resolve();
            }
          };
          (globalThis as any).verifyEnclave = async (_h: string) => ({
            measurement: { type: "eif", registers: ["x"] },
            tls_public_key: "fp",
            hpke_public_key: "hpke",
          });
          (globalThis as any).verifyCode = async (_r: string, _d: string) => ({
            type: "eif",
            registers: ["x"],
          });

          const { loadVerifier } = await import("../verifier-loader");
          const client = await loadVerifier();
          const result = await client.runVerification({ repo: "o/r", enclaveHost: "h" });

          assert.strictEqual(result.code.status, "error");
          assert.strictEqual(result.security.status, "error");
          assert.strictEqual(result.digest, "");
        },
      );
    } finally {
      (WebAssembly as any).instantiateStreaming = originalInstantiateStreaming;
      (WebAssembly as any).instantiate = originalInstantiate;
    }
  });
});


