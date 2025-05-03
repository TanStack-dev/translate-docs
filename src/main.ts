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

/**
 * Normalizes a pattern by removing docsRoot prefix if present
 */
function normalizePattern(
  pattern: string,
  normalizedDocsRoot: string,
  docsRootName: string,
): string {
  // Check if pattern starts with docsRoot or its basename
  if (pattern.startsWith(`${normalizedDocsRoot}/`)) {
    // Strip full docsRoot path from pattern
    const processed = pattern.substring(normalizedDocsRoot.length + 1);
    logger.debug(`Normalized pattern from ${pattern} to ${processed}`);
    return processed;
  } else if (pattern.startsWith(`${docsRootName}/`)) {
    // Strip docsRoot basename from pattern
    const processed = pattern.substring(docsRootName.length + 1);
    logger.debug(`Normalized pattern from ${pattern} to ${processed}`);
    return processed;
  }
  return pattern;
}

/**
 * Normalizes comma-separated patterns or array of patterns
 */
function normalizePatterns(
  patterns: string | string[] | undefined,
  normalizedDocsRoot: string,
  docsRootName: string,
): string[] {
  if (!patterns) {
    return [];
  }
  
  // If patterns is already an array, process each item
  if (Array.isArray(patterns)) {
    return patterns
      .map(p => normalizePattern(p.trim(), normalizedDocsRoot, docsRootName))
      .filter(p => p !== '');
  }
  
  // Otherwise, treat as a string and split by comma
  return patterns
    .split(',')
    .map(p => normalizePattern(p.trim(), normalizedDocsRoot, docsRootName))
    .filter(p => p !== '');
}

export async function main({
  langs,
  docsRoot,
  docsContext,
  pattern,
  ignore,
  copyPath,
  listOnly,
  updateConfigOnly,
  targetLanguage,
}: MainConfig): Promise<void> {
  // If targetLanguage is specified, filter the langs object to only include that language
  const filteredLangs = targetLanguage
    ? Object.fromEntries(
        Object.entries(langs).filter(
          ([key]) => key.toLowerCase() === targetLanguage.toLowerCase(),
        ),
      )
    : langs;

  // If targetLanguage was specified but not found in langs, show a warning
  if (targetLanguage && Object.keys(filteredLangs).length === 0) {
    logger.warn(
      `Target language "${targetLanguage}" not found in configuration. Available languages: ${Object.keys(
        langs,
      ).join(', ')}`,
    );
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

  // Normalize docsRoot for path comparison (ensure it has no trailing slash)
  const normalizedDocsRoot = docsRoot.endsWith('/')
    ? docsRoot.slice(0, -1)
    : docsRoot;
  const docsRootName = path.basename(normalizedDocsRoot);

  // Process pattern(s)
  const processedPatterns = normalizePatterns(
    pattern,
    normalizedDocsRoot,
    docsRootName
  );
  
  // Process ignore patterns
  const processedIgnorePatterns = normalizePatterns(
    ignore,
    normalizedDocsRoot, 
    docsRootName
  );
  
  // Process copy paths
  const processedCopyPathPatterns = normalizePatterns(
    copyPath,
    normalizedDocsRoot,
    docsRootName
  );
  
  // Log patterns if provided
  if (processedPatterns.length > 0) {
    logger.info(`Using patterns: ${processedPatterns.join(', ')}`);
  }
  if (processedIgnorePatterns.length > 0) {
    logger.info(`Using ignore patterns: ${processedIgnorePatterns.join(', ')}`);
  }
  if (processedCopyPathPatterns.length > 0) {
    logger.info(`Using copy-path patterns: ${processedCopyPathPatterns.join(', ')}`);
  }

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

    // Apply file filtering based on patterns
    let filteredPaths = docPaths;
    
    // Step 1: Apply include pattern if specified
    if (processedPatterns.length > 0) {
      // Normalize the patterns by removing .md extension if present
      const normalizedPatterns = processedPatterns.map(p =>
        p.endsWith('.md') ? p.slice(0, -3) : p
      );
      
      filteredPaths = micromatch(filteredPaths, normalizedPatterns);
    }
    
    // Step 2: Apply ignore patterns if specified
    if (processedIgnorePatterns.length > 0) {
      // Remove .md extension from patterns if present
      const normalizedIgnorePatterns = processedIgnorePatterns.map(p => 
        p.endsWith('.md') ? p.slice(0, -3) : p
      );
      
      filteredPaths = micromatch.not(filteredPaths, normalizedIgnorePatterns);
    }
    
    // Create a set for paths that should be copied without translation
    const copyWithoutTranslationSet = new Set<string>();
    if (processedCopyPathPatterns.length > 0) {
      // Remove .md extension from patterns if present
      const normalizedCopyPatterns = processedCopyPathPatterns.map(p => 
        p.endsWith('.md') ? p.slice(0, -3) : p
      );
      
      // Find matches and add to set
      const copyMatches = micromatch(filteredPaths, normalizedCopyPatterns);
      copyMatches.forEach(match => copyWithoutTranslationSet.add(match));
    }

    // Extract path to label mappings from translated config
    const pathToLabelMap = extractPathToLabelMap(translatedConfig);

    // Create translation tasks list
    const tasks = [];

    // Log document status
    const tableData = [];
    
    for (const docPath of filteredPaths) {
      const sourcePath = path.join(docsRoot, `${docPath}.md`);
      const targetPath = path.join(translatedRoot, `${docPath}.md`);
      const [shouldUpdate, shouldTranslate, reason] = await getDocUpdateStatus({
        sourcePath,
        targetPath,
      });
      
      // Check if this path should be copied without translation
      const isCopyPath = copyWithoutTranslationSet.has(docPath);
      
      // If it's in copyPath list, we should force copy without translation
      const finalShouldTranslate = isCopyPath ? false : shouldTranslate;
      
      tableData.push({
        Source: sourcePath,
        Target: targetPath,
        'Needs Update': shouldUpdate ? '✅ Yes' : '❌ No',
        'Needs Translation': finalShouldTranslate ? '✅ Yes' : '❌ No',
        'Copy Only': isCopyPath ? '✅ Yes' : '❌ No',
        Reason: isCopyPath ? 'Marked for copy only' : (reason || 'No changes needed'),
      });

      if (shouldUpdate) {
        tasks.push({
          docPath,
          sourcePath,
          shouldTranslate: finalShouldTranslate,
          targetPath,
        });
      }
    }
    
    console.log('\n📋 Document Status:\n');
    console.table(tableData);
    logger.info(
      `Found ${tasks.length}/${filteredPaths.length} documents to translate`,
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
