import { describe, it } from "node:test";
import assert from "node:assert";
import { streamText } from "ai";

interface TestConfig {
  apiKey: string;
}

const testConfig: TestConfig = {
  apiKey: "tinfoil",
};

const RUN_INTEGRATION = process.env.RUN_TINFOIL_INTEGRATION === "true";
const SKIP_MESSAGE =
  "Set RUN_TINFOIL_INTEGRATION=true to enable network integration tests.";

describe("TinfoilAI", () => {
  it("should create a client with direct parameters", async (t) => {
    if (!RUN_INTEGRATION) {
      t.skip(SKIP_MESSAGE);
      return;
    }

    const { TinfoilAI } = await import("../client");
    const client = new TinfoilAI({
      apiKey: testConfig.apiKey,
    });

    await client.ready();
    assert.ok(client, "Client instance should be created");
  });

  it("should create a client with environment variables fallback", async (t) => {
    if (!RUN_INTEGRATION) {
      t.skip(SKIP_MESSAGE);
      return;
    }

    process.env.TINFOIL_API_KEY = testConfig.apiKey;

    try {
      const { TinfoilAI } = await import("../client");
      const client = new TinfoilAI();
      await client.ready();
      assert.ok(client, "Client instance should be created with env fallback");
    } finally {
      delete process.env.TINFOIL_API_KEY;
    }
  });

  it("should perform non-streaming chat completion", async (t) => {
    if (!RUN_INTEGRATION) {
      t.skip(SKIP_MESSAGE);
      return;
    }

    const { TinfoilAI } = await import("../client");
    const client = new TinfoilAI({
      apiKey: testConfig.apiKey,
    });

    await client.ready();

    const response = await client.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "No matter what the user says, only respond with: Done.",
        },
        { role: "user", content: "Is this a test?" },
      ],
      model: "llama-free",
    });

    assert.ok(
      response.choices[0]?.message?.content,
      "Chat completion should return content",
    );
  });

  it("should handle streaming chat completion", async (t) => {
    if (!RUN_INTEGRATION) {
      t.skip(SKIP_MESSAGE);
      return;
    }

    const { TinfoilAI } = await import("../client");
    const client = new TinfoilAI({
      apiKey: testConfig.apiKey,
    });

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

  it("should pass client verification with the AI SDK provider", async (t) => {
    if (!RUN_INTEGRATION) {
      t.skip(SKIP_MESSAGE);
      return;
    }

    const { createTinfoilAI } = await import("../ai-sdk-provider");
    const tinfoilai = await createTinfoilAI(testConfig.apiKey);

    const { textStream } = streamText({
      model: tinfoilai("llama-free"),
      prompt: "say hi to me",
    });

    let seenText = "";
    for await (const textPart of textStream) {
      seenText += textPart;
    }

    assert.ok(seenText.length > 0, "Streamed text should be received");
  });
});
