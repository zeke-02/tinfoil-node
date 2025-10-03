import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { TINFOIL_CONFIG } from "./config";
import { SecureClient } from "tinfoil/secure-client";

interface CreateTinfoilAIOptions {
  baseURL?: string;
  enclaveURL?: string;
  configRepo?: string;
}

export async function createTinfoilAI(apiKey: string, options: CreateTinfoilAIOptions = {}) {
  const baseURL = options.baseURL || TINFOIL_CONFIG.INFERENCE_BASE_URL;
  const enclaveURL = options.enclaveURL || TINFOIL_CONFIG.ENCLAVE_URL;
  const configRepo = options.configRepo || TINFOIL_CONFIG.INFERENCE_PROXY_REPO;

  const secureClient = new SecureClient({
    baseURL,
    enclaveURL,
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
