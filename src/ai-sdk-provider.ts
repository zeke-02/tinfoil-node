import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { TINFOIL_CONFIG } from "./config";
import { SecureClient } from "./secure-client";

interface CreateTinfoilAIOptions {
  /** Override the inference API base URL */
  baseURL?: string;
  /** Override the URL used to fetch the HPKE (defaults to baseURL) */
  hpkeKeyURL?: string;
  /** Override the config GitHub repository */
  configRepo?: string;
}

/**
 * Creates an AI SDK provider with the specified API key.
 *
 * @param apiKey - The API key for the Tinfoil API
 * @param options - Optional configuration options
 * @returns A TinfoilAI instance
 */
export async function createTinfoilAI(apiKey: string, options: CreateTinfoilAIOptions = {}) {
  const baseURL = options.baseURL || TINFOIL_CONFIG.INFERENCE_BASE_URL;
  const hpkeKeyURL = options.hpkeKeyURL || TINFOIL_CONFIG.HPKE_KEY_URL;
  const configRepo = options.configRepo || TINFOIL_CONFIG.INFERENCE_PROXY_REPO;

  const secureClient = new SecureClient({
    baseURL,
    hpkeKeyURL,
    configRepo,
  });

  await secureClient.ready();

  return createOpenAICompatible({
    name: "tinfoil",
    baseURL: baseURL.replace(/\/$/, ""),
    apiKey: apiKey,
    fetch: secureClient.fetch,
  });
}
