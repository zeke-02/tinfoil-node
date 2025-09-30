import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { TINFOIL_CONFIG } from "./config";
import { createEncryptedBodyFetch } from "./encrypted-body-fetch";
import { Verifier } from "./verifier";
import { isRealBrowser } from "./env";
import https from "https";
import tls, { checkServerIdentity as tlsCheckServerIdentity } from "tls";
import { X509Certificate, createHash } from "crypto";
import { Readable } from "stream";
import { ReadableStream as NodeReadableStream } from "stream/web";

interface CreateTinfoilAIOptions {
  /** Override the inference API base URL */
  baseURL?: string;
  /** Override the config GitHub repository */
  configRepo?: string;
}

/**
 * Creates an AI SDK provider with the specified API key.
 *
 * @param apiKey - The API key for the Tinfoil API
 * @param options - Optional configuration options
 * @returns A TinfoilAI instance
 */
export async function createTinfoilAI(apiKey: string, options: CreateTinfoilAIOptions = {}) {
  const baseURL = options.baseURL || TINFOIL_CONFIG.INFERENCE_BASE_URL;
  const configRepo = options.configRepo || TINFOIL_CONFIG.INFERENCE_PROXY_REPO;

  assertHttpsUrl(baseURL, "Inference baseURL");

  // step 1: verify the enclave and extract the public keys
  // from the attestation response
  const verifier = new Verifier({ serverURL: baseURL, configRepo });
  const attestationResponse = await verifier.verify();
  const hpkePublicKey = attestationResponse.hpkePublicKey;
  const tlsPublicKeyFingerprint = attestationResponse.tlsPublicKeyFingerprint;

  // step 2: create the appropriate fetch function based on available keys
  let fetchFunction: typeof fetch;
  
  if (hpkePublicKey) {
    // HPKE available: use encrypted body fetch
    fetchFunction = createEncryptedBodyFetch(baseURL, hpkePublicKey);
  } else {
    // HPKE not available: check if we're in a browser
    if (isRealBrowser()) {
      throw new Error(
        "HPKE public key not available and TLS-only verification is not supported in browsers. " +
        "Only HPKE-enabled enclaves can be used in browser environments."
      );
    }
    
    // Node.js environment: fall back to TLS-only verification using pinned TLS fetch
    if (!tlsPublicKeyFingerprint) {
      throw new Error(
        "Neither HPKE public key nor TLS public key fingerprint available for verification"
      );
    }
    fetchFunction = createPinnedTlsFetch(tlsPublicKeyFingerprint);
  }

  // step 3: create the openai compatible provider
  // that uses the appropriate fetch function
  return createOpenAICompatible({
    name: "tinfoil",
    baseURL: baseURL.replace(/\/$/, ""),
    apiKey: apiKey,
    fetch: fetchFunction,
  });
}

function assertHttpsUrl(url: string, context: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error(`${context} must use HTTPS. Got: ${url}`);
  }
}

function createPinnedTlsFetch(expectedFingerprintHex: string): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    // Normalize URL
    const makeURL = (value: RequestInfo | URL): URL => {
      if (typeof value === "string") return new URL(value);
      if (value instanceof URL) return value;
      return new URL((value as Request).url);
    };

    const url = makeURL(input);
    if (url.protocol !== "https:") {
      throw new Error(`HTTP connections are not allowed. Use HTTPS. URL: ${url.toString()}`);
    }

    // Gather method and headers
    const method = (init?.method || (input as any).method || "GET").toUpperCase();
    const headers = new Headers(init?.headers || (input as any)?.headers || {});
    const headerObj: Record<string, string> = {};
    headers.forEach((v, k) => {
      headerObj[k] = v;
    });

    // Resolve body
    let body: any = init?.body;
    if (!body && input instanceof Request) {
      // If the original was a Request with a body, read it
      try {
        const buf = await (input as Request).arrayBuffer();
        if (buf && (buf as ArrayBuffer).byteLength) body = Buffer.from(buf as ArrayBuffer);
      } catch {}
    }
    // Convert web streams to Node streams if needed
    if (body && typeof (body as any).getReader === "function") {
      body = Readable.fromWeb(body as unknown as NodeReadableStream);
    }
    if (body instanceof ArrayBuffer) {
      body = Buffer.from(body);
    }
    if (ArrayBuffer.isView(body)) {
      body = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
    }

    const requestOptions: https.RequestOptions & tls.ConnectionOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : 443,
      path: `${url.pathname}${url.search}`,
      method,
      headers: headerObj,
      checkServerIdentity: (host, cert): Error | undefined => {
        const raw = (cert as any).raw as Buffer | undefined;
        if (!raw) {
          return new Error("Certificate raw bytes are unavailable for pinning");
        }
        const x509 = new X509Certificate(raw);
        const publicKeyDer = x509.publicKey.export({ type: "spki", format: "der" });
        const fp = createHash("sha256").update(publicKeyDer).digest("hex");
        if (fp !== expectedFingerprintHex) {
          return new Error(`Certificate public key fingerprint mismatch. Expected: ${expectedFingerprintHex}, Got: ${fp}`);
        }
        return tlsCheckServerIdentity(host, cert);
      },
    };

    const { signal } = init || {};

    const res = await new Promise<import("http").IncomingMessage>((resolve, reject) => {
      const req = https.request(requestOptions, resolve);
      req.on("error", reject);
      if (signal) {
        if ((signal as AbortSignal).aborted) {
          req.destroy(new Error("Request aborted"));
          return;
        }
        (signal as AbortSignal).addEventListener("abort", () => req.destroy(new Error("Request aborted")));
      }
      if (body === undefined || body === null) {
        req.end();
      } else if (typeof body === "string" || Buffer.isBuffer(body) || ArrayBuffer.isView(body)) {
        req.end(body as any);
      } else if (typeof (body as any).pipe === "function") {
        (body as any).pipe(req);
      } else {
        // Fallback: try to serialize objects
        req.end(String(body));
      }
    });

    const responseHeaders = new Headers();
    for (const [k, v] of Object.entries(res.headers)) {
      if (Array.isArray(v)) {
        for (const item of v) responseHeaders.append(k, item);
      } else if (typeof v === "string") {
        responseHeaders.set(k, v);
      } else if (typeof v === "number") {
        responseHeaders.set(k, String(v));
      }
    }

    // Convert Node stream to Web ReadableStream
    const webStream = Readable.toWeb(res as unknown as import("stream").Readable) as unknown as ReadableStream;
    return new Response(webStream, {
      status: res.statusCode || 0,
      statusText: res.statusMessage || "",
      headers: responseHeaders,
    });
  }) as typeof fetch;
}
