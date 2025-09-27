import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { TINFOIL_CONFIG } from "./config";
import { createAttestedFetch } from "./attested-fetch";
import { Verifier } from "./verifier";

/**
 * Creates an AI SDK provider with the specified API key.
 *
 * @param apiKey - The API key for the Tinfoil API
 * @returns A TinfoilAI instance
 */
export async function createTinfoilAI(apiKey: string) {
  const verifier = new Verifier();
  const attestationResponse = await verifier.verify();
  const hpkePublicKey = attestationResponse.hpkePublicKey;

  const attestedFetch = createAttestedFetch(TINFOIL_CONFIG.INFERENCE_BASE_URL, hpkePublicKey);

  return createOpenAICompatible({
    name: "tinfoil",
    baseURL: TINFOIL_CONFIG.INFERENCE_BASE_URL.replace(/\/$/, ""),
    apiKey: apiKey,
    fetch: attestedFetch,
  });
}
