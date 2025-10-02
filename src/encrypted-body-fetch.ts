import type { Transport as EhbpTransport } from "ehbp";
import { isRealBrowser } from "./env";

type EhbpModule = typeof import("ehbp");

const transportCache = new Map<string, Promise<EhbpTransport>>();
const compositeTransportCache = new Map<string, Promise<EhbpTransport>>();
let ehbpModulePromise: Promise<EhbpModule> | null = null;
let ehbpModuleOverride: EhbpModule | undefined;

// Public API
export function normalizeEncryptedBodyRequestArgs(
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

export async function encryptedBodyRequest(
  input: RequestInfo | URL,
  hpkePublicKey: string,
  init?: RequestInit,
  hpkeKeyURL?: string,
): Promise<Response> {
  const { url: requestUrl, init: requestInit } = normalizeEncryptedBodyRequestArgs(
    input,
    init,
  );

  const u = new URL(requestUrl);
  const { origin } = u;

  // Determine which origin to fetch the HPKE key from (may be different from request origin)
  const keyOrigin = hpkeKeyURL ? new URL(hpkeKeyURL).origin : origin;

  // If key origin matches request origin, use the standard transport (fetches keys from origin)
  // Otherwise, build a composite transport that routes to `origin` but uses the key fetched from `keyOrigin`.
  const transport =
    keyOrigin === origin
      ? await getTransportForOrigin(origin)
      : await getTransportForRequestOriginWithKeyFrom(origin, keyOrigin);

  const serverPublicKey = await transport.getServerPublicKeyHex();
  if (serverPublicKey !== hpkePublicKey) {
    // Clear caches so the next attempt re-handshakes
    if (keyOrigin === origin) {
      transportCache.delete(origin);
    } else {
      const cacheKey = `${origin}::${keyOrigin}`;
      compositeTransportCache.delete(cacheKey);
      // Also clear the underlying key-origin cache to force re-fetch
      transportCache.delete(keyOrigin);
    }
    throw new Error(`HPKE public key mismatch: expected ${hpkePublicKey}, got ${serverPublicKey}`);
  }

  return transport.request(requestUrl, requestInit);
}

export function createEncryptedBodyFetch(baseURL: string, hpkePublicKey: string, hpkeKeyURL?: string): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const normalized = normalizeEncryptedBodyRequestArgs(input, init);
    const targetUrl = new URL(normalized.url, baseURL);

    return encryptedBodyRequest(targetUrl.toString(), hpkePublicKey, normalized.init, hpkeKeyURL);
  }) as typeof fetch;
}

// Private helper functions
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
    if (isRealBrowser()) {
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

async function getTransportForRequestOriginWithKeyFrom(origin: string, keyOrigin: string): Promise<EhbpTransport> {
  const cacheKey = `${origin}::${keyOrigin}`;
  const cached = compositeTransportCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const transportPromise = (async () => {
  const { Identity, createTransport, Transport } = await getEhbpModule();

    // Ensure secure browser context
    if (typeof globalThis !== 'undefined') {
      const isSecure = (globalThis as any).isSecureContext !== false;
      const hasSubtle = !!(globalThis.crypto && (globalThis.crypto as Crypto).subtle);
      if (!isSecure || !hasSubtle) {
        const reason = !isSecure ? 'insecure context (use HTTPS or localhost)' : 'missing WebCrypto SubtleCrypto';
        throw new Error(`EHBP requires a secure browser context: ${reason}`);
      }
    }

    // Create a single client identity to use for both key discovery and requests
    const clientIdentity = await Identity.generate();

    // Fetch the server's HPKE public key from the dedicated key origin
    const keyTransport = await createTransport(keyOrigin, clientIdentity);
    // Reuse the discovered server public key but route to the request origin
    const serverPublicKey = keyTransport.getServerPublicKey();
    const requestHost = new URL(origin).host;
    return new Transport(clientIdentity, requestHost, serverPublicKey);
  })().catch((error) => {
    compositeTransportCache.delete(cacheKey);
    throw error;
  });

  compositeTransportCache.set(cacheKey, transportPromise);
  return transportPromise;
}

// Test utilities
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
  compositeTransportCache.clear();
}
