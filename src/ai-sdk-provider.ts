import { streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { SecureClient } from "./secure-client";
import { TINFOIL_CONFIG } from "./config";

import {
  Agent,
  buildConnector,
  RequestInit,
  fetch as undiciFetch,
} from "undici";
import tls, { checkServerIdentity as tlsCheckServerIdentity } from "node:tls";
import { X509Certificate, createHash } from "node:crypto";

/**
 * Creates an AI SDK provider with the specified API key.
 *
 * @param apiKey - The API key for the Tinfoil API
 * @returns A TinfoilAI instance
 */
export async function createTinfoilAI(apiKey: string) {
  const sc = new SecureClient();
  const groundTruth = await sc.verify();

  const connect = buildConnector({
    checkServerIdentity: (
      host: string,
      cert: tls.PeerCertificate,
    ): Error | undefined => {
      if (!cert.pubkey) {
        throw new Error("No public key available in certificate");
      }
      const x509 = new X509Certificate(cert.raw);
      const publicKeyDer = x509.publicKey.export({
        type: "spki",
        format: "der",
      });
      const pubKeyFP = createHash("sha256").update(publicKeyDer).digest("hex");
      if (pubKeyFP !== groundTruth.publicKeyFP) {
        throw new Error(
          `Certificate public key fingerprint mismatch. Expected: ${groundTruth.publicKeyFP}, Got: ${pubKeyFP}`,
        );
      }

      return tlsCheckServerIdentity(host, cert);
    },
  });

  const agent = new Agent({ connect });

  return createOpenAICompatible({
    name: "tinfoil",
    baseURL: TINFOIL_CONFIG.INFERENCE_BASE_URL.replace(/\/$/, ""),
    apiKey: apiKey,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!init) {
        init = {};
      }
      init.dispatcher = agent;
      return await undiciFetch(input as any, init);
    }) as unknown as typeof fetch,
  });
}
