import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  globalIgnores([".next/**", ".vercel/**", "out/**", "build/**", "backups/**", "public/agency-runtime/**", "next-env.d.ts"])
]);
