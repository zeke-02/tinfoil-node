import { TINFOIL_CONFIG } from "./config";
import { createEncryptedBodyFetch } from "./encrypted-body-fetch";
import { fetchRouter } from "./router";

interface UnverifiedClientOptions {
  baseURL?: string;
  enclaveURL?: string;
  configRepo?: string;
}

export class UnverifiedClient {
  private initPromise: Promise<void> | null = null;
  private _fetch: typeof fetch | null = null;
  
  private baseURL?: string;
  private enclaveURL?: string;
  private readonly configRepo: string;

  constructor(options: UnverifiedClientOptions = {}) {
    this.baseURL = options.baseURL;
    this.enclaveURL = options.enclaveURL;
    this.configRepo = options.configRepo || TINFOIL_CONFIG.INFERENCE_PROXY_REPO;
  }

  public async ready(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initUnverifiedClient();
    }
    return this.initPromise;
  }

  private async initUnverifiedClient(): Promise<void> {
    // Fetch router if no enclaveURL is provided
    if (!this.enclaveURL) {
      const routerAddress = await fetchRouter();
      this.enclaveURL = `https://${routerAddress}`;
      this.baseURL = this.baseURL || `https://${routerAddress}/v1/`;
    }

    this._fetch = createEncryptedBodyFetch(this.baseURL!, undefined, this.enclaveURL);
  }

  public async getVerificationDocument(): Promise<void> {
    if (!this.initPromise) {
      await this.ready();
    }
    
    await this.initPromise;

    throw new Error("Verification document unavailable: this version of the client is unverified");
  }

  get fetch(): typeof fetch {
    return async (input: RequestInfo | URL, init?: RequestInit) => {
      await this.ready();
      return this._fetch!(input, init);
    };
  }
}