// eslint-disable-next-line no-undef
const testTarget = process.env.TEST_TARGET ?? "src";

const targetMapper =
  testTarget === "lib"
    ? { "^(\\.\\./)+src/(.*)$": "<rootDir>/lib/cjs/$2.cjs" }
    : testTarget === "dist"
      ? { "^(\\.\\./)+src/(.*)$": "<rootDir>/dist/for-os.cjs" }
      : {};

const config = {
  verbose: true,
  // eslint-disable-next-line no-undef
  rootDir: __dirname,
  transform: { "^.+\\.ts$": "ts-jest" },
  testEnvironment: "node",
  testRegex: "/tests/.*\\.(test|spec)\\.(ts|tsx)$",
  moduleNameMapper: targetMapper,
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  collectCoverage: false,
  coverageDirectory: "./workdocs/reports/coverage",
  collectCoverageFrom: [
    "src/**/*.{js,jsx,ts,tsx}",
    "!src/bin",
    "!src/**/*.stories.{js,jsx,ts,tsx}",
  ],
  reporters: ["default"],
  watchman: false,
};

// eslint-disable-next-line no-undef
module.exports = config;
