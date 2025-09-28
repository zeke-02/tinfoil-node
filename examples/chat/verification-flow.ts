import { loadVerifier, suppressWasmLogs, TINFOIL_CONFIG } from "../../src";
import { fmt } from "./ansi";
import { InlineBlock, buildLines } from "./verification-ui";
import type { RenderableState } from "./verification-ui";

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

  const verification = await verifier.runVerification();
  unsubscribe();
  block.stop();
  console.log();
  if (verification.security.status === "success" && verification.security.match) {
    console.log(fmt.green("Enclave verification completed"));
  } else {
    console.log(fmt.red("Enclave verification failed"));
  }
}