/**
 * Configuration constants for the Tinfoil Node SDK
 */
export const TINFOIL_CONFIG = {
  /**
   * The full base URL for the inference API
   */
  INFERENCE_BASE_URL: "https://ehbp.inf6.tinfoil.sh/v1/",

  /**
   * The GitHub repository for the confidential inference proxy
   */
  INFERENCE_PROXY_REPO: "tinfoilsh/confidential-inference-proxy-hpke",
} as const;
