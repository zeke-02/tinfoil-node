# Tinfoil

A secure OpenAI client wrapper for Node.js that verifies enclave attestation and certificate fingerprints.

## Installation

```bash
npm install tinfoil
```

## Usage

### Basic Usage

```typescript
import { TinfoilClient } from 'tinfoil';

// Create a client using environment variables
// TINFOIL_ENCLAVE and TINFOIL_REPO must be set
const client = new TinfoilClient();

// Or create a client with explicit parameters
const client = new TinfoilClient({
  enclave: 'models.default.tinfoil.sh',
  repo: 'tinfoilsh/default-models-nitro',
});

// Make a chat completion request
const completion = await client.createChatCompletion({
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Why is tinfoil now called aluminum foil?' }
  ],
  model: 'gpt-4',
});

console.log(completion.choices[0].message.content);
```

### Streaming Usage

```typescript
import { TinfoilClient } from 'tinfoil';

const client = new TinfoilClient();

const stream = await client.createChatCompletionStream({
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Why is tinfoil now called aluminum foil?' }
  ],
  model: 'gpt-4',
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

### Advanced Usage

You can access the underlying OpenAI client directly if needed:

```typescript
const openaiClient = client.openai;
```

## Environment Variables

- `TINFOIL_ENCLAVE`: The enclave endpoint (e.g., 'models.default.tinfoil.sh')
- `TINFOIL_REPO`: The repository containing the model (e.g., 'tinfoilsh/default-models-nitro')
- `OPENAI_API_KEY`: Your OpenAI API key

## Security

This client adds an additional layer of security by:

1. Verifying the enclave attestation
2. Checking certificate fingerprints
3. Ensuring secure communication with the model

## Development

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test

# Run linter
npm run lint
```

## License

MIT
