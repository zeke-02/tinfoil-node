import { TinfoilClient } from '../../src';
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

async function runStreamingExample(client: TinfoilClient) {
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
        // Make sure client is ready before using
        try {
            await client.ready();
            console.log('Client initialization successful!');
        } catch (initError) {
            console.error('Client initialization failed:', initError);
            if (initError instanceof Error) {
                console.error('Initialization stack:', initError.stack);
            }
            throw initError;
        }

        console.log('Creating chat completion stream...');
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
            process.stdout.write(content);
        }

        console.log('\n\nFull accumulated response:');
        console.log(fullResponse);
    } catch (error) {
        console.error('Stream error:', error);
        if (error instanceof Error) {
            console.error('Full error stack:', error.stack);
        }
        // Log any additional error properties
        console.error('Error details:', JSON.stringify(error, null, 2));
    }
}

async function main() {
    try {
        console.log('Environment configuration:');
        console.log('TINFOIL_ENCLAVE:', process.env.TINFOIL_ENCLAVE);
        console.log('TINFOIL_REPO:', process.env.TINFOIL_REPO);

        // Create a new TinfoilClient
        const client = new TinfoilClient({
            apiKey: 'tinfoil' // Replace with your actual API key
        });

        // Run streaming example
        await runStreamingExample(client);
    } catch (error) {
        console.error('Main error:', error);
        if (error instanceof Error) {
            console.error('Main error stack:', error.stack);
        }
        throw error;
    }
}

// Run the example
main().catch(error => {
    console.error('Top level error:', error);
    process.exit(1);
}); 