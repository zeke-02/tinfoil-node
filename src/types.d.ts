declare global {
  let Go: any;
  let verifyEnclave: (enclaveHostname: string) => Promise<{
    measurement: unknown;
    tls_public_key: string;
    hpke_public_key: string;
  }>;
  let verifyCode: (repo: string, digest: string) => Promise<unknown>;
}

export {};
