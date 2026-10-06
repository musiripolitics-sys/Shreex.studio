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
    // Build output of `npm run test:email`: a bundle of src/lib/email.ts plus
    // its dependencies. Linting it reported 60 errors in nodemailer, which
    // drowned the 13 that are actually ours.
    ".tmp/**",
  ]),
]);

export default eslintConfig;
