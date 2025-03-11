import fetch from 'node-fetch';
import { TinfoilClient } from './client';
import { TextEncoder, TextDecoder } from 'util';
import crypto from 'crypto';

// These globals are required for the Go WASM runtime (wasm-exec.js)
// While browsers provide these by default, Node.js needs explicit assignment
// They're used for string encoding/decoding between JavaScript and WebAssembly memory
const globalThis = global as any;
globalThis.crypto = {
  getRandomValues: (arr: Uint8Array) => {
    return crypto.randomFillSync(arr);
  }
};
globalThis.performance = {
  now: () => Date.now()
};
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;

// wasm-exec.js is a required Go runtime helper that sets up the JavaScript environment
// for running Go-compiled WebAssembly code. It provides necessary bindings and utilities
// that bridge the gap between Go's runtime expectations and the JavaScript environment.
// This file is provided by the Go project and should be kept in sync with your Go version.
// 
// TODO: maybe this should be fetched directly from go? However, this could 
// potentially cause breaking issues if the Go version is not compatible and 
// open up a security vulnerability (we'd need to also trust the Go source in perpetuity).
// 'https://raw.githubusercontent.com/golang/go/master/misc/wasm/wasm_exec.js';
require('./wasm-exec.js');

/**
 * Represents the ground truth measurements used for verification
 */
export interface GroundTruth {
  certFingerprint: Uint8Array;
  measurement: string;
}

/**
 * SecureClient handles verification of code and runtime measurements using WebAssembly.
 * The WASM module is compiled from Go code (github.com/tinfoilsh/verifier) and provides
 * cryptographic verification capabilities.
 */
export class SecureClient {
  private enclave: string;
  private repo: string;

  constructor(enclave: string, repo: string) {
    this.enclave = enclave;
    this.repo = repo;
  }

  /**
   * Verifies the integrity of both the code and runtime environment.
   * 
   * This process:
   * 1. Loads the WASM verifier (compiled from Go) hosted on GitHub
   * 2. Instantiates the WASM module with required imports
   * 3. Verifies the code measurement against the repository
   * 4. Verifies the enclave attestation
   * 5. Ensures measurements match between code and attestation
   * 
   * @returns {Promise<GroundTruth>} The verification results including certificate fingerprint and measurement
   * @throws {Error} If measurements don't match between code and attestation
   */
  public async verify(): Promise<GroundTruth> {
    // Load the WebAssembly module from GitHub - this is the compiled Go verifier
    const wasmResponse = await fetch('https://tinfoilsh.github.io/verifier-js/tinfoil-verifier.wasm');
    const wasmBuffer = await wasmResponse.arrayBuffer();
    
    // Initialize the Go WASM runtime
    const go = new globalThis.Go();
    const wasmInstance = await WebAssembly.instantiate(wasmBuffer, go.importObject);
    await go.run(wasmInstance.instance);

    // verifyCode and verifyEnclave are functions exported from the Go WASM module
    const measurement = await globalThis.verifyCode(this.repo);
    const attestationResponse = await globalThis.verifyEnclave(this.enclave);

    // Verify measurements match
    if (measurement !== attestationResponse.measurement) {
      throw new Error('Measurements do not match');
    }

    return {
      certFingerprint: new Uint8Array(Buffer.from(attestationResponse.certFingerprint, 'base64')),
      measurement: attestationResponse.measurement,
    };
  }
}

const tinfoil = new TinfoilClient();

 