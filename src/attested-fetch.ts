import type { Transport as EhbpTransport } from "ehbp";

type EhbpModule = typeof import("ehbp");

const transportCache = new Map<string, Promise<EhbpTransport>>();

let ehbpModulePromise: Promise<EhbpModule> | null = null;
let ehbpModuleOverride: EhbpModule | undefined;

// Detect if we're in a real browser (not Node.js)
function isBrowser(): boolean {
  return typeof window !== 'undefined' &&
         typeof window.document !== 'undefined' &&
         typeof process === 'undefined';
}

/**
 * Load the ESM-only `ehbp` module in both browsers and Node.js CommonJS tests.
 *
 * - Browsers/Next.js: use a standard dynamic import so bundlers can statically
 *   include `ehbp` in the client bundle.
 * - Node.js (CJS tests/builds): avoid TypeScript transpiling import() to
 *   require(), which throws ERR_REQUIRE_ESM. Instead, create a runtime
 *   dynamic import via new Function so it remains a real import() call.
 */
function getEhbpModule(): Promise<EhbpModule> {
  if (ehbpModuleOverride) {
    return Promise.resolve(ehbpModuleOverride);
  }
  if (!ehbpModulePromise) {
    if (isBrowser()) {
      // Let the bundler include the module in browser builds
      ehbpModulePromise = import("ehbp");
    } else {
      const dynamicImport = new Function(
        "specifier",
        "return import(specifier);",
      ) as (specifier: string) => Promise<EhbpModule>;
      ehbpModulePromise = dynamicImport("ehbp");
    }
  }
  return ehbpModulePromise;
}

export function __setEhbpModuleForTests(
  module: EhbpModule | undefined,
): void {
  ehbpModuleOverride = module;
  ehbpModulePromise = module ? Promise.resolve(module) : null;
}

export function __resetEhbpModuleStateForTests(): void {
  ehbpModuleOverride = undefined;
  ehbpModulePromise = null;
  transportCache.clear();
}

async function getTransportForOrigin(origin: string): Promise<EhbpTransport> {
  const cached = transportCache.get(origin);
  if (cached) {
    return cached;
  }

  const transportPromise = (async () => {
    const { Identity, createTransport } = await getEhbpModule();
    
    // Ensure we're in a secure context with WebCrypto Subtle available (required by EHBP)
    if (typeof globalThis !== 'undefined') {
      const isSecure = (globalThis as any).isSecureContext !== false;
      const hasSubtle = !!(globalThis.crypto && (globalThis.crypto as Crypto).subtle);
      if (!isSecure || !hasSubtle) {
        const reason = !isSecure
          ? 'insecure context (use HTTPS or localhost)'
          : 'missing WebCrypto SubtleCrypto';
        throw new Error(`EHBP requires a secure browser context: ${reason}`);
      }
    }
    
    const clientIdentity = await Identity.generate();
    return createTransport(origin, clientIdentity);
  })().catch((error) => {
    transportCache.delete(origin);
    throw error;
  });

  transportCache.set(origin, transportPromise);
  return transportPromise;
}

export function normalizeAttestedRequestArgs(
  input: RequestInfo | URL,
  init?: RequestInit,
): { url: string; init?: RequestInit } {
  if (typeof input === "string") {
    return { url: input, init };
  }

  if (input instanceof URL) {
    return { url: input.toString(), init };
  }

  const request = input as Request;
  const cloned = request.clone();

  const derivedInit: RequestInit = {
    method: cloned.method,
    headers: new Headers(cloned.headers),
    body: cloned.body ?? undefined,
    signal: cloned.signal,
  };

  return {
    url: cloned.url,
    init: { ...derivedInit, ...init },
  };
}

export async function attestedRequest(
  input: RequestInfo | URL,
  hpkePublicKey: string,
  init?: RequestInit,
): Promise<Response> {
  const { url: requestUrl, init: requestInit } = normalizeAttestedRequestArgs(
    input,
    init,
  );

  const { origin } = new URL(requestUrl);
  const transport = await getTransportForOrigin(origin);

  const serverPublicKey = await transport.getServerPublicKeyHex();
  if (serverPublicKey !== hpkePublicKey) {
    throw new Error(`HPKE public key mismatch: expected ${hpkePublicKey}, got ${serverPublicKey}`);
  }
  
  return transport.request(requestUrl, requestInit);
}

export function createAttestedFetch(baseURL: string, hpkePublicKey: string): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const normalized = normalizeAttestedRequestArgs(input, init);
    const targetUrl = new URL(normalized.url, baseURL);

    return attestedRequest(targetUrl.toString(), hpkePublicKey, normalized.init);
  }) as typeof fetch;
}
