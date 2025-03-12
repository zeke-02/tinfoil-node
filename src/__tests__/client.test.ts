import { TinfoilClient } from '../client';
import '@jest/globals';

// Test configuration with defaults
interface TestConfig {
  enclave: string;
  repo: string;
}

const getEnvOrDefault = (key: string, defaultValue: string): string => {
  return process.env[key] || defaultValue;
};

const testConfig: TestConfig = {
  enclave: getEnvOrDefault('TINFOIL_TEST_ENCLAVE', 'models.default.tinfoil.sh'),
  repo: getEnvOrDefault('TINFOIL_TEST_REPO', 'tinfoilsh/default-models-nitro'),
};

describe('TinfoilClient', () => {
  beforeEach(() => {
    process.env.TINFOIL_ENCLAVE = testConfig.enclave;
    process.env.TINFOIL_REPO = testConfig.repo;
  });

  afterEach(() => {
    delete process.env.TINFOIL_ENCLAVE;
    delete process.env.TINFOIL_REPO;
  });

  it('should create a client with environment variables', async () => {
    const client = new TinfoilClient({
      apiKey: 'tinfoil'
    });
    await client.ready();
    expect(client).toBeDefined();
  }, 60000);

  it('should throw error when environment variables are not set', () => {
    delete process.env.TINFOIL_ENCLAVE;
    delete process.env.TINFOIL_REPO;
    
    expect(() => new TinfoilClient({
      apiKey: 'tinfoil'
    })).toThrow('tinfoil: TINFOIL_ENCLAVE and TINFOIL_REPO environment variables must be specified');
  });

  it('should perform non-streaming chat completion', async () => {
    const client = new TinfoilClient({
      apiKey: 'tinfoil'
    });

    await client.ready();

    const response = await client.chat.completions.create({
      messages: [
        { role: 'system', content: 'No matter what the user says, only respond with: Done.' },
        { role: 'user', content: 'Is this a test?' }
      ],
      model: 'llama3.2:1b'
    });

    console.log('Response received:', response.choices[0].message.content);
    expect(response.choices[0].message.content).toBeDefined();
  }, 60000);

  it('should handle streaming chat completion', async () => {
    const client = new TinfoilClient({
      apiKey: 'tinfoil'
    });

    await client.ready();

    const stream = await client.chat.completions.create({
      messages: [
        { role: 'system', content: 'No matter what the user says, only respond with: Done.' },
        { role: 'user', content: 'Is this a test?' }
      ],
      model: 'llama3.2:1b',
      stream: true
    });

    let accumulatedContent = '';
    console.log('Chat completion streaming response:');
    
    for await (const chunk of stream) {
      if (chunk.choices[0]?.delta?.content) {
        const content = chunk.choices[0].delta.content;
        accumulatedContent += content;
        console.log('Received:', content);
      }
    }

    console.log('Complete response:', accumulatedContent);
    expect(accumulatedContent.length).toBeGreaterThan(0);
  }, 60000);
});

