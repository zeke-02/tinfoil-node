import { describe, it } from "node:test";
import assert from "node:assert";

const RUN_INTEGRATION = process.env.RUN_TINFOIL_INTEGRATION === "true";
const SKIP_MESSAGE = "Set RUN_TINFOIL_INTEGRATION=true to enable network integration tests.";

console.log("Environment check:");
console.log("- RUN_TINFOIL_INTEGRATION:", process.env.RUN_TINFOIL_INTEGRATION);
console.log("- TINFOIL_API_KEY present:", !!process.env.TINFOIL_API_KEY);

describe("TinfoilAI - inference.tinfoil.sh integration", () => {
  it("should verify enclave with confidential-inference-proxy repo", async (t) => {
    console.log("Inside test - RUN_INTEGRATION:", RUN_INTEGRATION);
    if (!RUN_INTEGRATION) {
      t.skip(SKIP_MESSAGE);
      return;
    }

    const { TinfoilAI } = await import("../client");
    const API_KEY = process.env.TINFOIL_API_KEY || process.env.OPENAI_API_KEY;
    console.log("API_KEY present:", !!API_KEY);
    if (!API_KEY) {
      t.skip("Set TINFOIL_API_KEY or OPENAI_API_KEY for integration test.");
      return;
    }
    
    const client = new TinfoilAI({
      apiKey: API_KEY,
      baseURL: "https://ehbp.inf6.tinfoil.sh/v1/",
      configRepo: "tinfoilsh/confidential-inference-proxy-hpke",
    });

    try {
      console.log("Calling client.ready()...");
      await client.ready();
      console.log("Client ready successfully");

      // Get the verification document to ensure verification happened
      const verificationDoc = await client.getVerificationDocument();
      console.log("Verification document received");
      
      assert.ok(verificationDoc, "Verification document should be available");
      // Fixed the assertion to match what we're actually setting
      assert.strictEqual(verificationDoc.configRepo, "tinfoilsh/confidential-inference-proxy-hpke", "Should use confidential-inference-proxy-hpke repo");
      assert.ok(verificationDoc.match, "Verification should match");
      
      // TLS fingerprint should always be available
      assert.ok(verificationDoc.enclaveMeasurement.tlsPublicKeyFingerprint, "TLS public key fingerprint should be available");
      
      // HPKE is optional - if not available, TLS-only verification is used
      if (verificationDoc.enclaveMeasurement.hpkePublicKey) {
        console.log("HPKE public key available - using encrypted body transport");
      } else {
        console.log("HPKE not available - using TLS-only verification");
      }
    } catch (error) {
      console.error("Test failed with error:", error);
      throw error;
    }
  });
});