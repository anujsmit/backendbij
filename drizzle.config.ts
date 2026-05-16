import type { Config } from "drizzle-kit";
import "dotenv/config";

declare const process: {
  env: {
    DATABASE_URL: string;
  };
};

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
