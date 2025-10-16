/**
 * Configuration constants for the Tinfoil Node SDK
 */
export const TINFOIL_CONFIG = {
  /**
   * The base URL for the Tinfoil router API
   */
  INFERENCE_BASE_URL: "https://router.inf6.tinfoil.sh/v1/",

  /**
   * The URL for enclave key discovery and attestation endpoints
   */
  ENCLAVE_URL: "https://router.inf6.tinfoil.sh",

  /**
   * The GitHub repository for code attestation verification
   */
  INFERENCE_PROXY_REPO: "tinfoilsh/confidential-model-router",
} as const;
