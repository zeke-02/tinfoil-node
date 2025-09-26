# Tinfoil Node Client

[![Build Status](https://github.com/tinfoilsh/tinfoil-node/actions/workflows/test.yml/badge.svg)](https://github.com/tinfoilsh/tinfoil-node/actions)
[![NPM version](https://img.shields.io/npm/v/tinfoil.svg)](https://npmjs.org/package/tinfoil)

A Node.js wrapper around the OpenAI client that verifies enclave attestation and routes OpenAI-bound traffic through an [EHBP](https://github.com/tinfoilsh/encrypted-http-body-protocol)-secured transport when using Tinfoil inference.

## Requirements

Node 20.18.1 and higher.

## Installation

```bash
npm install tinfoil
```

## Quick Start

```typescript
import { TinfoilAI } from "tinfoil";

const client = new TinfoilAI({
  apiKey: "<YOUR_API_KEY>", // or use TINFOIL_API_KEY env var
});

// Uses identical method calls as the OpenAI client
const completion = await client.chat.completions.create({
  messages: [{ role: "user", content: "Hello!" }],
  model: "llama3-3-70b",
});
```

## Verification helpers

This package exposes a small set of verification helpers that load the Go-based WebAssembly verifier once per process and provide structured, stepwise attestation results you can use in applications (e.g., to show progress, log transitions, or gate features).

- `loadVerifier(wasmUrl?)` boots the verifier and returns a client.
- `client.verifyEnclave(enclaveHost)` performs runtime attestation and returns `{ measurement, tlsPublicKeyFingerprint, hpkePublicKey }` as strings.
- `client.verifyCode(repo, digest)` verifies source integrity and returns `{ measurement }` as a string.
- `client.fetchLatestDigest(repo)` fetches the latest release digest from GitHub for the given repo.
- `client.runVerification({ repo, enclaveHost, digest?, onUpdate? })` orchestrates the full flow and returns a structured result with step statuses and a comparison outcome.

### End-to-end orchestration

```typescript
import { loadVerifier } from "tinfoil";

const verifier = await loadVerifier();

const result = await verifier.runVerification({
  repo: "tinfoilsh/confidential-inference-proxy-hpke",
  enclaveHost: new URL("https://ehbp2.model.tinfoil.sh/v1/").hostname,
  onUpdate: (state) => {
    // Receive stepwise updates: pending -> loading -> success/error
    // Useful for logging or progress indicators
    console.log("verification update:", state);
  },
});

if (result.security.status === "success" && result.security.match) {
  console.log("Measurements match. Digest:", result.digest);
} else {
  console.error("Verification failed:", result);
}
```

`runVerification` returns:

```typescript
type VerificationResult = {
  code: { status: "pending" | "loading" | "success" | "error"; measurement?: string; error?: string };
  runtime: {
    status: "pending" | "loading" | "success" | "error";
    measurement?: string;
    tlsPublicKeyFingerprint?: string;
    hpkePublicKey?: string;
    error?: string;
  };
  security: { status: "pending" | "loading" | "success" | "error"; match?: boolean; error?: string };
  digest: string;
};
```

### Manual step-by-step use

```typescript
import { loadVerifier } from "tinfoil";

const verifier = await loadVerifier();

// 1) Runtime attestation
const runtime = await verifier.verifyEnclave(new URL("https://ehbp2.model.tinfoil.sh/v1/").hostname);
console.log(runtime.measurement, runtime.tlsPublicKeyFingerprint, runtime.hpkePublicKey);

// 2) Get latest digest for a repo
const digest = await verifier.fetchLatestDigest("tinfoilsh/confidential-inference-proxy-hpke");

// 3) Source integrity attestation
const code = await verifier.verifyCode("tinfoilsh/confidential-inference-proxy-hpke", digest);

// 4) Local comparison
const match = code.measurement === runtime.measurement;
console.log("match:", match);
```

### Subscribe to state updates

```typescript
const verifier = await loadVerifier();
const unsubscribe = verifier.subscribe((state) => {
  console.log("state:", state);
});

await verifier.runVerification({
  repo: "tinfoilsh/confidential-inference-proxy-hpke",
  enclaveHost: new URL("https://ehbp2.model.tinfoil.sh/v1/").hostname,
});

unsubscribe();
```

### Custom WASM URL (optional)

```typescript
import { loadVerifier } from "tinfoil";

// Provide a custom URL if hosting the WASM yourself
const verifier = await loadVerifier("https://example.com/tinfoil-verifier.wasm");
```

## Running the Chat Example

To run the streaming chat example:

1. Clone the repository

2. Install dependencies:

```bash
npm install
```

1. Optionally create a `.env` file with your configuration:

```bash
TINFOIL_API_KEY=<YOUR_API_KEY>
```

1. Run the example:

```bash
cd examples/chat
npx ts-node main.ts
```

The example demonstrates streaming chat completions with the Tinfoil API wrapper.

## API Documentation

This library is a drop-in replacement for the official OpenAI Node.js client that can be used with Tinfoil. All methods and types are identical. See the [OpenAI client](https://github.com/openai/openai-node) for complete API usage and documentation.

## Reporting Vulnerabilities

Please report security vulnerabilities by either:

- Emailing [security@tinfoil.sh](mailto:security@tinfoil.sh)

- Opening an issue on GitHub on this repository

We aim to respond to security reports within 24 hours and will keep you updated on our progress.
