import { loadVerifier, suppressWasmLogs, TINFOIL_CONFIG } from "../../src";
import { fmt } from "./ansi";
import { InlineBlock, buildLines, RenderableState } from "./verification-ui";

/**
 * Runs the enclave/code verification demo with a small inline progress UI.
 * Prints a one-line summary when complete.
 */
export async function runVerificationDemo(): Promise<void> {
  // Enable Go WASM logs only when explicitly requested
  if (process.env.TINFOIL_ENABLE_WASM_LOGS === "true") {
    suppressWasmLogs(false);
  } else {
    suppressWasmLogs(true);
  }

  const verifier = await loadVerifier();
  const enclaveHost = new URL(TINFOIL_CONFIG.INFERENCE_BASE_URL).hostname;
  const repo = TINFOIL_CONFIG.INFERENCE_PROXY_REPO;

  console.log();
  const block = new InlineBlock();
  block.start();

  let current: RenderableState = {
    digest: "",
    runtime: { status: "pending" },
    code: { status: "pending" },
    security: { status: "pending" },
  };
  const unsubscribe = verifier.subscribe((state) => {
    const { runtime, code, security, digest } = state;
    current.digest = digest;
    current.runtime.status = runtime.status;
    current.code.status = code.status;
    current.security.status = security.status;

    const lines = buildLines(current);
    block.render(lines);
  });

  const verification = await verifier.runVerification({ repo, enclaveHost });
  unsubscribe();
  block.stop();
  console.log();
  if (verification.security.match) {
    console.log(fmt.green("Enclave verification completed"));
  } else {
    console.log(fmt.red("Enclave verification failed"));
  }
}