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
import { SecureClient } from "./secure-client.browser";
import type { VerificationDocument } from "./verifier";
import { TINFOIL_CONFIG } from "./config";

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
  hpkeKeyURL?: string;
  configRepo?: string;
  [key: string]: any;
}

export class TinfoilAI {
  private client?: OpenAI;
  private clientPromise: Promise<OpenAI>;
  private readyPromise?: Promise<void>;
  private configRepo?: string;
  private secureClient: SecureClient;
  private verificationDocument?: VerificationDocument;

  public apiKey?: string;
  public baseURL?: string;
  public hpkeKeyURL?: string;

  constructor(options: TinfoilAIOptions = {}) {
    const openAIOptions = { ...options };
    // In browser builds, never read secrets from process.env to avoid
    // leaking credentials into client bundles. Require explicit apiKey.
    if (typeof options.apiKey === "string") {
      openAIOptions.apiKey = options.apiKey;
    }

    this.apiKey = openAIOptions.apiKey;
    this.baseURL = options.baseURL || TINFOIL_CONFIG.INFERENCE_BASE_URL;
    this.hpkeKeyURL = options.hpkeKeyURL || TINFOIL_CONFIG.HPKE_KEY_URL;
    this.configRepo = options.configRepo || TINFOIL_CONFIG.INFERENCE_PROXY_REPO;

    // Create the secure client for handling transport security
    this.secureClient = new SecureClient({
      baseURL: this.baseURL,
      hpkeKeyURL: this.hpkeKeyURL,
      configRepo: this.configRepo,
    });

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
    await this.secureClient.ready();
    
    this.verificationDocument = await this.secureClient.getVerificationDocument();
    if (!this.verificationDocument) {
      throw new Error("Verification document not available after successful verification");
    }

    const clientOptions: ConstructorParameters<typeof OpenAI>[0] = {
      ...options,
      baseURL: this.baseURL,
      fetch: this.secureClient.fetch,
    };

    // In browser usage, OpenAI SDK typically needs dangerouslyAllowBrowser
    clientOptions.dangerouslyAllowBrowser = true;

    return new OpenAI(clientOptions);
  }

  private async ensureReady(): Promise<OpenAI> {
    await this.ready();
    return this.client!;
  }

  public async getVerificationDocument(): Promise<VerificationDocument> {
    await this.ready();
    if (!this.verificationDocument) {
      throw new Error("Verification document unavailable: client not verified yet");
    }
    return this.verificationDocument;
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