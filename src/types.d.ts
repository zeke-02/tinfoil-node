declare global {
  let Go: any;
  let verifyEnclave: (enclaveHostname: string) => Promise<{
    certificate: string; // This is incorrectly named now in the WASM binding. This contains the hex public key fingerprint.
    publicKeyFP: string;
  }>;
  let verifyCode: (repo: string, digest: string) => Promise<string>;
}

export {};
