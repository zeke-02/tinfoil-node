# Tinfoil Node Client

[![Build Status](https://github.com/tinfoilsh/tinfoil-node/actions/workflows/test.yml/badge.svg)](https://github.com/tinfoilsh/tinfoil-node/actions)
[![NPM version](https://img.shields.io/npm/v/tinfoil.svg)](https://npmjs.org/package/tinfoil)

This client library provides secure and convenient access to the Tinfoil Priavate Inference endpoints from TypeScript or JavaScript.

It is a wrapper around the OpenAI client that verifies enclave attestation and routes traffic to the Tinfoil Private Inference endpoints through an [EHBP](https://github.com/tinfoilsh/encrypted-http-body-protocol)-secured transport. EHBP encrypts all payloads directly to an attested enclave using [HPKE (RFC 9180)](https://www.rfc-editor.org/rfc/rfc9180.html).

## Installation

```bash
npm install tinfoil
```

## Requirements

Node 20+.

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

## Browser Support

The SDK supports browser environments. This allows you to use the secure enclave-backed OpenAI API directly from web applications.

### ⚠️ Security Warning

Using API keys directly in the browser exposes them to anyone who can view your page source.
For production applications, always use a backend server to handle API keys.

### Browser Usage

```javascript
import { TinfoilAI } from 'tinfoil';

const client = new TinfoilAI({
  apiKey: 'your-api-key',
  dangerouslyAllowBrowser: true // Required for browser usage
});

// Optional: pre-initialize; you can also call APIs directly
await client.ready();

const completion = await client.chat.completions.create({
  model: 'llama3-3-70b',
  messages: [{ role: 'user', content: 'Hello!' }]
});
```

### Browser Requirements

- Modern browsers with ES2020 support
- WebAssembly support for enclave verification


## Verification helpers

This package exposes verification helpers that load the Go-based WebAssembly verifier and provide end-to-end attestation with structured, stepwise results you can use in applications (e.g., to show progress, log transitions, or gate features).

The verification functionality is contained in `verifier.ts`.


### Core Verifier API

```typescript
import { Verifier } from "tinfoil";

const verifier = new Verifier({ serverURL: "https://enclave.host.com" });

// Perform full end-to-end verification
const attestation = await verifier.verify();
// Returns: AttestationResponse with measurement and cryptographic keys
// This performs all verification steps atomically:
// 1. Fetches the latest release digest from GitHub
// 2. Verifies code provenance using Sigstore
// 3. Performs runtime attestation against the enclave
// 4. Verifies hardware measurements (for TDX platforms)
// 5. Compares code and runtime measurements

// Access detailed verification results
const doc = verifier.getVerificationDocument();
// Returns: VerificationDocument with step-by-step status including
// measurements, fingerprints, and cryptographic keys
```

### Verification Document

The `Verifier` provides access to a comprehensive verification document that tracks all verification steps, including failures:

```typescript
import { Verifier } from "tinfoil";

const verifier = new Verifier({ serverURL: "https://enclave.host.com" });

try {
  const attestation = await verifier.verify();
  const doc = verifier.getVerificationDocument();
  console.log('Security verified:', doc.securityVerified);
  console.log('TLS fingerprint:', attestation.tlsPublicKeyFingerprint);
  console.log('HPKE public key:', attestation.hpkePublicKey);
} catch (error) {
  // Even on error, you can access the verification document
  const doc = verifier.getVerificationDocument();

  // The document contains detailed step information:
  // - fetchDigest: GitHub release digest retrieval
  // - verifyCode: Code measurement verification
  // - verifyEnclave: Runtime attestation verification
  // - compareMeasurements: Code vs runtime measurement comparison
  // - otherError: Catch-all for unexpected errors (optional)

  // Check individual steps
  if (doc.steps.verifyEnclave.status === 'failed') {
    console.log('Enclave verification failed:', doc.steps.verifyEnclave.error);
  }

  // Error messages are prefixed with the failing step:
  // - "fetchDigest:" - Failed to fetch GitHub release digest
  // - "verifyCode:" - Failed to verify code provenance
  // - "verifyEnclave:" - Failed runtime attestation
  // - "verifyHardware:" - Failed TDX hardware verification
  // - "validateTLS:" - TLS public key validation failed
  // - "measurements:" - Measurement comparison failed
}
```

## Testing

The project includes both unit tests and integration tests:

### Running Unit Tests

```bash
npm test
```

### Running Integration Tests

```bash
RUN_TINFOIL_INTEGRATION=true npm test
```

This runs the full test suite including integration tests that:
- Make actual network requests to Tinfoil services
- Perform real enclave attestation verification
- Test end-to-end functionality with live services

Integration tests are skipped by default to keep the test suite fast and avoid network dependencies during development.

## Running examples

See [examples/README.md](https://github.com/tinfoilsh/tinfoil-node/blob/main/examples/README.md).

## API Documentation

This library mirrors the official OpenAI Node.js client for common endpoints (e.g., chat, images, embeddings) and types, and is designed to feel familiar. Some less commonly used surfaces may not be fully covered. See the [OpenAI client](https://github.com/openai/openai-node) for complete API usage and documentation.

## Reporting Vulnerabilities

Please report security vulnerabilities by either:

- Emailing [security@tinfoil.sh](mailto:security@tinfoil.sh)

- Opening an issue on GitHub on this repository

We aim to respond to security reports within 24 hours and will keep you updated on our progress.
