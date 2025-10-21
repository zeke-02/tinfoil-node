import { Verifier } from "./verifier";
import type { VerificationDocument } from "./verifier";
import { TINFOIL_CONFIG } from "./config";
import { createSecureFetch } from "./secure-fetch";

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

    try {
      await verifier.verify();
      const doc = verifier.getVerificationDocument();
      if (!doc) {
        throw new Error(
          "Verification document not available after successful verification"
        );
      }
      this.verificationDocument = doc;

      // Extract keys from the verification document
      const { hpkePublicKey, tlsPublicKeyFingerprint } =
        this.verificationDocument.enclaveMeasurement;

      try {
        this._fetch = createSecureFetch(
          this.baseURL!,
          this.enclaveURL,
          hpkePublicKey,
          tlsPublicKeyFingerprint
        );
      } catch (transportError) {
        this.verificationDocument.steps.createTransport = {
          status: "failed",
          error: (transportError as Error).message,
        };
        this.verificationDocument.securityVerified = false;
        throw transportError;
      }
    } catch (error) {
      const doc = verifier.getVerificationDocument();
      if (doc) {
        this.verificationDocument = doc;
      } else {
        this.verificationDocument = {
          configRepo: this.configRepo!,
          enclaveHost: new URL(this.enclaveURL!).hostname,
          releaseDigest: "",
          codeMeasurement: { type: "", registers: [] },
          enclaveMeasurement: { measurement: { type: "", registers: [] } },
          securityVerified: false,
          steps: {
            fetchDigest: { status: "pending" },
            verifyCode: { status: "pending" },
            verifyEnclave: { status: "pending" },
            compareMeasurements: { status: "pending" },
            otherError: { status: "failed", error: (error as Error).message },
          },
        };
      }
      throw error;
    }
  }

  public async getVerificationDocument(): Promise<VerificationDocument> {
    if (!this.initPromise) {
      await this.ready();
    }

    await this.initPromise!.catch(() => {});

    if (!this.verificationDocument) {
      throw new Error(
        "Verification document unavailable: client not verified yet"
      );
    }
    return this.verificationDocument;
  }

  get fetch(): typeof fetch {
    return async (input: RequestInfo | URL, init?: RequestInit) => {
      await this.ready();

      try {
        return await this._fetch!(input, init);
      } catch (error) {
        if (this.verificationDocument) {
          const errorMessage = (error as Error).message;

          if (errorMessage.includes("HPKE public key mismatch")) {
            this.verificationDocument.steps.verifyHPKEKey = {
              status: "failed",
              error: errorMessage,
            };
            this.verificationDocument.securityVerified = false;
          } else if (
            errorMessage.includes("Transport initialization failed") ||
            errorMessage.includes("Request initialization failed")
          ) {
            this.verificationDocument.steps.createTransport = {
              status: "failed",
              error: errorMessage,
            };
            this.verificationDocument.securityVerified = false;
          } else if (errorMessage.includes("Failed to get HPKE key")) {
            this.verificationDocument.steps.verifyHPKEKey = {
              status: "failed",
              error: errorMessage,
            };
            this.verificationDocument.securityVerified = false;
          } else {
            this.verificationDocument.steps.otherError = {
              status: "failed",
              error: errorMessage,
            };
            this.verificationDocument.securityVerified = false;
          }
        }

        throw error;
      }
    };
  }
}
