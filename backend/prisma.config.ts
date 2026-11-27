import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";
import { assertSafeDevelopmentDatabase } from "./src/config/runtime-safety.js";

if (process.env.NODE_ENV !== "production") {
  loadEnv({ path: ".env.local" });
}

assertSafeDevelopmentDatabase();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "node prisma/seed.js"
  }
});
