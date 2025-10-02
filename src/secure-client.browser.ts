import { Verifier } from "./verifier";
import { createEncryptedBodyFetch } from "./encrypted-body-fetch";
import { TINFOIL_CONFIG } from "./config";
import { isRealBrowser } from "./env";

/**
 * Options for configuring the secure fetch client
 */
export interface SecureFetchOptions {
  /** Override the inference API base URL */
  baseURL?: string;
  /** Override the URL used to fetch the HPKE key */
  hpkeKeyURL?: string;
  /** Override the config GitHub repository */
  configRepo?: string;
}

/**
 * Creates a secure fetch function that automatically handles enclave attestation
 * and encrypted transport.
 * 
 * @param apiKey - The API key for the Tinfoil API
 * @param options - Optional configuration options
 * @returns A fetch function with the same interface as the standard fetch API
 * 
 * @example
 * const secureFetch = await createSecureFetch('your-api-key');
 * const response = await secureFetch('/chat/completions', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ messages: [...] })
 * });
 */
export async function createSecureFetch(
  apiKey: string,
  options: SecureFetchOptions = {}
): Promise&lt;typeof fetch&gt; {
  const baseURL = options.baseURL || TINFOIL_CONFIG.INFERENCE_BASE_URL;
  const hpkeKeyURL = options.hpkeKeyURL || TINFOIL_CONFIG.HPKE_KEY_URL;
  const configRepo = options.configRepo || TINFOIL_CONFIG.INFERENCE_PROXY_REPO;

  // Step 1: Verify the enclave and extract the public keys
  const verifier = new Verifier({ serverURL: baseURL, configRepo });
  const attestationResponse = await verifier.verify();
  const hpkePublicKey = attestationResponse.hpkePublicKey;

  // In browsers we require HPKE; TLS pinning fallback is Node-only
  if (!hpkePublicKey) {
    if (isRealBrowser()) {
      throw new Error(
        "HPKE public key not available and TLS-only verification is not supported in browsers. " +
        "Only HPKE-enabled enclaves can be used in browser environments."
      );
    }
    throw new Error("HPKE public key is required in browser environments");
  }

  // Step 2: Create the encrypted body fetch function
  const fetchFunction = createEncryptedBodyFetch(baseURL, hpkePublicKey, hpkeKeyURL);

  // Return a wrapped fetch function that includes the API key
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers || {});
    headers.set("Authorization", `Bearer ${apiKey}`);
    
    const newInit = {
      ...init,
      headers
    };
    
    return fetchFunction(input, newInit);
  };
}