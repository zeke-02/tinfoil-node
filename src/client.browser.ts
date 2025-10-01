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
import type { VerificationDocument } from "./verifier";
import { TINFOIL_CONFIG } from "./config";
import { createEncryptedBodyFetch } from "./encrypted-body-fetch";
import { isRealBrowser } from "./env";

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

interface TinfoilAIOptions {
  apiKey?: string;
  baseURL?: string;
  configRepo?: string;
  [key: string]: any;
}

export class TinfoilAI {
  private client?: OpenAI;
  private clientPromise: Promise<OpenAI>;
  private readyPromise?: Promise<void>;
  private configRepo?: string;
  private verificationDocument?: VerificationDocument;

  public apiKey?: string;
  public baseURL?: string;

  constructor(options: TinfoilAIOptions = {}) {
    const openAIOptions = { ...options };
    // In browser builds, never read secrets from process.env to avoid
    // leaking credentials into client bundles. Require explicit apiKey.
    if (typeof options.apiKey === "string") {
      openAIOptions.apiKey = options.apiKey;
    }

    this.apiKey = openAIOptions.apiKey;
    this.baseURL = options.baseURL || TINFOIL_CONFIG.INFERENCE_BASE_URL;
    assertHttpsUrl(this.baseURL, "Inference baseURL");
    this.configRepo = options.configRepo || TINFOIL_CONFIG.INFERENCE_PROXY_REPO;

    this.clientPromise = this.initClient(openAIOptions);
  }

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
    if (!hpkePublicKey) {
      // In browsers we require HPKE; TLS pinning fallback is Node-only
      if (isRealBrowser()) {
        throw new Error(
          "HPKE public key not available and TLS-only verification is not supported in browsers. " +
          "Only HPKE-enabled enclaves can be used in browser environments."
        );
      }
      throw new Error("HPKE public key is required in browser environments");
    }

    const fetchFunction = createEncryptedBodyFetch(this.baseURL!, hpkePublicKey);

    const clientOptions: ConstructorParameters<typeof OpenAI>[0] = {
      ...options,
      baseURL: this.baseURL,
      fetch: fetchFunction,
    };

    // In browser usage, OpenAI SDK typically needs dangerouslyAllowBrowser
    clientOptions.dangerouslyAllowBrowser = true;

    return new OpenAI(clientOptions);
  }

  private async ensureReady(): Promise<OpenAI> {
    await this.ready();
    return this.client!;
  }

  get chat(): Chat {
    return createAsyncProxy(this.ensureReady().then((client) => client.chat));
  }
  get files(): Files {
    return createAsyncProxy(this.ensureReady().then((client) => client.files));
  }
  get fineTuning(): FineTuning {
    return createAsyncProxy(
      this.ensureReady().then((client) => client.fineTuning),
    );
  }
  get images(): Images {
    return createAsyncProxy(this.ensureReady().then((client) => client.images));
  }
  get audio(): Audio {
    return createAsyncProxy(this.ensureReady().then((client) => client.audio));
  }
  get responses(): Responses {
    return createAsyncProxy(
      this.ensureReady().then((client) => client.responses),
    );
  }
  get embeddings(): Embeddings {
    return createAsyncProxy(
      this.ensureReady().then((client) => client.embeddings),
    );
  }
  get models(): Models {
    return createAsyncProxy(this.ensureReady().then((client) => client.models));
  }
  get moderations(): Moderations {
    return createAsyncProxy(
      this.ensureReady().then((client) => client.moderations),
    );
  }
  get beta(): Beta {
    return createAsyncProxy(this.ensureReady().then((client) => client.beta));
  }
}

export namespace TinfoilAI {
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

function assertHttpsUrl(url: string, context: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error(`${context} must use HTTPS. Got: ${url}`);
  }
}
