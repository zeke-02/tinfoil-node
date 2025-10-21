/**
 * Fetch adapter for Tauri v2
 *
 * This module provides a centralized fetch implementation for Tauri v2.
 * For testing purposes, the fetch function can be overridden by setting
 * the global __TINFOIL_TEST_FETCH__ property.
 */
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

declare global {
  var __TINFOIL_TEST_FETCH__: typeof fetch | undefined;
}

/**
 * Get the fetch implementation to use.
 * In tests, this can be overridden by setting globalThis.__TINFOIL_TEST_FETCH__
 */
export function getFetch(): typeof tauriFetch {
  if (typeof globalThis.__TINFOIL_TEST_FETCH__ === "function") {
    return globalThis.__TINFOIL_TEST_FETCH__;
  }
  return tauriFetch;
}

/**
 * The fetch function to use throughout the application.
 * Uses Tauri's fetch by default, but can be mocked for testing.
 */
export const fetch = getFetch();
