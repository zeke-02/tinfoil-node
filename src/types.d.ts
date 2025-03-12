declare global {
    var Go: any;
    var verifyEnclave: (enclaveHostname: string) => Promise<{
        certificate: string;
        measurement: string;
    }>;
    var verifyCode: (repo: string, digest: string) => Promise<string>;
}

export {}; 