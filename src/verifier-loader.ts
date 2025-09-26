import { Verifier, compareMeasurements, AttestationMeasurement, suppressWasmLogs } from "./verifier";
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
 * Security verification state
 */
export interface SecurityStepState {
  status: StepStatus;
  match?: boolean;
  error?: string;
}

/**
 * Overall verification state
 */
export interface VerificationState {
  digest: string;
  runtime: RuntimeStepState;
  code: StepState;
  security: SecurityStepState;
}

/**
 * Verification result returned by runVerification
 */
export interface VerificationResult extends VerificationState {}

/**
 * Options for runVerification method
 */
export interface RunVerificationOptions {
  repo?: string;
  enclaveHost?: string;
  digest?: string;
  onUpdate?: (state: VerificationState) => void;
}

/**
 * Enhanced verifier with state management and subscription support
 */
export class VerifierWithState extends Verifier {
  // State management
  private state: VerificationState = {
    digest: "",
    runtime: { status: "pending" },
    code: { status: "pending" },
    security: { status: "pending" },
  };
  
  // Subscribers
  private subscribers: Set<(state: VerificationState) => void> = new Set();

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
    const repo = options?.repo || TINFOIL_CONFIG.INFERENCE_PROXY_REPO;
    const enclaveHost = options?.enclaveHost || new URL(TINFOIL_CONFIG.INFERENCE_BASE_URL).hostname;
    let digest = options?.digest || "";
    
    // Reset state
    this.updateState({
      digest: "",
      runtime: { status: "pending" },
      code: { status: "pending" },
      security: { status: "pending" },
    });
    
    // Notify onUpdate callback if provided
    if (options?.onUpdate) {
      const unsubscribe = this.subscribe(options.onUpdate);
      // Clean up after completion
      const originalPromise = this._runVerificationInternal(repo, enclaveHost, digest);
      originalPromise.finally(() => unsubscribe());
      return originalPromise;
    }
    
    return this._runVerificationInternal(repo, enclaveHost, digest);
  }
  
  private async _runVerificationInternal(repo: string, enclaveHost: string, digest: string): Promise<VerificationResult> {
    try {
      // Step 1: Fetch digest if not provided
      if (!digest) {
        this.updateState({ digest: "resolving..." });
        try {
          digest = await this.fetchLatestDigest(repo);
          this.updateState({ digest });
        } catch (error) {
          // If we can't fetch the digest, mark all steps as error
          this.updateState({ digest: "" }); // Reset digest to empty
          this.updateStepState("code", {
            status: "error",
            error: error instanceof Error ? error.message : "Failed to fetch digest",
          });
          this.updateStepState("runtime", {
            status: "error",
            error: "Cannot proceed without digest",
          });
          this.updateStepState("security", {
            status: "error",
            error: "Cannot proceed without digest",
          });
          return this.state;
        }
      }
      
      // Step 2: Runtime attestation
      this.updateStepState("runtime", { status: "loading" });
      try {
        const runtimeResult = await this.verifyEnclave(enclaveHost);
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
        this.updateStepState("security", {
          status: "error",
          error: "Cannot verify security without runtime attestation",
        });
        return this.state;
      }
      
      // Step 3: Code attestation
      this.updateStepState("code", { status: "loading" });
      try {
        const codeResult = await this.verifyCode(repo, digest);
        this.updateStepState("code", {
          status: "success",
          measurement: codeResult.measurement,
        });
      } catch (error) {
        this.updateStepState("code", {
          status: "error",
          error: error instanceof Error ? error.message : "Code attestation failed",
        });
        this.updateStepState("security", {
          status: "error",
          error: "Cannot verify security without code attestation",
        });
        return this.state;
      }
      
      // Step 4: Compare measurements
      this.updateStepState("security", { status: "loading" });
      const codeMeasurement = this.state.code.measurement!;
      const runtimeMeasurement = this.state.runtime.measurement!;
      
      // Use the compareMeasurements function
      const measurementsMatch = compareMeasurements(codeMeasurement, runtimeMeasurement);
      
      this.updateStepState("security", {
        status: "success",
        match: measurementsMatch,
      });
      
      return this.state;
      
    } catch (error) {
      // Catch any unexpected errors
      if (this.state.security.status === "pending" || this.state.security.status === "loading") {
        this.updateStepState("security", {
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
 * @param wasmUrl - Optional custom WASM URL (defaults to https://tinfoilsh.github.io/verifier-js/tinfoil-verifier.wasm)
 * @returns Initialized verifier instance with state management
 */
export async function loadVerifier(wasmUrl?: string): Promise<VerifierWithState> {
  // Initialize WASM if custom URL provided
  if (wasmUrl) {
    // For now, we can't easily support custom WASM URLs with the static initialization
    // This would require refactoring the static initialization approach
    console.warn("Custom WASM URLs are not yet supported. Using default WASM URL.");
  }
  
  // Ensure WASM is initialized
  await Verifier.initializeWasm();
  
  // Return a new verifier instance with state management
  return new VerifierWithState();
}

// Re-export utilities
export { suppressWasmLogs, TINFOIL_CONFIG };
