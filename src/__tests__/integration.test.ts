import { describe, it } from "node:test";
import assert from "node:assert";
import { streamText } from "ai";

const RUN_INTEGRATION = process.env.RUN_TINFOIL_INTEGRATION === "true";
const SKIP_MESSAGE =
  "Set RUN_TINFOIL_INTEGRATION=true to enable network integration tests.";

describe("Examples Integration Tests", () => {
  describe("Basic Chat Example", () => {
    it("should create a TinfoilAI client and make a chat completion request", async (t) => {
      if (!RUN_INTEGRATION) {
        t.skip(SKIP_MESSAGE);
        return;
      }

      const { TinfoilAI } = await import("../tinfoilai");
      
      // Create a client similar to the basic chat example
      const client = new TinfoilAI({
        apiKey: "tinfoil",
      });

      // Verify the client is properly initialized
      assert.ok(client, "Client should be created");
      
      // Wait for client to be ready
      await client.ready();
      
      // Make a simple chat completion request
      const completion = await client.chat.completions.create({
        messages: [{ role: "user", content: "Hello!" }],
        model: "llama-free",
      });

      // Verify the response structure
      assert.ok(completion, "Completion should be returned");
      assert.ok(Array.isArray(completion.choices), "Choices should be an array");
      assert.ok(completion.choices.length > 0, "Should have at least one choice");
      
      const firstChoice = completion.choices[0];
      assert.ok(firstChoice, "First choice should exist");
      assert.ok(firstChoice.message, "First choice should have a message");
      
      const message = firstChoice.message;
      assert.strictEqual(typeof message.content, "string", "Message content should be a string");
      assert.ok(message.content && message.content.length > 0, "Message content should not be empty");
    });
  });

  describe("Secure Client Example", () => {
    it("should create a SecureClient and make a direct fetch request", async (t) => {
      if (!RUN_INTEGRATION) {
        t.skip(SKIP_MESSAGE);
        return;
      }

      const { SecureClient } = await import("../secure-client");
      
      // Create a client similar to the secure client example
      const client = new SecureClient();

      // Verify the client is properly initialized
      assert.ok(client, "Client should be created");

      // Wait for client to be ready
      await client.ready();

      // Make a direct fetch request to the chat completions endpoint
      const response = await client.fetch("/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-free",
          messages: [{ role: "user", content: "Hello!" }],
        }),
      });

      // Verify the response
      assert.ok(response, "Response should be returned");
      assert.strictEqual(response.status, 200, "Response should have status 200");
      assert.ok(response.headers, "Response should have headers");

      // Parse and verify the response body
      const responseBody = await response.json();
      assert.ok(responseBody, "Response body should be parseable");
      assert.ok(Array.isArray(responseBody.choices), "Choices should be an array");
      assert.ok(responseBody.choices.length > 0, "Should have at least one choice");
      
      const firstChoice = responseBody.choices[0];
      assert.ok(firstChoice, "First choice should exist");
      assert.ok(firstChoice.message, "First choice should have a message");
      
      const message = firstChoice.message;
      assert.strictEqual(typeof message.content, "string", "Message content should be a string");
      assert.ok(message.content && message.content.length > 0, "Message content should not be empty");
    });
  });

  describe("EHBP Chat Example", () => {
    it("should create a TinfoilAI client with EHBP configuration and make a chat completion request", async (t) => {
      if (!RUN_INTEGRATION) {
        t.skip(SKIP_MESSAGE);
        return;
      }

      const { TinfoilAI } = await import("../tinfoilai");
      
      // Create a client using environment variable configuration
      const client = new TinfoilAI({
        apiKey: "tinfoil",
      });

      // Verify the client is properly initialized
      assert.ok(client, "Client should be created");
      
      // Wait for client to be ready
      await client.ready();
      
      // Make a simple chat completion request
      const completion = await client.chat.completions.create({
        messages: [{ role: "user", content: "Hello!" }],
        model: "llama-free",
      });

      // Verify the response structure
      assert.ok(completion, "Completion should be returned");
      assert.ok(Array.isArray(completion.choices), "Choices should be an array");
      assert.ok(completion.choices.length > 0, "Should have at least one choice");
      
      const firstChoice = completion.choices[0];
      assert.ok(firstChoice, "First choice should exist");
      assert.ok(firstChoice.message, "First choice should have a message");
      
      const message = firstChoice.message;
      assert.strictEqual(typeof message.content, "string", "Message content should be a string");
      assert.ok(message.content && message.content.length > 0, "Message content should not be empty");
    });
  });

  describe("EHBP Secure Client Example", () => {
    it("should create a SecureClient with EHBP configuration and make a direct fetch request", async (t) => {
      if (!RUN_INTEGRATION) {
        t.skip(SKIP_MESSAGE);
        return;
      }

      const { SecureClient } = await import("../secure-client");
      
      // Create a client using environment variable configuration
      const client = new SecureClient();

      // Verify the client is properly initialized
      assert.ok(client, "Client should be created");
      
      // Wait for client to be ready
      await client.ready();
      
      // Make a direct fetch request to the chat completions endpoint
      const response = await client.fetch("/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-free",
          messages: [{ role: "user", content: "Hello!" }],
        }),
      });

      // Verify the response
      assert.ok(response, "Response should be returned");
      assert.strictEqual(response.status, 200, "Response should have status 200");
      assert.ok(response.headers, "Response should have headers");

      // Parse and verify the response body
      const responseBody = await response.text();
      assert.ok(responseBody, "Response body should be returned as text");
      assert.ok(responseBody.length > 0, "Response body should not be empty");
      
      // Try to parse as JSON to verify it's valid JSON
      const parsedBody = JSON.parse(responseBody);
      assert.ok(parsedBody, "Response body should be parseable as JSON");
      assert.ok(Array.isArray(parsedBody.choices), "Choices should be an array");
      assert.ok(parsedBody.choices.length > 0, "Should have at least one choice");
      
      const firstChoice = parsedBody.choices[0];
      assert.ok(firstChoice, "First choice should exist");
    });
  });

    describe("EHBP Unverified Client Example", () => {
    it("should create a UnverifiedClient with EHBP configuration and make a direct fetch request", async (t) => {
      if (!RUN_INTEGRATION) {
        t.skip(SKIP_MESSAGE);
        return;
      }

      const { UnverifiedClient } = await import("../unverified-client");
      
      // Create a client using environment variable configuration
      const client = new UnverifiedClient();

      // Verify the client is properly initialized
      assert.ok(client, "Client should be created");
      
      // Wait for client to be ready
      await client.ready();
      
      // Make a direct fetch request to the chat completions endpoint
      const response = await client.fetch("/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-free",
          messages: [{ role: "user", content: "Hello!" }],
        }),
      });

      // Verify the response
      assert.ok(response, "Response should be returned");
      assert.strictEqual(response.status, 200, "Response should have status 200");
      assert.ok(response.headers, "Response should have headers");

      // Parse and verify the response body
      const responseBody = await response.text();
      assert.ok(responseBody, "Response body should be returned as text");
      assert.ok(responseBody.length > 0, "Response body should not be empty");
      
      // Try to parse as JSON to verify it's valid JSON
      const parsedBody = JSON.parse(responseBody);
      assert.ok(parsedBody, "Response body should be parseable as JSON");
      assert.ok(Array.isArray(parsedBody.choices), "Choices should be an array");
      assert.ok(parsedBody.choices.length > 0, "Should have at least one choice");
      
      const firstChoice = parsedBody.choices[0];
      assert.ok(firstChoice, "First choice should exist");
    });
  });

  describe("Streaming Chat Completion", () => {
    it("should handle streaming chat completion", async (t) => {
      if (!RUN_INTEGRATION) {
        t.skip(SKIP_MESSAGE);
        return;
      }

      const { TinfoilAI } = await import("../tinfoilai");
      const client = new TinfoilAI({ apiKey: "tinfoil" });

      await client.ready();

      const stream = await client.chat.completions.create({
        messages: [
          {
            role: "system",
            content: "No matter what the user says, only respond with: Done.",
          },
          { role: "user", content: "Is this a test?" },
        ],
        model: "llama-free",
        stream: true,
      });

      let accumulatedContent = "";

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          accumulatedContent += content;
        }
      }

      assert.ok(
        accumulatedContent.length > 0,
        "Streaming completion should produce content",
      );
    });
  });
});