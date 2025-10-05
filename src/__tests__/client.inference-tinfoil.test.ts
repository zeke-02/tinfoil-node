import { describe, it } from "node:test";
import assert from "node:assert";

const RUN_INTEGRATION = process.env.RUN_TINFOIL_INTEGRATION === "true";
const SKIP_MESSAGE = "Set RUN_TINFOIL_INTEGRATION=true to enable network integration tests.";

console.log("- RUN_TINFOIL_INTEGRATION:", process.env.RUN_TINFOIL_INTEGRATION);

describe("TinfoilAI - inference.tinfoil.sh integration", () => {
  it("should verify enclave with confidential-inference-proxy repo", async (t) => {
    if (!RUN_INTEGRATION) {
      t.skip(SKIP_MESSAGE);
      return;
    }

    const { TinfoilAI } = await import("../tinfoilai");
    const API_KEY = process.env.TINFOIL_API_KEY || process.env.OPENAI_API_KEY;
    if (!API_KEY) {
      t.skip("Set TINFOIL_API_KEY or OPENAI_API_KEY for integration test.");
      return;
    }
    
    const client = new TinfoilAI({
      apiKey: API_KEY,
      baseURL: "https://ehbp.inf6.tinfoil.sh/v1/",
      enclaveURL: "https://ehbp.inf6.tinfoil.sh/v1/",
      configRepo: "tinfoilsh/confidential-inference-proxy-hpke",
    });

    try {
      await client.ready();

      // Get the verification document to ensure verification happened
      const verificationDoc = await client.getVerificationDocument();
      
      assert.ok(verificationDoc, "Verification document should be available");
      // Fixed the assertion to match what we're actually setting
      assert.strictEqual(verificationDoc.configRepo, "tinfoilsh/confidential-inference-proxy-hpke", "Should use confidential-inference-proxy-hpke repo");
      assert.ok(verificationDoc.securityVerified, "Security should be verified");
      
      // TLS fingerprint should always be available
      assert.ok(verificationDoc.enclaveMeasurement.tlsPublicKeyFingerprint, "TLS public key fingerprint should be available");
      
    } catch (error) {
      console.error("Test failed with error:", error);
      throw error;
    }
  });
});