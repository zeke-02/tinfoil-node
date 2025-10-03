import { Verifier } from "./verifier";
import type { VerificationDocument } from "./verifier";
import { TINFOIL_CONFIG } from "./config";
import { createEncryptedBodyFetch } from "./encrypted-body-fetch";
import { isRealBrowser } from "./env";

interface SecureClientOptions {
  baseURL?: string;
  hpkeKeyURL?: string;
  configRepo?: string;
}

export class SecureClient {
  private initPromise: Promise<void> | null = null;
  private verificationDocument: VerificationDocument | null = null;
  private _fetch: typeof fetch | null = null;
  
  private readonly baseURL?: string;
  private readonly hpkeKeyURL?: string;
  private readonly configRepo?: string;

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
      serverURL: this.hpkeKeyURL,
      configRepo: this.configRepo,
    });

    await verifier.verify();
    const doc = verifier.getVerificationDocument();
    if (!doc) {
      throw new Error("Verification document not available after successful verification");
    }
    this.verificationDocument = doc;

    const hpkePublicKey = this.verificationDocument.enclaveMeasurement.hpkePublicKey;
    if (!hpkePublicKey) {
      if (isRealBrowser()) {
        throw new Error(
          "HPKE public key not available and TLS-only verification is not supported in browsers. " +
          "Only HPKE-enabled enclaves can be used in browser environments."
        );
      }
      throw new Error("HPKE public key is required in browser environments");
    }

    this._fetch = createEncryptedBodyFetch(this.baseURL!, hpkePublicKey, this.hpkeKeyURL);
  }

  public async getVerificationDocument(): Promise<VerificationDocument> {
    if (!this.initPromise) {
      await this.ready();
    }
    
    await this.initPromise;
    
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