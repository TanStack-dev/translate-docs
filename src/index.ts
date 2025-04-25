#!/usr/bin/env node

import { Command } from 'commander';
import { getConfig } from './config';
import { logger } from './logger';
import { main } from './main';
import type { MainConfig } from './types';

export type Config = MainConfig | MainConfig[];

// This string will be replaced during build
const version = '__VERSION__';

const program = new Command();

program
  .name('tanstack-translation')
  .description('Translate tanstack docs')
  .version(version, '-v, --version', 'Show version number')
  .option('-c, --config <path>', 'Path to configuration file')
  .option('--verbose', 'Enable verbose logging')
  .option(
    '-p, --pattern <pattern>',
    'File pattern to match for updating (e.g., "*.md" or "docs/**/*.md"). The .md extension is optional.',
  )
  .option('-l, --list-only', 'Only list file status without updating docs')
  .option(
    '-u, --update-config-only',
    'Only update config without processing docs',
  )
  .option(
    '-t, --target-language <language>',
    'Specify the target language code for translation (e.g., "zh-CN", "fr", "es")',
  )
  .action(
    async (options: {
      config?: string;
      verbose?: boolean;
      pattern?: string;
      listOnly?: boolean;
      updateConfigOnly?: boolean;
      targetLanguage?: string;
    }) => {
      if (options.verbose) {
        logger.setVerbose(true);
      }

      const config = await getConfig(options);
      const configs: MainConfig[] = Array.isArray(config) ? config : [config];

      for (const config of configs) {
        await main({
          ...config,
          pattern: options.pattern,
          listOnly: options.listOnly,
          updateConfigOnly: options.updateConfigOnly,
          targetLanguage: options.targetLanguage,
        });
      }
      logger.success('Process completed successfully');
    },
  );

program.parse();
