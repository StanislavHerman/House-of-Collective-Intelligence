/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
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

