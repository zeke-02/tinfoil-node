import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { TINFOIL_CONFIG } from "./config";
import { createEncryptedBodyFetch } from "./encrypted-body-fetch";
import { Verifier } from "./verifier";

/**
 * Creates an AI SDK provider with the specified API key.
 *
 * @param apiKey - The API key for the Tinfoil API
 * @returns A TinfoilAI instance
 */
export async function createTinfoilAI(apiKey: string) {

  // step 1: verify the enclave and extract the hpke public key
  // from the attestation response
  const verifier = new Verifier();
  const attestationResponse = await verifier.verify();
  const hpkePublicKey = attestationResponse.hpkePublicKey;

  // step 2: create an encrypted body fetch function
  // that uses the hpke public key to encrypt the http body of the request
  const encryptedBodyFetch = createEncryptedBodyFetch(TINFOIL_CONFIG.INFERENCE_BASE_URL, hpkePublicKey);

  // step 3: create the openai compatible provider
  // that uses the encrypted body fetch function
  return createOpenAICompatible({
    name: "tinfoil",
    baseURL: TINFOIL_CONFIG.INFERENCE_BASE_URL.replace(/\/$/, ""),
    apiKey: apiKey,
    fetch: encryptedBodyFetch,
  });
}
