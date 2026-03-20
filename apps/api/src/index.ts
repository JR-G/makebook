import "dotenv/config";
import { createApp } from "./app.js";
import { loadConfig } from "./config/index.js";

const config = loadConfig();
const app = createApp();

app.listen(config.port, () => {
  /** Startup log intentionally kept to stdout for container orchestration. */
  process.stdout.write(`MakeBook API listening on port ${config.port}\n`);
});
