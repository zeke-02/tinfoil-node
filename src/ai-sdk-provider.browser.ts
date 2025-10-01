import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { TINFOIL_CONFIG } from "./config";
import { createEncryptedBodyFetch } from "./encrypted-body-fetch";
import { Verifier } from "./verifier";
import { isRealBrowser } from "./env";

interface CreateTinfoilAIOptions {
  baseURL?: string;
  configRepo?: string;
}

export async function createTinfoilAI(apiKey: string, options: CreateTinfoilAIOptions = {}) {
  const baseURL = options.baseURL || TINFOIL_CONFIG.INFERENCE_BASE_URL;
  const configRepo = options.configRepo || TINFOIL_CONFIG.INFERENCE_PROXY_REPO;

  assertHttpsUrl(baseURL, "Inference baseURL");

  const verifier = new Verifier({ serverURL: baseURL, configRepo });
  const attestationResponse = await verifier.verify();
  const hpkePublicKey = attestationResponse.hpkePublicKey;

  if (!hpkePublicKey) {
    if (isRealBrowser()) {
      throw new Error(
        "HPKE public key not available and TLS-only verification is not supported in browsers. " +
        "Only HPKE-enabled enclaves can be used in browser environments."
      );
    }
    throw new Error("HPKE public key is required in browser environments");
  }

  const fetchFunction = createEncryptedBodyFetch(baseURL, hpkePublicKey);

  return createOpenAICompatible({
    name: "tinfoil",
    baseURL: baseURL.replace(/\/$/, ""),
    apiKey: apiKey,
    fetch: fetchFunction,
  });
}

function assertHttpsUrl(url: string, context: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error(`${context} must use HTTPS. Got: ${url}`);
  }
}

