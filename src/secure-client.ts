import { Verifier } from "./verifier";
import type { VerificationDocument } from "./verifier";
import { TINFOIL_CONFIG } from "./config";
import { createSecureFetch } from "tinfoil/secure-fetch";

interface SecureClientOptions {
  baseURL?: string;
  enclaveURL?: string;
  configRepo?: string;
}

export class SecureClient {
  private initPromise: Promise<void> | null = null;
  private verificationDocument: VerificationDocument | null = null;
  private _fetch: typeof fetch | null = null;
  
  private readonly baseURL?: string;
  private readonly enclaveURL?: string;
  private readonly configRepo?: string;

  constructor(options: SecureClientOptions = {}) {
    this.baseURL = options.baseURL || TINFOIL_CONFIG.INFERENCE_BASE_URL;
    this.enclaveURL = options.enclaveURL || TINFOIL_CONFIG.ENCLAVE_URL;
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
      serverURL: this.enclaveURL,
      configRepo: this.configRepo,
    });

    await verifier.verify();
    const doc = verifier.getVerificationDocument();
    if (!doc) {
      throw new Error("Verification document not available after successful verification");
    }
    this.verificationDocument = doc;

    // Extract keys from the verification document
    const { hpkePublicKey, tlsPublicKeyFingerprint } = this.verificationDocument.enclaveMeasurement;

    this._fetch = createSecureFetch(this.baseURL!, this.enclaveURL, hpkePublicKey, tlsPublicKeyFingerprint);
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