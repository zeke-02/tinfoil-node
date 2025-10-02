import { Verifier } from "./verifier";
import type { VerificationDocument } from "./verifier";
import { TINFOIL_CONFIG } from "./config";
import { createEncryptedBodyFetch } from "./encrypted-body-fetch";
import { isRealBrowser } from "./env";
import https from "https";
import tls, { checkServerIdentity as tlsCheckServerIdentity } from "tls";
import { X509Certificate, createHash } from "crypto";
import { Readable } from "stream";
import { ReadableStream as NodeReadableStream } from "stream/web";

interface SecureClientOptions {
  baseURL?: string;
  hpkeKeyURL?: string;
  configRepo?: string;
}

export class SecureClient {
  private initPromise: Promise<void> | null = null;
  private _fetch: typeof fetch | null = null;
  private configRepo?: string;
  private verificationDocument?: VerificationDocument;

  public baseURL?: string;
  public hpkeKeyURL?: string;

  constructor(options: SecureClientOptions = {}) {
    this.baseURL = options.baseURL || TINFOIL_CONFIG.INFERENCE_BASE_URL;
    this.hpkeKeyURL = options.hpkeKeyURL || TINFOIL_CONFIG.HPKE_KEY_URL;
    this.configRepo = options.configRepo || TINFOIL_CONFIG.INFERENCE_PROXY_REPO;
  }

  public async ready(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initSecureClient();
    }
    return this.initPromise;
  }

  private async initSecureClient(): Promise<void> {
    const verifier = new Verifier({
      serverURL: this.baseURL,
      configRepo: this.configRepo,
    });

    await verifier.verify();
    this.verificationDocument = verifier.getVerificationDocument();
    if (!this.verificationDocument) {
      throw new Error("Verification document not available after successful verification");
    }

    const hpkePublicKey = this.verificationDocument.enclaveMeasurement.hpkePublicKey;
    const tlsPublicKeyFingerprint = this.verificationDocument.enclaveMeasurement.tlsPublicKeyFingerprint;
    
    let fetchFunction: typeof fetch;

    if (hpkePublicKey) {
      // HPKE available: use encrypted body fetch
      fetchFunction = createEncryptedBodyFetch(this.baseURL!, hpkePublicKey, this.hpkeKeyURL);
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

    this._fetch = fetchFunction;
  }

  public async getVerificationDocument(): Promise<VerificationDocument> {
    await this.ready();
    if (!this.verificationDocument) {
      throw new Error("Verification document unavailable: client not verified yet");
    }
    return this.verificationDocument;
  }

  get fetch(): typeof fetch {
    return async (input: RequestInfo | URL, init?: RequestInit) => {
      await this.ready();
      return this._fetch!(input, init);
    };
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
        v.forEach(item => responseHeaders.append(k, item));
      } else if (v != null) {
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