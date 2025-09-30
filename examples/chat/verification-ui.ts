import { fmt, statusIcon, truncate } from "./ansi";

// Inline, minimal terminal control helpers for drawing an updating block in TTYs
const isTTY = !!process.stdout.isTTY;
const term = {
  up: (n: number) => (isTTY ? `\x1b[${n}A` : ""),
  clear: () => (isTTY ? "\x1b[2K" : ""),
  hide: () => (isTTY ? "\x1b[?25l" : ""),
  show: () => (isTTY ? "\x1b[?25h" : ""),
};

export type StepStatus = "pending" | "loading" | "success" | "error";

// Minimal state the renderer needs to present verification progress
export type RenderableState = {
  digest: string;
  runtime: { status: StepStatus };
  code: { status: StepStatus };
  verification: { status: StepStatus };
};

// Convert state into a set of human-readable lines for printing
export function buildLines(state: RenderableState): string[] {
  const lines: string[] = [];
  lines.push(fmt.bold("Enclave Attestation Verification"));
  
  // Digest
  const digestLine = state.digest ? truncate(state.digest) : fmt.dim("resolving…");
  lines.push(`${fmt.dim("┌")} ${fmt.bold("Digest")} ${fmt.dim("→")} ${digestLine}`);
  
  // Runtime
  lines.push(`${fmt.dim("├")} ${fmt.bold("Runtime")} ${statusIcon(state.runtime.status)}`);
  
  // Code
  lines.push(`${fmt.dim("├")} ${fmt.bold("Code")}    ${statusIcon(state.code.status)}`);
  
  // Final verification summary
  lines.push(`${fmt.dim("└")} ${fmt.bold("Verification")} ${statusIcon(state.verification.status)}`);
  
  return lines;
}

// Small helper to render/upsert a block of lines in-place (for pretty progress UI)
export class InlineBlock {
  private linesRendered = 0;
  private first = true;

  start() {
    if (isTTY) process.stdout.write(term.hide());
  }
  stop() {
    if (isTTY) process.stdout.write(term.show());
  }
  render(lines: string[]) {
    if (!isTTY) {
      process.stdout.write(lines.join("\n") + "\n");
      return;
    }
    if (!this.first) {
      process.stdout.write(term.up(this.linesRendered));
    }
    for (let i = 0; i < lines.length; i++) {
      process.stdout.write(term.clear());
      process.stdout.write(lines[i] + "\n");
    }
    for (let i = lines.length; i < this.linesRendered; i++) {
      process.stdout.write(term.clear() + "\n");
    }
    this.linesRendered = lines.length;
    this.first = false;
  }
}

