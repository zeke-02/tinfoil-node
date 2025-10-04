import { SecureClient } from "tinfoil";

async function main() {
  try {
    const client = new SecureClient({
    });

    const response = await client.fetch("https:inference.tinfoil.sh/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-free",
        messages: [{ role: "user", content: "Hello!" }],
      }),
    });

    console.log(response);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();