import { defineConfig } from 'tsup';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Read version from package.json
const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, './package.json'), 'utf8')
);
const version = packageJson.version;

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
  // Use esbuild's define feature to replace the version at build time
  esbuildOptions(options) {
    options.define = {
      ...options.define,
      'process.env.PACKAGE_VERSION': JSON.stringify(version),
    };
  },
});
