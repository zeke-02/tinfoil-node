# Tinfoil

A Node.js wrapper around the OpenAI client that verifies enclave attestation and certificate fingerprints when using Tinfoil inference.

## Installation

```bash
npm install tinfoil
```

## Quick Start

```typescript
import { TinfoilClient } from 'tinfoil';

const client = new TinfoilClient({
  enclave: 'models.default.tinfoil.sh',  // or use TINFOIL_ENCLAVE env var
  repo: 'tinfoilsh/default-models-nitro', // or use TINFOIL_REPO env var
  apiKey: 'tinfoil'                 // or use OPENAI_API_KEY env var
});

// Uses identical method calls as the OpenAI client
const completion = await client.chat.completions.create({
  messages: [{ role: 'user', content: 'Hello!' }],
  model: 'llama3.2:1b'
});
```

## Security Features

- Enclave attestation verification

- Certificate fingerprint validation

- Secure communication channel

## Runtime Support

Supports Node.js 18+, Deno, Bun, Cloudflare Workers, and more. Browser usage is disabled by default for security. See [OpenAI Node.js client](https://github.com/openai/openai-node) for complete runtime compatibility.

## API Documentation

This library is a drop-in replacement for the official OpenAI Node.js client that can be used with Tinfoil. All methods and types are identical. See the [OpenAI client](https://github.com/openai/openai-node) for complete API usage and documentation.
