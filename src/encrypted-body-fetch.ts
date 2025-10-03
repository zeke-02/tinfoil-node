import type { Transport as EhbpTransport } from "ehbp";
import { isRealBrowser } from "./env";

type EhbpModule = typeof import("ehbp");

let transport: Promise<EhbpTransport> | null = null; 
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
  enclaveURL?: string,
): Promise<Response> {
  const { url: requestUrl, init: requestInit } = normalizeEncryptedBodyRequestArgs(
    input,
    init,
  );

  const u = new URL(requestUrl);
  const { origin } = u;

  const keyOrigin = enclaveURL ? new URL(enclaveURL).origin : origin;

  if(!transport) {
    transport = getTransportForOrigin(origin, keyOrigin);
  }
  
  const transportInstance = await transport;
  const transportKeyHash = await transportInstance.getServerPublicKeyHex(); 
  if(transportKeyHash !== hpkePublicKey) {
    throw new Error(`HPKE public key mismatch. Expected: ${hpkePublicKey}, Got: ${transportKeyHash}`);
  }

  return transportInstance.request(requestUrl, requestInit);
}

export function createEncryptedBodyFetch(baseURL: string, hpkePublicKey: string, enclaveURL?: string): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const normalized = normalizeEncryptedBodyRequestArgs(input, init);
    const targetUrl = new URL(normalized.url, baseURL);

    return encryptedBodyRequest(targetUrl.toString(), hpkePublicKey, normalized.init, enclaveURL);
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

async function getTransportForOrigin(origin: string, keyOrigin: string): Promise<EhbpTransport> {

  let transportPromise = (async () => {
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
    const serverPublicKey = keyTransport.getServerPublicKey();
    const requestHost = new URL(origin).host;
    return new Transport(clientIdentity, requestHost, serverPublicKey);
  })().catch((error) => {
    throw error;
  });
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
  transport = null;
}
