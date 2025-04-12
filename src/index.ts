#!/usr/bin/env node

import { Command } from 'commander';
import { getConfig } from './config';
import { main } from './main';
import type { MainConfig } from './types';
import { logger } from './logger';

export type Config = MainConfig | MainConfig[];

const program = new Command();

program
  .name('tanstack-translation')
  .description('Translate tanstack docs')
  .option('-c, --config <path>', 'Path to configuration file')
  .option('-v, --verbose', 'Enable verbose logging')
  .option(
    '-p, --pattern <pattern>',
    'File pattern to match for updating (e.g., "*.md" or "docs/**/*.tsx")',
  )
  .option('-l, --list-only', 'Only list file status without updating docs')
  .option(
    '-u, --update-config-only',
    'Only update config without processing docs',
  )
  .action(
    async (options: {
      config?: string;
      verbose?: boolean;
      pattern?: string;
      listOnly?: boolean;
      updateConfigOnly?: boolean;
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
        });
      }
      logger.success('Process completed successfully');
    },
  );

program.parse();
