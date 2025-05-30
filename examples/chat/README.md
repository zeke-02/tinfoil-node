# Tinfoil Chat Example

This example demonstrates how to use the Tinfoil client to interact with OpenAI's chat completion API in both streaming and non-streaming modes.

## Setup

1. Make sure you have Node.js installed and the Tinfoil repository cloned
2. Navigate to the example directory:
   ```bash
   cd examples/chat
   ```
3. Install the required dependencies:
   ```bash
   npm install dotenv openai ts-node typescript
   ```
4. Set up your API key environment variable:
   ```bash
   export OPENAI_API_KEY="your-api-key"
   ```
   Or create a `.env` file with:
   ```bash
   OPENAI_API_KEY="your-api-key"
   ```
   
   Note: The enclave and repo are configured directly in the code for this example:
   - Enclave: `llama3-3-70b.model.tinfoil.sh`
   - Repo: `tinfoilsh/confidential-llama3-3-70b`

## Running the Example

Make sure you're in the examples/chat directory, then run:
```bash
npx ts-node main.ts
```

## What the Example Does

The example will:

1. Create a TinfoilAI client with the enclave and repo configured directly in code

2. Demonstrate a streaming chat completion with real-time output

The code shows both the basic usage pattern and error handling. The API key is loaded from the `OPENAI_API_KEY` environment variable, while the enclave and repo are specified directly in the constructor. 