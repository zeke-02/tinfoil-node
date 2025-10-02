/**
 * Configuration constants for the Tinfoil Node SDK
 */
export const TINFOIL_CONFIG = {
  /**
   * The full base URL for the inference API
   */
  INFERENCE_BASE_URL: "https://inference.tinfoil.sh/v1/",

  /**
   * The URL used to fetch the HPKE server public key (via EHBP .well-known endpoint).
   * Defaults to the same value as `INFERENCE_BASE_URL` so hpkeKeyURL and baseURL share
   * the same default. Callers may override independently if key discovery is hosted elsewhere.
   */
  HPKE_KEY_URL: "https://inference.tinfoil.sh/v1/",

  /**
   * The GitHub repository for the confidential inference proxy
   */
  INFERENCE_PROXY_REPO: "tinfoilsh/confidential-inference-proxy",
} as const;
