import OpenAI from 'openai';
import type { Stream } from 'openai/streaming';
import { createHash } from 'crypto';
import { SecureClient, GroundTruth } from './secure-client';
import https from 'https';

/**
 * TinfoilClient is a secure wrapper around the OpenAI API client that adds additional
 * security measures through enclave verification and certificate fingerprint validation.
 * 
 * It provides:
 * - Automatic verification of secure enclaves
 * - Certificate fingerprint validation for each request
 * - Type-safe access to OpenAI's chat completion APIs
 */
export class TinfoilClient {
  private client!: OpenAI;
  private enclave: string;
  private repo: string;
  private groundTruth?: GroundTruth;
  private clientPromise: Promise<OpenAI>;

  /**
   * Creates a new TinfoilClient instance using environment variables.
   * @param options - Optional OpenAI client configuration options
   * @throws Error if TINFOIL_ENCLAVE or TINFOIL_REPO environment variables are not set
   */
  constructor(options?: ConstructorParameters<typeof OpenAI>[0]);
  /**
   * Creates a new TinfoilClient instance with explicit enclave and repo values.
   * @param enclave - The enclave URL/identifier
   * @param repo - The repository identifier
   * @param options - Optional OpenAI client configuration options
   */
  constructor(enclave: string, repo: string, options?: ConstructorParameters<typeof OpenAI>[0]);
  constructor(
    enclaveOrOptions?: string | ConstructorParameters<typeof OpenAI>[0],
    repoOrNothing?: string,
    options?: ConstructorParameters<typeof OpenAI>[0]
  ) {
    if (typeof enclaveOrOptions === 'string' && typeof repoOrNothing === 'string') {
      this.enclave = enclaveOrOptions;
      this.repo = repoOrNothing;
      this.clientPromise = this.initClient(options);
    } else {
      this.enclave = process.env.TINFOIL_ENCLAVE || '';
      this.repo = process.env.TINFOIL_REPO || '';

      if (!this.enclave || !this.repo) {
        throw new Error('tinfoil: TINFOIL_ENCLAVE and TINFOIL_REPO environment variables must be specified');
      }

      this.clientPromise = this.initClient(enclaveOrOptions as ConstructorParameters<typeof OpenAI>[0]);
    }
  }

  /**
   * Ensures the client is ready to use.
   * @returns Promise that resolves when the client is initialized
   */
  public async ready(): Promise<void> {
    this.client = await this.clientPromise;
  }

  private async initClient(options?: Partial<Omit<ConstructorParameters<typeof OpenAI>[0], 'baseURL'>>): Promise<OpenAI> {
    return this.createOpenAIClient(options);
  }

  private async createOpenAIClient(options: Partial<Omit<ConstructorParameters<typeof OpenAI>[0], 'baseURL'>> = {}): Promise<OpenAI> {
    // Verify the enclave and get the certificate fingerprint
    const secureClient = new SecureClient(this.enclave, this.repo);
    
    try {
      this.groundTruth = await secureClient.verify();
    } catch (error) {
      throw new Error(`Failed to verify enclave: ${error}`);
    }

    // Convert the expected fingerprint to hex string for comparison
    const expectedFingerprint = Buffer.from(this.groundTruth.certFingerprint).toString('hex');

    // Create a custom HTTPS agent that verifies certificate fingerprints
    const httpsAgent = new https.Agent({
      rejectUnauthorized: true,
      checkServerIdentity: (host: string, cert: any) => {
        if (!cert || !cert.raw) {
          throw new Error('No certificate found');
        }

        // Calculate the SHA-256 fingerprint of the certificate and convert to hex
        const certFingerprint = createHash('sha256').update(cert.raw).digest('hex');

        // Compare hex strings
        if (certFingerprint !== expectedFingerprint) {
          throw new Error('Certificate fingerprint mismatch');
        }

        return undefined; // Validation successful
      }
    });

    // Create the OpenAI client with our custom configuration
    return new OpenAI({
      ...options,
      baseURL: `https://${this.enclave}/v1/`,
      httpAgent: httpsAgent,
    });
  }
} 