import js from "@eslint/js";

export default [
  { ignores: [".netlify/**", "node_modules/**"] },
  js.configs.recommended,
  {
    rules: {
      // Standard convention for "destructured to omit from the rest, never
      // read directly" — e.g. server/engine/llmClient.js's { x: _x, y: _y }.
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Server, Netlify function, and test code — Node environment.
    files: ["server/**/*.js", "netlify/**/*.js", "tests/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        AbortController: "readonly",
      },
    },
  },
  {
    // Frontend — browser environment, no bundler/build step.
    files: ["public/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        document: "readonly",
        window: "readonly",
        localStorage: "readonly",
        fetch: "readonly",
        getComputedStyle: "readonly",
      },
    },
  },
];
