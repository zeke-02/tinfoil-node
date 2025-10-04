import { TinfoilAI } from "tinfoil";

async function main() {
  try {
    const client = new TinfoilAI({
      baseURL: "https://ehbp.inf6.tinfoil.sh/v1/",
      enclaveURL: "https://ehbp.inf6.tinfoil.sh/v1/",
      configRepo: "tinfoilsh/confidential-inference-proxy-hpke",
    });

    const completion = await client.chat.completions.create({
      messages: [{ role: "user", content: "Hello!" }],
      model: "llama-free",
    });

    console.log(completion.choices[0]?.message?.content);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();