import { analyzeWebsite } from "./website-analyzer.js";

const websiteUrl =
  process.argv[2] ?? "https://example.com";

async function main(): Promise<void> {
  try {
    console.log("");
    console.log("========================================");
    console.log(" WEBSITE ANALYZER TEST");
    console.log("========================================");
    console.log("");

    console.log(`Analyzing: ${websiteUrl}`);
    console.log("");

    const result =
      await analyzeWebsite(websiteUrl);

    console.log(
      JSON.stringify(result, null, 2)
    );

    console.log("");
    console.log("========================================");
    console.log(" ANALYSIS COMPLETE");
    console.log("========================================");
  } catch (error) {
    console.error("");
    console.error(
      "Website analysis FAILED."
    );

    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }

    process.exitCode = 1;
  }
}

await main();