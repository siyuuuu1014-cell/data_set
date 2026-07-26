import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "workers/video-annotation/.venv/**",
    "workers/video-annotation/.pytest_cache/**",
    "workers/video-annotation/**/__pycache__/**",
    "workers/video-annotation/*.egg-info/**",
  ]),
]);

export default eslintConfig;
