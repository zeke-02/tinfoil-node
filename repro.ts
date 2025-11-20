
import { SecureClient } from "./src/secure-client";

async function run() {
    console.log("Testing bad URL: https://ehbp.inf6.tinfoil.sh/v1/");
    const badClient = new SecureClient({
        enclaveURL: "https://ehbp.inf6.tinfoil.sh/v1/",
        configRepo: "tinfoilsh/confidential-inference-proxy-hpke",
    });

    try {
        await badClient.ready();
        console.log("Bad URL success (unexpected)");
    } catch (e) {
        console.log("Bad URL failed as expected:", (e as Error).message);
    }

    console.log("\nTesting good URL: https://inference.tinfoil.sh/v1/");
    const goodClient = new SecureClient({
        enclaveURL: "https://inference.tinfoil.sh/v1/",
        configRepo: "tinfoilsh/confidential-inference-proxy-hpke",
    });

    try {
        await goodClient.ready();
        console.log("Good URL success (or at least passed SSL)");
    } catch (e) {
        console.log("Good URL failed:", (e as Error).message);
    }
}

run().catch(console.error);
