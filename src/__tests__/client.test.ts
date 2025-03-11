import { TinfoilClient } from '../client';
import '@jest/globals';

describe('TinfoilClient', () => {
  const testEnclave = 'models.default.tinfoil.sh';
  const testRepo = 'tinfoilsh/default-models-nitro';

  beforeEach(() => {
    process.env.TINFOIL_ENCLAVE = testEnclave;
    process.env.TINFOIL_REPO = testRepo;
  });

  afterEach(() => {
    delete process.env.TINFOIL_ENCLAVE;
    delete process.env.TINFOIL_REPO;
  });

  it('should create a client with environment variables', () => {
    const client = new TinfoilClient({
      apiKey: 'test-key'
    });
    expect(client).toBeDefined();
  });

  it('should throw error when environment variables are not set', () => {
    delete process.env.TINFOIL_ENCLAVE;
    delete process.env.TINFOIL_REPO;
    
    expect(() => new TinfoilClient({
      apiKey: 'test-key'
    })).toThrow('tinfoil: TINFOIL_ENCLAVE and TINFOIL_REPO environment variables must be specified');
  });

}); 

// TODO: Add tests for chat completion and streaming functionality