import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 10000,
    hookTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/services/**', 'src/lib/**'],
      exclude: [
        'src/**/*.test.ts',
        'src/__tests__/**',
        'src/lib/baileys-prisma-auth.ts' // Difícil de testar isoladamente
      ]
    }
  }
})
