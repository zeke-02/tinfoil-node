# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tinfoil is a secure OpenAI client wrapper that provides enclave-verified, end-to-end encrypted access to AI models. It wraps the OpenAI client and routes traffic through EHBP (Encrypted HTTP Body Protocol) to attested enclaves, encrypting payloads using HPKE (RFC 9180).

## Build and Development Commands

### Build
```bash
npm run build           # Build both CJS and ESM
npm run build:cjs       # Build CommonJS (dist/)
npm run build:esm       # Build ESM (dist/esm/)
```

### Testing
```bash
npm test                                    # Run unit tests only
RUN_TINFOIL_INTEGRATION=true npm test      # Run all tests including integration tests
```

Integration tests make real network requests and perform actual enclave attestation verification. They are skipped by default.

To run a single test file:
```bash
npm run build:cjs
tsc -p tsconfig.node-test.json
cp src/wasm-exec.js .node-tests/
node --test .node-tests/__tests__/[test-file-name].test.js
```

### Linting
```bash
npm run lint
```

## Architecture

### Core Components

**TinfoilAI** (`src/tinfoilai.ts`)
- Main entry point that wraps the OpenAI client
- Uses async proxies to lazily initialize the client only when API methods are called
- Provides identical API surface to OpenAI client (chat, embeddings, images, etc.)
- Delegates verification and transport to SecureClient

**SecureClient** (`src/secure-client.ts`)
- Orchestrates verification and secure transport initialization
- Calls Verifier for attestation
- Creates encrypted fetch function using keys from verification
- Manages router selection if no baseURL/enclaveURL provided

**Verifier** (`src/verifier.ts`)
- Performs end-to-end verification using Go WebAssembly module
- Executes atomically: digest fetch → code verification → enclave attestation → hardware verification (TDX) → measurement comparison
- Returns AttestationResponse with cryptographic keys (HPKE public key, TLS fingerprint)
- Provides detailed VerificationDocument with step-by-step results
- WASM module URL: https://tinfoilsh.github.io/verifier/tinfoil-verifier.wasm
- Error messages prefixed by failing step (fetchDigest:, verifyCode:, verifyEnclave:, etc.)

**Encrypted Transport** (`src/encrypted-body-fetch.ts`, `src/secure-fetch.ts`)
- Creates EHBP transport using HPKE public key from attestation
- `encrypted-body-fetch.ts`: Core EHBP integration using @zeke-02/ehbp
- `secure-fetch.ts`: Wrapper that creates encrypted fetch function
- All payloads encrypted directly to the attested enclave

**Router** (`src/router.ts`)
- Fetches available routers from ATC (Attestation and Trust Center) API
- Randomly selects from available routers if no explicit baseURL/enclaveURL provided
- ATC_API_URL: https://atc.tinfoil.sh/routers

**AI SDK Provider** (`src/ai-sdk-provider.ts`)
- Provides Vercel AI SDK compatible provider via @ai-sdk/openai-compatible
- Alternative to TinfoilAI class for AI SDK users
- Requires manual async initialization with createTinfoilAI()

### Multi-Platform Build

The package supports both Node.js and browser environments:

**Node (CJS)**
- tsconfig.json → dist/ (CommonJS)
- Target: ES2020, module: commonjs

**Node/Browser (ESM)**
- tsconfig.esm.json → dist/esm/ (ES modules)
- scripts/convert-to-mjs.js converts .js → .mjs
- Target: ES2020, module: ES2020

**Browser-specific files**
- `src/index.browser.ts`: Browser entry point
- `src/secure-fetch.browser.ts`: Browser-specific fetch implementation
- Requires `dangerouslyAllowBrowser: true` option

**Package exports** (package.json)
- Conditional exports for browser, import, require
- Entry points: main package, /client, /ai-sdk-provider, /verifier, /config, /secure-client, /secure-fetch, /router

### WebAssembly Integration

The verifier uses a Go-compiled WebAssembly module:
- `src/wasm-exec.js`: Go WASM runtime loader (copied to dist during build)
- `src/wasm-exec.d.ts`: TypeScript declarations for Go WASM globals
- Polyfills required: TextEncoder, TextDecoder, crypto.getRandomValues, performance
- Works in Node 20+ and modern browsers

### Configuration

All configuration constants in `src/config.ts`:
- `INFERENCE_PROXY_REPO`: GitHub repo for code attestation (tinfoilsh/confidential-model-router)
- `ATC_API_URL`: Router discovery endpoint

### Key Verification Flow

1. **Router Discovery** (if needed): Fetch available routers from ATC API
2. **Code Verification**: Fetch GitHub release digest, verify with Sigstore/Rekor
3. **Enclave Attestation**: Perform runtime attestation (AMD SEV-SNP or Intel TDX)
4. **Hardware Verification**: For TDX platforms, verify hardware measurements
5. **Measurement Comparison**: Compare runtime vs expected code measurements
6. **Transport Creation**: Create EHBP transport with HPKE public key from attestation
7. **Client Initialization**: Create OpenAI client with encrypted fetch function

### Testing Strategy

**Unit Tests** (`src/__tests__/*.test.ts`)
- Run by default with `npm test`
- Mock network calls and WASM verification
- Test individual components in isolation

**Integration Tests** (`src/__tests__/integration.test.ts`)
- Require `RUN_TINFOIL_INTEGRATION=true`
- Make real network requests
- Perform actual enclave verification
- Test end-to-end workflows with live services

**Test Utilities** (`src/__tests__/test-utils.ts`)
- Shared mocks and helpers for tests

## Environment Variables

- `TINFOIL_API_KEY`: Default API key (only read in Node.js, not browsers)
- `RUN_TINFOIL_INTEGRATION`: Set to `true` to enable integration tests

## Security Notes

- Never expose API keys in browser environments
- WASM verification runs entirely client-side
- All certificate chain verification happens in WASM (AMD KDS roots embedded)
- GitHub proxy used only for rate limiting; Sigstore validates release provenance independently
- EHBP encrypts all request/response bodies end-to-end to the attested enclave
