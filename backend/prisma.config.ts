import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";
import { assertSafeDevelopmentDatabase } from "./src/config/runtime-safety.js";

const isProduction =
  process.env.NODE_ENV === "production" || process.env.RENDER === "true";

if (!isProduction) {
  loadEnv({ path: ".env.local" });
  assertSafeDevelopmentDatabase();
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "node prisma/seed.js"
  }
});
