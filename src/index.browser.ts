// Browser-safe entry point: avoids Node built-ins
export { TinfoilAI } from "./client.browser";
export { TinfoilAI as default } from "./client.browser";

export * from "./verifier";
export * from "./verification-runner";
export * from "./ai-sdk-provider.browser";
export * from "./config";

