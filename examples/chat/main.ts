import { TinfoilAI } from "../../src";
import { fmt } from "./ansi";
import { loadEnvQuietly } from "./env";
import { installX25519WarningFilter } from "./warnings";
import { runVerificationDemo } from "./verification-flow";
import { runStreamingExample } from "./chat-stream";

// 1) Load env early (quietly) so API keys are available to the rest of the app
loadEnvQuietly();

// 2) Hide the noisy experimental X25519 warning unless explicitly enabled
installX25519WarningFilter();

async function main() {
  try {
    // 3) Show config surface so users know whether their API key is picked up
    console.log(fmt.bold("Configuration"));
    console.log("API Key:", process.env.TINFOIL_API_KEY ? fmt.green("Set") : fmt.red("Not set"));

    // 4) Run a verification demo with a small inline progress UI
    await runVerificationDemo();

    // 5) Create a client and run the streaming chat example
    const client = new TinfoilAI({
      baseURL: "https://ehbp.inf6.tinfoil.sh/v1/",
      enclaveURL: "https://ehbp.inf6.tinfoil.sh/v1/",
      configRepo: "tinfoilsh/confidential-inference-proxy-hpke",
    }); // apiKey is read from TINFOIL_API_KEY
    await runStreamingExample(client);
  } catch (error) {
    console.error("Main error:", error);
    if (error instanceof Error) {
      console.error("Main error stack:", error.stack);
    }
    throw error;
  }
}

// Run the example
main().catch((error) => {
  console.error("Top level error:", error);
  process.exit(1);
});