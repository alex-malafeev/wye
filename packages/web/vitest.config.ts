import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node', passWithNoTests: true, env: { WYE_INDEX_WARM: '0' } },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
});
