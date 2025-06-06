import { defineConfig } from 'tsup';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// Use version from environment (set by semantic-release dry-run) or fallback to package.json
const version =
  process.env.NEXT_VERSION ||
  (() => {
    const packageJson = JSON.parse(readFileSync(resolve(__dirname, './package.json'), 'utf8'));
    return packageJson.version;
  })();

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
  // Apply version replacement after build
  async onSuccess() {
    const distPath = resolve(__dirname, './dist/index.js');
    const content = readFileSync(distPath, 'utf8');
    const updated = content.replace(/"__VERSION__"/g, `'${version}'`);
    writeFileSync(distPath, updated);
    console.log(`Version in dist/index.js set to ${version}`);
  },
});
