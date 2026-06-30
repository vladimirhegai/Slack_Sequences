/**
 * Safe latency probe for the configured planning provider. It prints timing and
 * output length only—never keys, prompts, workspace content, or model output.
 */
import { PROVIDERS } from "@sequences/platform/providers";

const providerId = process.env.SLACK_SEQUENCES_PROVIDER ?? "openrouter-api";
const provider = PROVIDERS[providerId as keyof typeof PROVIDERS];
if (!provider) throw new Error(`unknown provider ${providerId}`);
const long = process.argv.includes("--long");
const prompt = long
  ? "Write a compact self-contained HTML fragment of about 700 words demonstrating a dashboard layout. Output HTML only."
  : "Return exactly the word OK and nothing else.";

for (const model of [
  process.env.SEQUENCES_OPENROUTER_MODEL ?? "deepseek/deepseek-v4-pro",
  process.env.SLACK_SEQUENCES_LIGHT_MODEL ?? "deepseek/deepseek-v4-flash",
]) {
  const started = performance.now();
  try {
    const output = await provider.complete(
      prompt,
      {
        model,
        maxTokens: long ? 1_200 : 32,
        thinkingMode: "none",
        timeoutMs: 60_000,
      },
    );
    console.log(JSON.stringify({
      model,
      elapsedMs: Math.round(performance.now() - started),
      outputChars: output.length,
      truncated: false,
    }));
  } catch (error) {
    console.log(JSON.stringify({
      model,
      elapsedMs: Math.round(performance.now() - started),
      outputChars: 0,
      truncated: error instanceof Error && error.name === "ProviderOutputTruncatedError",
    }));
  }
}
