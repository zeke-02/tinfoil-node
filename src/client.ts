import OpenAI from "openai";
import type {
  Audio,
  Beta,
  Chat,
  Embeddings,
  Files,
  FineTuning,
  Images,
  Models,
  Moderations,
  Responses,
} from "openai/resources";
import { Verifier } from "./verifier";
import type { AttestationResponse } from "./verifier";
import type { VerificationDocument } from "./verifier";
import { TINFOIL_CONFIG } from "./config";
import { createEncryptedBodyFetch } from "./encrypted-body-fetch";
import https from "https";
import tls, { checkServerIdentity as tlsCheckServerIdentity } from "tls";
import { X509Certificate, createHash } from "crypto";
import { Readable } from "stream";
import { ReadableStream as NodeReadableStream } from "stream/web";

/**
 * Detects if the code is running in a real browser environment.
 * Returns false for Node.js environments, even with WASM loaded.
 */
import { isRealBrowser } from "./env";

/**
 * Creates a proxy that allows property access and method calls on a Promise before it resolves.
 * This enables a more ergonomic API where you can chain properties and methods without explicitly
 * awaiting the promise first.
 *
 * @param promise - A Promise that will resolve to an object
 * @returns A proxied version of the promised object that allows immediate property/method access
 *
 * @example
 * // Instead of:
 * const client = await getClient();
 * const result = await client.someProperty.someMethod();
 *
 * // You can write:
 * const client = createAsyncProxy(getClient());
 * const result = await client.someProperty.someMethod();
 *
 * @template T - The type of object that the promise resolves to
 */
function createAsyncProxy<T extends object>(promise: Promise<T>): T {
  return new Proxy({} as T, {
    get(target, prop) {
      return new Proxy(() => {}, {
        get(_, nestedProp) {
          return (...args: any[]) =>
            promise.then((obj) => {
              const value = (obj as any)[prop][nestedProp];
              return typeof value === "function"
                ? value.apply((obj as any)[prop], args)
                : value;
            });
        },
        apply(_, __, args) {
          return promise.then((obj) => {
            const value = (obj as any)[prop];
            return typeof value === "function" ? value.apply(obj, args) : value;
          });
        },
      });
    },
  });
}

/**
 * TinfoilAI is a wrapper around the OpenAI API client that adds additional
 * security measures through enclave verification and an EHBP-secured transport.
 *
 * It provides:
 * - Automatic verification of Tinfoil secure enclaves
 * - EHBP-enforced transport security for each request
 * - Type-safe access to OpenAI's chat completion APIs
 */

interface TinfoilAIOptions {
  apiKey?: string;
  /** Override the inference API base URL */
  baseURL?: string;
  /** Override the URL used to fetch the HPKE key (defaults to baseURL) */
  hpkeKeyURL?: string;
  /** Override the config GitHub repository */
  configRepo?: string;
  [key: string]: any; // Allow other OpenAI client options
}

export class TinfoilAI {
  private client?: OpenAI;
  private clientPromise: Promise<OpenAI>;
  private readyPromise?: Promise<void>;
  private configRepo?: string;
  private verificationDocument?: VerificationDocument;

  // Expose properties for compatibility
  public apiKey?: string;
  public baseURL?: string;
  public hpkeKeyURL?: string;

  /**
   * Creates a new TinfoilAI instance.
   * @param options - Configuration options including apiKey and other OpenAI client options
   */
  constructor(options: TinfoilAIOptions = {}) {
    // Set apiKey from options or environment variable
    const openAIOptions = { ...options };
    if (options.apiKey || process.env.TINFOIL_API_KEY) {
      openAIOptions.apiKey = options.apiKey || process.env.TINFOIL_API_KEY;
    }

    // Store properties for compatibility
    this.apiKey = openAIOptions.apiKey;
    this.baseURL = options.baseURL || TINFOIL_CONFIG.INFERENCE_BASE_URL;
    this.hpkeKeyURL = options.hpkeKeyURL || TINFOIL_CONFIG.HPKE_KEY_URL;
    this.configRepo =
      options.configRepo || TINFOIL_CONFIG.INFERENCE_PROXY_REPO;

    this.clientPromise = this.initClient(openAIOptions);
  }

  /**
   * Ensures the client is ready to use.
   * @returns Promise that resolves when the client is initialized
   */
  public async ready(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = (async () => {
        this.client = await this.clientPromise;
      })();
    }
    return this.readyPromise;
  }

  private async initClient(
    options?: Partial<Omit<ConstructorParameters<typeof OpenAI>[0], "baseURL">>,
  ): Promise<OpenAI> {
    return this.createOpenAIClient(options);
  }

  private async createOpenAIClient(
    options: Partial<
      Omit<ConstructorParameters<typeof OpenAI>[0], "baseURL">
    > = {},
  ): Promise<OpenAI> {
    // Verify the enclave before establishing a transport
    const verifier = new Verifier({
      serverURL: this.baseURL,
      configRepo: this.configRepo,
    });

    try {
      await verifier.verify();
      this.verificationDocument = verifier.getVerificationDocument();
      if (!this.verificationDocument) {
        throw new Error("Verification document not available after successful verification");
      }
    } catch (error) {
      throw new Error(`Failed to verify enclave: ${error}`);
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

    const clientOptions: ConstructorParameters<typeof OpenAI>[0] = {
      ...options,
      baseURL: this.baseURL,
      fetch: fetchFunction,
    };

    // Enable dangerouslyAllowBrowser in Node.js with WASM (which makes OpenAI SDK think we're in a browser)
    // OR if explicitly set by the user (for legitimate browser usage like playgrounds)
    if (!isRealBrowser() || (options as any).dangerouslyAllowBrowser === true) {
      clientOptions.dangerouslyAllowBrowser = true;
    }

    return new OpenAI(clientOptions);
  }

  /**
   * Helper method to ensure the OpenAI client is initialized before use.
   * Automatically calls ready() if needed.
   * @returns The initialized OpenAI client
   * @private
   */
  private async ensureReady(): Promise<OpenAI> {
    await this.ready();
    // We can safely assert this now because ready() must have completed
    return this.client!;
  }

  /**
   * Returns the full verification document produced during client initialization.
   */
  public async getVerificationDocument(): Promise<VerificationDocument> {
    await this.ready();
    if (!this.verificationDocument) {
      throw new Error("Verification document unavailable: client not verified yet");
    }
    return this.verificationDocument;
  }

  /**
   * Access to OpenAI's chat completions API for creating chat conversations.
   * Automatically initializes the client if needed.
   */
  get chat(): Chat {
    return createAsyncProxy(this.ensureReady().then((client) => client.chat));
  }

  /**
   * Access to OpenAI's files API for managing files used with the API.
   * Automatically initializes the client if needed.
   */
  get files(): Files {
    return createAsyncProxy(this.ensureReady().then((client) => client.files));
  }

  /**
   * Access to OpenAI's fine-tuning API for creating and managing fine-tuned models.
   * Automatically initializes the client if needed.
   */
  get fineTuning(): FineTuning {
    return createAsyncProxy(
      this.ensureReady().then((client) => client.fineTuning),
    );
  }

  /**
   * Access to OpenAI's image generation and editing API.
   * Automatically initializes the client if needed.
   */
  get images(): Images {
    return createAsyncProxy(this.ensureReady().then((client) => client.images));
  }

  /**
   * Access to OpenAI's audio API for speech-to-text and text-to-speech.
   * Automatically initializes the client if needed.
   */
  get audio(): Audio {
    return createAsyncProxy(this.ensureReady().then((client) => client.audio));
  }

  /**
   * Access to the Responses API, supporting response creation, streaming, and parsing.
   * Automatically initializes the client if needed.
   */
  get responses(): Responses {
    return createAsyncProxy(
      this.ensureReady().then((client) => client.responses),
    );
  }

  /**
   * Access to OpenAI's embeddings API for creating vector embeddings of text.
   * Automatically initializes the client if needed.
   */
  get embeddings(): Embeddings {
    return createAsyncProxy(
      this.ensureReady().then((client) => client.embeddings),
    );
  }

  /**
   * Access to OpenAI's models API for listing and managing available models.
   * Automatically initializes the client if needed.
   */
  get models(): Models {
    return createAsyncProxy(this.ensureReady().then((client) => client.models));
  }

  /**
   * Access to OpenAI's content moderation API.
   * Automatically initializes the client if needed.
   */
  get moderations(): Moderations {
    return createAsyncProxy(
      this.ensureReady().then((client) => client.moderations),
    );
  }

  /**
   * Access to OpenAI's beta features.
   * Automatically initializes the client if needed.
   */
  get beta(): Beta {
    return createAsyncProxy(this.ensureReady().then((client) => client.beta));
  }
}

// Namespace declaration merge to add OpenAI types to TinfoilAI
export namespace TinfoilAI {
  // Re-export all OpenAI namespace types
  export import Chat = OpenAI.Chat;
  export import Audio = OpenAI.Audio;
  export import Beta = OpenAI.Beta;
  export import Batches = OpenAI.Batches;
  export import Completions = OpenAI.Completions;
  export import Embeddings = OpenAI.Embeddings;
  export import Files = OpenAI.Files;
  export import FineTuning = OpenAI.FineTuning;
  export import Images = OpenAI.Images;
  export import Models = OpenAI.Models;
  export import Moderations = OpenAI.Moderations;
  export import Responses = OpenAI.Responses;
  export import Uploads = OpenAI.Uploads;
  export import VectorStores = OpenAI.VectorStores;
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
