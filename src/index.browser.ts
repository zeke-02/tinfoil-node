// Browser-safe entry point: avoids Node built-ins
export { TinfoilAI } from "./client";
export { TinfoilAI as default } from "./client";

export * from "./verifier";
export * from "./verification-runner";
export * from "./ai-sdk-provider";
export * from "./config";
export { SecureClient } from "tinfoil/secure-client";