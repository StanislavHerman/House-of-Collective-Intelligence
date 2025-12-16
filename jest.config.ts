import type { Config } from 'jest';

const config: Config = {
  // preset: 'ts-jest/presets/default-esm', // Removed to avoid conflict with manual transform
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1', // Handle .js imports in TS files
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          target: 'ES2022',
          module: 'ESNext',
          allowJs: true,
          esModuleInterop: true,
        },
        diagnostics: {
          ignoreCodes: [1343],
        },
      },
    ],
  },
};

export default config;
