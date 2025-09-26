import { fetch } from "undici";
import { TextDecoder, TextEncoder } from "util";
import { TINFOIL_CONFIG } from "./config";

// Set up browser-like globals that the Go WASM runtime expects
const globalThis = global as any;

// Performance API
globalThis.performance = {
  now: () => Date.now(),
  markResourceTiming: () => {},
  mark: () => {},
  measure: () => {},
  clearMarks: () => {},
  clearMeasures: () => {},
  getEntriesByName: () => [],
  getEntriesByType: () => [],
  getEntries: () => [],
};

// Text encoding
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;

// Crypto API (needed by Go WASM)
if (!globalThis.crypto) {
  globalThis.crypto = {
    getRandomValues: (buffer: Uint8Array) => {
      const randomBytes = require("crypto").randomBytes(buffer.length);
      buffer.set(new Uint8Array(randomBytes));
      return buffer;
    },
  };
}

// Default: suppress WASM (Go) stdout/stderr logs unless explicitly enabled by caller
if ((globalThis as any).__tinfoilSuppressWasmLogs === undefined) {
  (globalThis as any).__tinfoilSuppressWasmLogs = true;
}

// Force process to stay running (prevent Go from exiting Node process)
// This is a common issue with Go WASM in Node - it calls process.exit()
const originalExit = process.exit;
// Replace process.exit to prevent the Go WASM runtime from terminating the Node.js process.
// When wasm log suppression is enabled, suppress the informational log about the ignored exit
// so callers can silence only the WASM-related noise while keeping application logs intact.
process.exit = ((code?: number) => {
  if (!(globalThis as any).__tinfoilSuppressWasmLogs) {
    console.log(
      `Process exit called with code ${code} - ignoring to keep Node.js process alive`,
    );
  }
  return undefined as never;
}) as any;

// Load the Go runtime helper
require("./wasm-exec.js");

/**
 * Attestation response from verification
 */
export interface AttestationMeasurement {
  type: string;
  registers: string[];
}

export interface AttestationResponse {
  tlsPublicKeyFingerprint: string;
  hpkePublicKey: string;
  measurement: AttestationMeasurement;
}

/**
 * Verifier handles verification of code and runtime measurements using WebAssembly
 */
export class Verifier {
  private static goInstance: any = null;
  private static initializationPromise: Promise<void> | null = null;
  private static verificationCache = new Map<string, Promise<AttestationResponse>>();
  private static wasmUrlUsed: string | null = null;
  private static readonly defaultWasmUrl =
    "https://tinfoilsh.github.io/verifier-js/tinfoil-verifier.wasm";
  public static originalFsWriteSync: ((fd: number, buf: Uint8Array) => number) | null = null;
  public static wasmLogsSuppressed = true;

  public static clearVerificationCache(): void {
    Verifier.verificationCache.clear();
  }

  // Values for the Tinfoil inference proxy from config (overridable per instance)
  private readonly enclave: string;
  private readonly repo: string;

  constructor(options?: { baseURL?: string; repo?: string }) {
    const baseURL = options?.baseURL ?? TINFOIL_CONFIG.INFERENCE_BASE_URL;
    this.enclave = new URL(baseURL).hostname;
    this.repo = options?.repo ?? TINFOIL_CONFIG.INFERENCE_PROXY_REPO;
  }

  /**
   * Static method to initialize WASM module
   * This starts automatically when the class is loaded
   */
  public static async initializeWasm(wasmUrl?: string): Promise<void> {
    if (Verifier.initializationPromise) {
      return Verifier.initializationPromise;
    }

    Verifier.initializationPromise = (async () => {
      try {
        Verifier.goInstance = new globalThis.Go();
        const urlToUse = wasmUrl || Verifier.wasmUrlUsed || Verifier.defaultWasmUrl;
        Verifier.wasmUrlUsed = urlToUse;

        let result: WebAssembly.WebAssemblyInstantiatedSource;
        try {
          // Prefer streaming if server provides correct content-type
          const wasmResponse = await fetch(urlToUse);
          if (
            typeof WebAssembly.instantiateStreaming === "function" &&
            wasmResponse.headers.get("content-type")?.includes("application/wasm")
          ) {
            result = await WebAssembly.instantiateStreaming(
              wasmResponse as unknown as Response,
              Verifier.goInstance.importObject,
            );
          } else {
            const wasmBuffer = await wasmResponse.arrayBuffer();
            result = await WebAssembly.instantiate(
              wasmBuffer,
              Verifier.goInstance.importObject,
            );
          }
        } catch (instantiateError) {
          // Fallback to arrayBuffer instantiation as a last resort
          const fallbackResponse = await fetch(urlToUse);
          const fallbackBuffer = await fallbackResponse.arrayBuffer();
          result = await WebAssembly.instantiate(
            fallbackBuffer,
            Verifier.goInstance.importObject,
          );
        }
        Verifier.goInstance.run(result.instance).catch((error: unknown) => {
          console.error("Go instance failed to run:", error);
          throw error;
        });

        // Apply log suppression if requested and fs polyfill exists.
        // wasm-exec routes Go's stdout/stderr through a Node-like fs.writeSync; overriding it to a no-op
        // silences only the WASM program's prints without muting the rest of the application's console output.
        if (Verifier.wasmLogsSuppressed && (globalThis as any).fs?.writeSync) {
          const fsObj = (globalThis as any).fs as { writeSync: (fd: number, buf: Uint8Array) => number };
          if (!Verifier.originalFsWriteSync) {
            Verifier.originalFsWriteSync = fsObj.writeSync.bind(fsObj);
          }
          fsObj.writeSync = function (_fd: number, buf: Uint8Array) {
            return buf.length;
          };
        }

        let attempts = 0;
        const maxAttempts = 10;

        while (attempts < maxAttempts) {
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 100));

          const hasVerifyCode = typeof globalThis.verifyCode === "function";
          const hasVerifyEnclave =
            typeof globalThis.verifyEnclave === "function";

          if (hasVerifyCode && hasVerifyEnclave) {
            return;
          }
        }

        throw new Error("WASM functions not exposed after multiple attempts");
      } catch (error) {
        console.error("WASM initialization error:", error);
        throw error;
      }
    })();

    return Verifier.initializationPromise;
  }

  /**
   * Initialize the WASM module
   * Now just waits for the static initialization to complete
   */
  public async initialize(): Promise<void> {
    await Verifier.initializeWasm();
  }

  /**
   * Verifies the integrity of both the code and runtime environment
   */
  public async verify(): Promise<AttestationResponse> {
    const cacheKey = `${this.repo}::${this.enclave}`;
    const cachedResult = Verifier.verificationCache.get(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    const verificationPromise = (async () => {
      await this.initialize();

      if (
        typeof globalThis.verifyCode !== "function" ||
        typeof globalThis.verifyEnclave !== "function"
      ) {
        throw new Error("WASM functions not available");
      }

      const releaseResponse = await fetch(
        `https://api-github-proxy.tinfoil.sh/repos/${this.repo}/releases/latest`,
        {
          headers: {
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "tinfoil-node-client",
          },
        },
      );

      if (!releaseResponse.ok) {
        throw new Error(
          `GitHub API request failed: ${releaseResponse.status} ${releaseResponse.statusText}`,
        );
      }

      const releaseData = (await releaseResponse.json()) as { body?: string };

      const eifRegex = /EIF hash: ([a-f0-9]{64})/i;
      const digestRegex = /Digest: `([a-f0-9]{64})`/;

      let digest;
      const eifMatch = releaseData.body?.match(eifRegex);
      const digestMatch = releaseData.body?.match(digestRegex);

      if (eifMatch) {
        digest = eifMatch[1];
      } else if (digestMatch) {
        digest = digestMatch[1];
      } else {
        throw new Error("Could not find digest in release notes");
      }

      const [measurement, attestationResponse] = await Promise.all([
        globalThis.verifyCode(this.repo, digest),
        globalThis.verifyEnclave(this.enclave),
      ]);

      // TODO(security): compare measurement.registers !== attestationResponse.measurement
      // for now we only compare measurement.registers as a hack to get things working
      if (measurement.registers !== attestationResponse.measurement.registers) {
        throw new Error("Measurements do not match");
      }

      return {
        tlsPublicKeyFingerprint: attestationResponse.tls_public_key,
        hpkePublicKey: attestationResponse.hpke_public_key,
        measurement: attestationResponse.measurement,
      };
    })();

    Verifier.verificationCache.set(cacheKey, verificationPromise);
    verificationPromise.catch(() => {
      Verifier.verificationCache.delete(cacheKey);
    });

    return verificationPromise;
  }
}

// Start initialization as soon as the module loads
Verifier.initializeWasm().catch(console.error);

/**
 * Types for verification orchestration
 */
export type VerificationStepStatus = "pending" | "loading" | "success" | "error";

export interface VerificationStepState {
  status: VerificationStepStatus;
  measurement?: AttestationMeasurement;
  tlsPublicKeyFingerprint?: string;
  hpkePublicKey?: string;
  error?: string;
}

export interface VerificationSecurityState {
  status: VerificationStepStatus;
  match?: boolean;
  error?: string;
}

export interface VerificationResult {
  code: VerificationStepState;
  runtime: VerificationStepState;
  security: VerificationSecurityState;
  digest: string;
}

export interface RunVerificationParams {
  repo: string;
  enclaveHost: string;
  digest?: string;
  onUpdate?: (state: VerificationResult) => void;
}

export interface VerifierClient {
  /**
   * Wraps WASM verifyEnclave(hostname) and normalizes result into strings
   */
  verifyEnclave(hostname: string): Promise<{
    measurement: AttestationMeasurement;
    tlsPublicKeyFingerprint: string;
    hpkePublicKey: string;
    // Expose raw for advanced consumers without coupling to WebAssembly internals
    raw?: unknown;
  }>;

  /**
   * Wraps WASM verifyCode(repo, digest) and normalizes result into string
   */
  verifyCode(repo: string, digest: string): Promise<{
    measurement: AttestationMeasurement;
    raw?: unknown;
  }>;

  /** Retrieve latest release digest for a repo */
  fetchLatestDigest(repo: string): Promise<string>;

  /** High-level orchestration */
  runVerification(params: RunVerificationParams): Promise<VerificationResult>;

  /** Subscribe to state updates; returns unsubscribe function */
  subscribe(listener: (state: VerificationResult) => void): () => void;
}

/** Extracts a structured AttestationMeasurement from the WASM return value. */
function parseAttestationMeasurement(input: unknown): AttestationMeasurement {
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    const candidate = (obj.measurement ?? obj) as Record<string, unknown>;
    const typeVal = candidate?.type;
    const regsVal = candidate?.registers;
    if (
      typeof typeVal === "string" &&
      Array.isArray(regsVal) &&
      regsVal.every((r) => typeof r === "string")
    ) {
      return { type: typeVal, registers: regsVal as string[] };
    }
  }
  throw new Error("Unexpected measurement format from WASM verifier");
}

function measurementsEqual(a: AttestationMeasurement, b: AttestationMeasurement): boolean {
  if (a.type !== b.type) return false;
  if (a.registers.length !== b.registers.length) return false;
  for (let i = 0; i < a.registers.length; i++) {
    if (a.registers[i] !== b.registers[i]) return false;
  }
  return true;
}

// key extraction is done inline in verifyEnclave

/**
 * Fetch latest digest from GitHub releases, preserving current regex behavior.
 */
export async function fetchLatestDigest(repo: string): Promise<string> {
  const releaseResponse = await fetch(
    `https://api-github-proxy.tinfoil.sh/repos/${repo}/releases/latest`,
    {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "tinfoil-node-client",
      },
    },
  );

  if (!releaseResponse.ok) {
    throw new Error(
      `GitHub API request failed: ${releaseResponse.status} ${releaseResponse.statusText}`,
    );
  }

  const releaseData = (await releaseResponse.json()) as { body?: string };

  const eifRegex = /EIF hash: ([a-f0-9]{64})/i;
  const digestRegex = /Digest: `([a-f0-9]{64})`/;

  const eifMatch = releaseData.body?.match(eifRegex);
  const digestMatch = releaseData.body?.match(digestRegex);

  if (eifMatch) return eifMatch[1];
  if (digestMatch) return digestMatch[1];
  throw new Error("Could not find digest in release notes");
}

class WasmVerifierClient implements VerifierClient {
  private listeners = new Set<(state: VerificationResult) => void>();
  private lastState: VerificationResult | null = null;

  async verifyEnclave(hostname: string): Promise<{
    measurement: AttestationMeasurement;
    tlsPublicKeyFingerprint: string;
    hpkePublicKey: string;
    raw?: unknown;
  }> {
    await Verifier.initializeWasm();
    if (typeof (globalThis as any).verifyEnclave !== "function") {
      throw new Error("WASM function verifyEnclave not available");
    }
    const raw = await (globalThis as any).verifyEnclave(hostname);
    const measurement = parseAttestationMeasurement(raw);
    if (!raw || typeof raw !== "object") {
      throw new Error("Unexpected response from verifyEnclave");
    }
    const tlsPublicKeyFingerprint = (raw as any)["tls_public_key"];
    const hpkePublicKey = (raw as any)["hpke_public_key"];
    if (typeof tlsPublicKeyFingerprint !== "string") {
      throw new Error("Missing tls_public_key in verifyEnclave response");
    }
    if (typeof hpkePublicKey !== "string") {
      throw new Error("Missing hpke_public_key in verifyEnclave response");
    }
    return { measurement, tlsPublicKeyFingerprint, hpkePublicKey, raw };
  }

  async verifyCode(repo: string, digest: string): Promise<{
    measurement: AttestationMeasurement;
    raw?: unknown;
  }> {
    await Verifier.initializeWasm();
    if (typeof (globalThis as any).verifyCode !== "function") {
      throw new Error("WASM function verifyCode not available");
    }
    const raw = await (globalThis as any).verifyCode(repo, digest);
    const measurement = parseAttestationMeasurement(raw);
    return { measurement, raw };
  }

  async fetchLatestDigest(repo: string): Promise<string> {
    return fetchLatestDigest(repo);
  }

  private emit(state: VerificationResult) {
    this.lastState = state;
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (err) {
        // Listener errors should not break flow
        console.error("VerifierClient listener error:", err);
      }
    }
  }

  subscribe(listener: (state: VerificationResult) => void): () => void {
    this.listeners.add(listener);
    if (this.lastState) listener(this.lastState);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async runVerification(params: RunVerificationParams): Promise<VerificationResult> {
    const { repo, enclaveHost, onUpdate } = params;
    let digest = params.digest || "";

    const initial: VerificationResult = {
      code: { status: "pending" },
      runtime: { status: "pending" },
      security: { status: "pending" },
      digest,
    };
    this.emit(initial);
    if (onUpdate) onUpdate(initial);

    // Ensure WASM loaded upfront
    await Verifier.initializeWasm();

    // Start runtime attestation immediately
    const runtimeLoading: VerificationResult = {
      code: { status: "pending" },
      runtime: { status: "loading" },
      security: { status: "pending" },
      digest,
    };
    this.emit(runtimeLoading);
    if (onUpdate) onUpdate(runtimeLoading);

    const runtimePromise = this
      .verifyEnclave(enclaveHost)
      .then((runtime) => ({
        status: "success" as const,
        measurement: runtime.measurement,
        tlsPublicKeyFingerprint: runtime.tlsPublicKeyFingerprint,
        hpkePublicKey: runtime.hpkePublicKey,
      }))
      .catch((err) => ({ status: "error" as const, error: (err as Error).message }));

    // Resolve digest concurrently if not provided
    const digestPromise = (async () => {
      if (digest) return digest;
      return this.fetchLatestDigest(repo);
    })();

    // Await runtime result
    const runtimeState = await runtimePromise;
    const runtimeMeasurement = runtimeState.status === "success" ? runtimeState.measurement! : undefined;

    const afterRuntime: VerificationResult = {
      code: { status: "pending" },
      runtime: runtimeState,
      security: { status: "pending" },
      digest,
    };
    this.emit(afterRuntime);
    if (onUpdate) onUpdate(afterRuntime);

    // Now ensure digest is available
    try {
      digest = await digestPromise;
    } catch (err) {
      const state: VerificationResult = {
        code: { status: "error", error: (err as Error).message },
        runtime: runtimeState,
        security: { status: "error", error: "Failed to resolve digest" },
        digest: "",
      };
      this.emit(state);
      if (onUpdate) onUpdate(state);
      return state;
    }

    // Code attestation
    const codeLoading: VerificationResult = {
      code: { status: "loading" },
      runtime: runtimeState,
      security: { status: "pending" },
      digest,
    };
    this.emit(codeLoading);
    if (onUpdate) onUpdate(codeLoading);

    const codeState = await this
      .verifyCode(repo, digest)
      .then((code) => ({ status: "success" as const, measurement: code.measurement }))
      .catch((err) => ({ status: "error" as const, error: (err as Error).message }));
    const codeMeasurement = codeState.status === "success" ? codeState.measurement! : undefined;

    // Security comparison
    const securityLoading: VerificationResult = {
      code: codeState,
      runtime: runtimeState,
      security: { status: "loading" },
      digest,
    };
    this.emit(securityLoading);
    if (onUpdate) onUpdate(securityLoading);

    let securityState: VerificationSecurityState;
    if (codeState.status === "success" && runtimeState.status === "success") {
      const match = measurementsEqual(codeMeasurement!, runtimeMeasurement!);
      securityState = match
        ? { status: "success", match }
        : { status: "error", match: false, error: "Measurements do not match" };
    } else {
      securityState = {
        status: "error",
        match: false,
        error: "Verification steps did not complete successfully",
      };
    }

    const finalState: VerificationResult = {
      code: codeState,
      runtime: runtimeState,
      security: securityState,
      digest,
    };
    this.emit(finalState);
    if (onUpdate) onUpdate(finalState);
    return finalState;
  }
}

/**
 * Bootstraps the Go WASM runtime and returns a ready client instance.
 * Subsequent calls reuse the loaded runtime.
 */
export async function loadVerifier(wasmUrl?: string): Promise<VerifierClient> {
  await Verifier.initializeWasm(wasmUrl);
  return new WasmVerifierClient();
}

/**
 * Suppress stdout/stderr produced by the Go WASM runtime without affecting the rest of the app logs.
 * Hooks wasm-exec's fs.writeSync (used for Go's stdout/stderr) and stores/restores the original so
 * suppression is scoped only to the WASM-side prints. Can be called before or after WASM initialization.
 */
export function suppressWasmLogs(suppress = true): void {
  (globalThis as any).__tinfoilSuppressWasmLogs = suppress;
  Verifier.wasmLogsSuppressed = suppress;

  const fsObj = (globalThis as any).fs as { writeSync: (fd: number, buf: Uint8Array) => number } | undefined;
  if (!fsObj || typeof fsObj.writeSync !== "function") return;

  if (suppress) {
    if (!Verifier.originalFsWriteSync) {
      Verifier.originalFsWriteSync = fsObj.writeSync.bind(fsObj);
    }
    fsObj.writeSync = function (_fd: number, buf: Uint8Array) {
      return buf.length;
    };
  } else if (Verifier.originalFsWriteSync) {
    fsObj.writeSync = Verifier.originalFsWriteSync;
  }
}


