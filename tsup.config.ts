import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  external: [
    'commander',
    'cosmiconfig',
    'openai',
    'gray-matter',
    'node:fs',
    'node:fs/promises',
    'node:path',
    'node:crypto',
    'node:child_process',
  ],
  platform: 'node',
  target: 'node20',
});
