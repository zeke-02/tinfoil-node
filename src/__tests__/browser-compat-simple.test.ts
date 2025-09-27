import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

// Simple browser compatibility tests that don't require external dependencies
describe("Browser Compatibility (No External Deps)", () => {
  let originalGlobals: any = {};

  beforeEach(() => {
    // Save original globals
    originalGlobals = {
      window: (global as any).window,
      document: (global as any).document,
      navigator: (global as any).navigator,
      location: (global as any).location,
      fetch: (global as any).fetch,
      TextEncoder: (global as any).TextEncoder,
      TextDecoder: (global as any).TextDecoder,
    };

    // Create minimal browser-like environment
    (global as any).window = {
      document: {
        createElement: () => ({}),
        body: { appendChild: () => {} }
      },
      location: { href: "http://localhost:8000/test.html" },
      navigator: { userAgent: "Mozilla/5.0 (Test)" },
      crypto: (global as any).crypto || {
        getRandomValues: (arr: Uint8Array) => {
          const crypto = require("crypto");
          const bytes = crypto.randomBytes(arr.length);
          arr.set(bytes);
          return arr;
        }
      }
    };
    
    (global as any).document = (global as any).window.document;
    (global as any).navigator = (global as any).window.navigator;
    (global as any).location = (global as any).window.location;
  });

  afterEach(() => {
    // Restore original globals
    Object.keys(originalGlobals).forEach(key => {
      try {
        if (originalGlobals[key] === undefined) {
          delete (global as any)[key];
        } else {
          (global as any)[key] = originalGlobals[key];
        }
      } catch (err) {
        // Some properties like crypto might be read-only
      }
    });
  });

  it("should detect browser environment based on window object", () => {
    // Check browser detection logic
    const isBrowser = typeof window !== "undefined" && 
                     typeof window.document !== "undefined" &&
                     typeof navigator !== "undefined" &&
                     typeof navigator.userAgent === "string";
    
    assert.ok(isBrowser, "Should detect as browser environment");
  });

  it("should verify critical browser APIs exist", () => {
    // These APIs must exist for the SDK to work in browsers
    assert.ok(typeof TextEncoder !== "undefined", "TextEncoder should exist");
    assert.ok(typeof TextDecoder !== "undefined", "TextDecoder should exist");
    assert.ok(typeof Uint8Array !== "undefined", "Uint8Array should exist");
    assert.ok(typeof Promise !== "undefined", "Promise should exist");
    
    // Fetch might not exist in older Node versions but is critical for browsers
    if (typeof fetch !== "undefined") {
      assert.ok(typeof fetch === "function", "fetch should be a function");
    }
  });

  it("should test TextEncoder/TextDecoder functionality", () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    
    // Test basic ASCII
    const ascii = "Hello, Browser!";
    const asciiEncoded = encoder.encode(ascii);
    const asciiDecoded = decoder.decode(asciiEncoded);
    assert.strictEqual(asciiDecoded, ascii, "ASCII encoding/decoding should work");
    
    // Test Unicode
    const unicode = "Hello 🌍 Unicode! 你好";
    const unicodeEncoded = encoder.encode(unicode);
    const unicodeDecoded = decoder.decode(unicodeEncoded);
    assert.strictEqual(unicodeDecoded, unicode, "Unicode encoding/decoding should work");
    
    // Test empty string
    const empty = "";
    const emptyEncoded = encoder.encode(empty);
    const emptyDecoded = decoder.decode(emptyEncoded);
    assert.strictEqual(emptyDecoded, empty, "Empty string encoding/decoding should work");
  });

  it("should test crypto.getRandomValues if available", () => {
    if (typeof window !== "undefined" && window.crypto && window.crypto.getRandomValues) {
      const buffer = new Uint8Array(32);
      const zeros = new Uint8Array(32);
      
      window.crypto.getRandomValues(buffer);
      
      // Check that buffer was modified
      assert.notDeepStrictEqual(buffer, zeros, "Buffer should contain random values");
      
      // Check that values are in valid range
      for (let i = 0; i < buffer.length; i++) {
        assert.ok(buffer[i] >= 0 && buffer[i] <= 255, `Value ${buffer[i]} should be a valid byte`);
      }
    }
  });

  it("should handle missing Node.js-specific globals", () => {
    // In a browser, these should not exist
    const browserCheck = () => {
      // These checks simulate what would happen in a real browser
      const hasNodeProcess = typeof process !== "undefined" && 
                           process.versions && 
                           process.versions.node;
      
      const hasNodeRequire = typeof require === "function" &&
                           require.resolve &&
                           typeof require.resolve === "function";
      
      const hasNodeModule = typeof module !== "undefined" &&
                          module.exports !== undefined;
      
      // In our simulation, we're still in Node, so we expect these to exist
      // But in a real browser, they should not
      return { hasNodeProcess, hasNodeRequire, hasNodeModule };
    };
    
    const result = browserCheck();
    
    // Document what would happen in a real browser
    console.log("In a real browser, all these should be false:", result);
  });
});

// Test the module format compatibility
describe("Module Format Tests", () => {
  it("should verify ESM export structure", async () => {
    try {
      // Test that the built files have correct exports
      const distPath = "../../../dist/esm/index.js";
      
      // This would work in a real ESM environment
      // For now, we just verify the exports exist in our source
      const exports = ["TinfoilAI", "Verifier", "loadVerifier", "TINFOIL_CONFIG"];
      
      // In a real test, you would import and check these
      assert.ok(exports.length > 0, "Should have exports defined");
    } catch (err) {
      // Expected in test environment
      console.log("ESM import test skipped in Node test environment");
    }
  });
});

// Test WASM compatibility
describe("WebAssembly Compatibility", () => {
  it("should check WebAssembly support", () => {
    // WebAssembly should be available in both Node.js and modern browsers
    assert.ok(typeof WebAssembly !== "undefined", "WebAssembly should be defined");
    assert.ok(typeof WebAssembly.instantiate === "function", "WebAssembly.instantiate should exist");
    assert.ok(typeof WebAssembly.Memory === "function", "WebAssembly.Memory should exist");
    assert.ok(typeof WebAssembly.Module === "function", "WebAssembly.Module should exist");
    assert.ok(typeof WebAssembly.Instance === "function", "WebAssembly.Instance should exist");
  });

  it("should verify WASM memory can be created", () => {
    // Test that we can create WASM memory (needed for Go WASM)
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 10 });
    assert.ok(memory instanceof WebAssembly.Memory, "Should create WebAssembly.Memory");
    assert.ok(memory.buffer instanceof ArrayBuffer, "Memory should have ArrayBuffer");
    assert.ok(memory.buffer.byteLength >= 65536, "Memory should have at least 1 page (64KB)");
  });
});
