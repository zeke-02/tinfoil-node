import OpenAI from 'openai';
import { config } from 'dotenv';

/**
 * This example demonstrates how to use the Tinfoil API wrapper with
 * streaming chat completions.
 */

// Load environment variables from .env file if present
config();

// Default Tinfoil environment configuration
const DEFAULT_ENCLAVE = 'models.default.tinfoil.sh';
const DEFAULT_REPO = 'tinfoilsh/default-models-nitro';

// Set up environment variables (you can also set these in your .env file)
process.env.TINFOIL_ENCLAVE = process.env.TINFOIL_ENCLAVE || DEFAULT_ENCLAVE;
process.env.TINFOIL_REPO = process.env.TINFOIL_REPO || DEFAULT_REPO;

async function runStreamingExample(client: OpenAI) {
    console.log('\n=== Streaming Chat Completion ===');
    
    const messages = [
        { role: 'system' as const, content: 'You are a helpful assistant.' },
        { role: 'user' as const, content: 'Tell me a short story about aluminum foil.' }
    ];

    // Print the prompts
    console.log('\nPrompts:');
    messages.forEach(msg => {
        console.log(`${msg.role.toUpperCase()}: ${msg.content}`);
    });

    try {
        const stream = await client.chat.completions.create({
            model: 'llama3.2:1b',
            messages: messages,
            stream: true,
        });

        console.log('\nStreaming response:');
        let fullResponse = '';

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            fullResponse += content;
            process.stdout.write(content); // Print content as it arrives
        }

        console.log('\n\nFull accumulated response:');
        console.log(fullResponse);
    } catch (error) {
        console.error('Stream error:', error);
    }
}

async function main() {
    // Create a new OpenAI client with Tinfoil configuration
    const client = new OpenAI({
        apiKey: 'tinfoil', // Replace with your actual API key
        baseURL: `https://${process.env.TINFOIL_ENCLAVE}/v1`,
    });

    // Run streaming example
    await runStreamingExample(client);
}

// Run the example
main().catch(console.error); 