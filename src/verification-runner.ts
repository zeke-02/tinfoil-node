import { Verifier, compareMeasurements, suppressWasmLogs } from "./verifier";
import type { AttestationMeasurement } from "./verifier";
import { TINFOIL_CONFIG } from "./config";

/**
 * Step status for verification progress
 */
export type StepStatus = "pending" | "loading" | "success" | "error";

/**
 * State for individual verification steps
 */
export interface StepState {
  status: StepStatus;
  measurement?: AttestationMeasurement;
  error?: string;
}

/**
 * Runtime verification state with additional key information
 */
export interface RuntimeStepState extends StepState {
  tlsPublicKeyFingerprint?: string;
  hpkePublicKey?: string;
}

/**
 * Final verification summary
 */
export interface VerificationSummary {
  status: StepStatus;
  securityVerified?: boolean;
  error?: string;
}

/**
 * Overall verification state
 */
export interface VerificationState {
  releaseDigest: string;
  runtime: RuntimeStepState;
  code: StepState;
  verification: VerificationSummary;
}

/**
 * Verification result returned by runVerification
 */
export interface VerificationResult extends VerificationState {}

/**
 * Options for runVerification method
 */
export interface RunVerificationOptions {
  /** GitHub repository to verify. Defaults to TINFOIL_CONFIG.INFERENCE_PROXY_REPO */
  configRepo?: string;
  /** Enclave hostname to verify. Defaults to hostname from TINFOIL_CONFIG.INFERENCE_BASE_URL */
  serverURL?: string;
  /** Specific release digest to verify. If not provided, fetches latest release digest */
  releaseDigest?: string;
  /** Callback for receiving verification state updates */
  onUpdate?: (state: VerificationState) => void;
}

/**
 * Enhanced verifier with state management and subscription support
 */
export class VerifierWithState extends Verifier {
  // State management
  private state: VerificationState = {
    releaseDigest: "",
    runtime: { status: "pending" },
    code: { status: "pending" },
    verification: { status: "pending" },
  };
  
  // Subscribers
  private subscribers: Set<(state: VerificationState) => void> = new Set();
  
  // Static cache for deduplicating verifications
  private static runnerVerificationCache = new Map<string, Promise<VerificationResult>>();
  
  /**
   * Clear the verification cache
   */
  public static clearVerificationCache(): void {
    VerifierWithState.runnerVerificationCache.clear();
  }

  /**
   * Subscribe to verification state updates
   * @param subscriber - Callback function to receive state updates
   * @returns Unsubscribe function
   */
  public subscribe(subscriber: (state: VerificationState) => void): () => void {
    this.subscribers.add(subscriber);
    // Send current state immediately
    subscriber(this.state);
    
    return () => {
      this.subscribers.delete(subscriber);
    };
  }
  
  /**
   * Update state and notify subscribers
   */
  private updateState(updates: Partial<VerificationState>): void {
    this.state = { ...this.state, ...updates };
    this.subscribers.forEach(subscriber => subscriber(this.state));
  }
  
  /**
   * Update a specific step state
   */
  private updateStepState<K extends keyof VerificationState>(
    step: K,
    updates: Partial<VerificationState[K]>
  ): void {
    this.state = {
      ...this.state,
      [step]: { ...this.state[step] as any, ...updates } as VerificationState[K]
    } as VerificationState;
    this.subscribers.forEach(subscriber => subscriber(this.state));
  }

  /**
   * Run full verification flow with state updates
   * @param options - Verification options
   * @returns Final verification result
   */
  public async runVerification(options?: RunVerificationOptions): Promise<VerificationResult> {
    const configRepo = options?.configRepo || TINFOIL_CONFIG.INFERENCE_PROXY_REPO;
    const enclaveURL = options?.serverURL || new URL(TINFOIL_CONFIG.INFERENCE_BASE_URL).hostname;
    let releaseDigest = options?.releaseDigest || "";
    
    // If no digest provided, we need to fetch it first before checking cache
    if (!releaseDigest) {
      // Reset state for fresh verification
      this.updateState({
        releaseDigest: "resolving...",
        runtime: { status: "pending" },
        code: { status: "pending" },
        verification: { status: "pending" },
      });
      
      try {
        releaseDigest = await this.fetchLatestDigest(configRepo);
        this.updateState({ releaseDigest: releaseDigest });
      } catch (error) {
        // If we can't fetch the digest, mark all steps as error
        this.updateState({ releaseDigest: "" });
        this.updateStepState("code", {
          status: "error",
          error: error instanceof Error ? error.message : "Failed to fetch digest",
        });
        this.updateStepState("runtime", {
          status: "error",
          error: "Cannot proceed without digest",
        });
        this.updateStepState("verification", {
          status: "error",
          error: "Cannot proceed without digest",
        });
        return this.state;
      }
    }
    
    // Now we have a digest, check cache
    const cacheKey = `${configRepo}::${enclaveURL}::${releaseDigest}`;
    const cachedPromise = VerifierWithState.runnerVerificationCache.get(cacheKey);
    
    if (cachedPromise) {
      // Reuse cached promise, but publish state updates for this instance
      if (options?.onUpdate) {
        const unsubscribe = this.subscribe(options.onUpdate);
        
        // Get the cached result and update this instance's state to match
        cachedPromise.then(cachedResult => {
          // Update this instance's state to match the cached result
          this.updateState(cachedResult);
        }).finally(() => unsubscribe());
      }
      return cachedPromise;
    }
    
    // No cached result, create new verification promise
    const verificationPromise = this._runVerificationInternal(configRepo, enclaveURL, releaseDigest)
      .then(result => {
        // Successful verification stays in cache
        return result;
      })
      .catch(error => {
        // On error, evict from cache
        VerifierWithState.runnerVerificationCache.delete(cacheKey);
        throw error;
      });
    
    // Store in cache
    VerifierWithState.runnerVerificationCache.set(cacheKey, verificationPromise);
    
    // Handle updates if requested
    if (options?.onUpdate) {
      const unsubscribe = this.subscribe(options.onUpdate);
      verificationPromise.finally(() => unsubscribe());
    }
    
    return verificationPromise;
  }
  
  private async _runVerificationInternal(configRepo: string, enclaveURL: string, releaseDigest: string): Promise<VerificationResult> {
    try {
      // Reset state for this verification
      this.updateState({
        releaseDigest: releaseDigest,
        runtime: { status: "pending" },
        code: { status: "pending" },
        verification: { status: "pending" },
      });
      
      // Step 2: Runtime attestation
      this.updateStepState("runtime", { status: "loading" });
      try {
        const runtimeResult = await this.verifyEnclave(enclaveURL);
        this.updateStepState("runtime", {
          status: "success",
          measurement: runtimeResult.measurement,
          tlsPublicKeyFingerprint: runtimeResult.tlsPublicKeyFingerprint,
          hpkePublicKey: runtimeResult.hpkePublicKey,
        });
      } catch (error) {
        this.updateStepState("runtime", {
          status: "error",
          error: error instanceof Error ? error.message : "Runtime attestation failed",
        });
        this.updateStepState("verification", {
          status: "error",
          error: "Cannot verify security without runtime attestation",
        });
        return this.state;
      }
      
      // Step 3: Code attestation
      this.updateStepState("code", { status: "loading" });
      try {
        const codeResult = await this.verifyCode(configRepo, releaseDigest);
        this.updateStepState("code", {
          status: "success",
          measurement: codeResult.measurement,
        });
      } catch (error) {
        this.updateStepState("code", {
          status: "error",
          error: error instanceof Error ? error.message : "Code attestation failed",
        });
        this.updateStepState("verification", {
          status: "error",
          error: "Cannot verify security without code attestation",
        });
        return this.state;
      }

      // Step 4: Compare measurements
      this.updateStepState("verification", { status: "loading" });
      const codeMeasurement = this.state.code.measurement!;
      const runtimeMeasurement = this.state.runtime.measurement!;

      // Use the compareMeasurements function
      const measurementsMatch = compareMeasurements(codeMeasurement, runtimeMeasurement);

      this.updateStepState("verification", {
        status: "success",
        securityVerified: measurementsMatch,
      });
      
      return this.state;
      
    } catch (error) {
      // Catch any unexpected errors
      if (this.state.verification.status === "pending" || this.state.verification.status === "loading") {
        this.updateStepState("verification", {
          status: "error",
          error: error instanceof Error ? error.message : "Verification failed",
        });
      }
      return this.state;
    }
  }
}

/**
 * Load and initialize a verifier instance with state management
 * @returns Initialized verifier instance with state management
 */
export async function loadVerifier(): Promise<VerifierWithState> {
  // Ensure WASM is initialized with the default runtime
  await Verifier.initializeWasm();

  // Return a new verifier instance with state management
  return new VerifierWithState();
}

// Re-export utilities
export { suppressWasmLogs, TINFOIL_CONFIG };

/**
 * Clear the verification cache
 */
export function clearVerificationCache(): void {
  VerifierWithState.clearVerificationCache();
}
