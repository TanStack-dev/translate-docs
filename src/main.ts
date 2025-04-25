import * as fs$ from 'node:fs/promises';
import * as path from 'node:path';
import micromatch from 'micromatch';

import { executeInBatches } from './batch';
import { logger } from './logger';
import { $translateConfig } from './openai';
import {
  copyDoc,
  extractDocPaths,
  extractPathToLabelMap,
  getTranslatedConfig,
  shouldTranslateConfig,
  getDocUpdateStatus,
  translateDoc,
} from './utils';
import { MainConfig } from './types';

export async function main({
  langs,
  docsRoot,
  docsContext,
  pattern,
  listOnly,
  updateConfigOnly,
  targetLanguage,
}: MainConfig): Promise<void> {
  // If targetLanguage is specified, filter the langs object to only include that language
  const filteredLangs = targetLanguage 
    ? Object.fromEntries(
        Object.entries(langs).filter(([key]) => key.toLowerCase() === targetLanguage.toLowerCase())
      )
    : langs;
    
  // If targetLanguage was specified but not found in langs, show a warning
  if (targetLanguage && Object.keys(filteredLangs).length === 0) {
    logger.warn(`Target language "${targetLanguage}" not found in configuration. Available languages: ${Object.keys(langs).join(', ')}`);
    return;
  }

  const LANGUAGES = Object.keys(filteredLangs);

  logger.divider();
  logger.info(
    `Translation for ${docsRoot} in languages: ${LANGUAGES.join(
      ', ',
    )} started!`,
  );

  const docsConfigPath = path.join(docsRoot, 'config.json');
  logger.debug(`Source documentation root: ${docsRoot}`);
  logger.debug(`Source config path: ${docsConfigPath}`);

  const docsConfig = JSON.parse(await fs$.readFile(docsConfigPath, 'utf8'));

  for (const [lang, langConfig] of Object.entries(filteredLangs)) {
    logger.divider();
    logger.info(`language: ${lang} (${langConfig.name})`);

    // Convert language to lowercase to match the folder name
    const translatedRoot = path.join(docsRoot, lang.toLowerCase());
    const translatedConfigPath = path.join(translatedRoot, 'config.json');
    logger.debug(`Target root: ${translatedRoot}`);
    logger.debug(`Target config: ${translatedConfigPath}`);

    await fs$.mkdir(translatedRoot, { recursive: true });

    let translatedConfig = await getTranslatedConfig(translatedConfigPath);

    if (!listOnly) {
      if (shouldTranslateConfig(docsConfig, translatedConfig)) {
        logger.info('Config needs translation, updating translation...');
        translatedConfig = await $translateConfig({
          docsConfig,
          langConfig,
          docsContext,
        });

        await fs$.writeFile(
          translatedConfigPath,
          JSON.stringify(translatedConfig, null, 2),
          'utf8',
        );
        logger.success('Successfully translated config');
      } else {
        logger.info('Config structure unchanged, no translation needed.');
      }
    }
    if (updateConfigOnly) return;

    // Extract all document paths
    const docPaths = extractDocPaths(docsConfig);

    // Filter paths based on pattern if provided using micromatch
    // micromatch supports glob patterns like:
    // - * matches any characters (e.g., "docs/*" matches all files in docs directory)
    // - ? matches any single character (e.g., "docs/?.md" matches single-character filenames)
    // - [!...] matches any character not in the brackets (e.g., "docs/[!a]*" matches files not starting with 'a')
    // Examples:
    // - "*tutorial*" matches any path containing "tutorial"
    // - "docs/tutorial*" matches paths starting with "docs/tutorial"
    // - "*tutorial" matches paths ending with "tutorial"
    // - "docs/*/tutorial" matches tutorial files in any subdirectory of docs
    const filteredDocPaths = pattern
      ? (() => {
          // Normalize the pattern by removing .md extension if present
          // This handles cases where users specify patterns like "*.md" or "docs/**/*.md"
          const normalizedPattern = pattern.endsWith('.md') 
            ? pattern.slice(0, -3) 
            : pattern;
          
          return micromatch(docPaths, normalizedPattern);
        })()
      : docPaths;

    // Extract path to label mappings from translated config
    const pathToLabelMap = extractPathToLabelMap(translatedConfig);

    // Create translation tasks list
    const tasks = [];

    // Log document status
    const tableData = [];
    for (const docPath of filteredDocPaths) {
      const sourcePath = path.join(docsRoot, `${docPath}.md`);
      const targetPath = path.join(translatedRoot, `${docPath}.md`);
      const [shouldUpdate, shouldTranslate, reason] = await getDocUpdateStatus({
        sourcePath,
        targetPath,
      });
      tableData.push({
        Source: sourcePath,
        Target: targetPath,
        'Needs Update': shouldUpdate ? '✅ Yes' : '❌ No',
        'Needs Translation': shouldTranslate ? '✅ Yes' : '❌ No',
        Reason: reason || 'No changes needed',
      });

      if (shouldUpdate) {
        tasks.push({
          docPath,
          sourcePath,
          shouldTranslate,
          targetPath,
        });
      }
    }
    console.log('\n📋 Document Status:\n');
    console.table(tableData);
    logger.info(
      `Found ${tasks.length}/${filteredDocPaths.length} documents to translate`,
    );

    let completedRefDocs = 0;
    const concurrency = 10;
    if (!listOnly) {
      await executeInBatches(
        tasks,
        async (task) => {
          if (task.shouldTranslate) {
            const title = pathToLabelMap[task.docPath];
            await translateDoc({
              sourcePath: task.sourcePath,
              targetPath: task.targetPath,
              langConfig,
              docsContext,
              title,
            });
          } else {
            await copyDoc({
              sourcePath: task.sourcePath,
              targetPath: task.targetPath,
              docsRoot,
              translatedRoot,
            });
          }

          completedRefDocs++;
          logger.progress(completedRefDocs, tasks.length, 'Updating documents');
        },
        concurrency,
      );
    }

    logger.success(`Completed processing for language: ${lang}`);
  }

  logger.divider();
}
