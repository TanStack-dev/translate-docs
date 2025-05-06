import * as fs$ from 'node:fs/promises';
import * as path from 'node:path';
import micromatch from 'micromatch';
import { executeInBatches } from './batch';
import { logger } from './logger';
import { $translateConfig } from './openai';
import {
  copyDoc,
  extractPathToLabelMap,
  getTranslatedConfig,
  shouldTranslateConfig,
  getDocUpdateStatus,
  translateDoc,
  findDocFiles,
  normalizePatterns,
} from './utils';
import { MainConfig } from './types';

export async function main({
  langs,
  docsRoot = 'docs',
  docsContext,
  pattern,
  copyPath,
  docsPath = ['**/*.md'],
  listOnly,
  targetLanguage,
}: MainConfig): Promise<void> {
  // Filter languages based on targetLanguage if specified
  const filteredLangs = targetLanguage
    ? Object.fromEntries(
        Object.entries(langs).filter(([key]) => key.toLowerCase() === targetLanguage.toLowerCase()),
      )
    : langs;

  // Early return if targetLanguage was specified but not found
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
  logger.info(`Translation for ${docsRoot} in languages: ${LANGUAGES.join(', ')} started!`);

  // Load source config file
  const docsConfigPath = path.join(docsRoot, 'config.json');
  logger.debug(`Source documentation root: ${docsRoot}`);
  logger.debug(`Source config path: ${docsConfigPath}`);
  const docsConfig = JSON.parse(await fs$.readFile(docsConfigPath, 'utf8'));

  // Normalize paths and prepare patterns
  const normalizedDocsRoot = docsRoot.endsWith('/') ? docsRoot.slice(0, -1) : docsRoot;
  const docsRootName = path.basename(normalizedDocsRoot);

  // Process all patterns
  const processedPatterns = normalizePatterns(pattern, normalizedDocsRoot, docsRootName);
  const processedCopyPathPatterns = normalizePatterns(copyPath, normalizedDocsRoot, docsRootName);
  const processedDocsPathPatterns = normalizePatterns(docsPath, normalizedDocsRoot, docsRootName);

  // Log patterns if provided
  if (processedDocsPathPatterns.length > 0) {
    logger.info(`Using docs-path patterns: ${processedDocsPathPatterns.join(', ')}`);
  }
  if (processedPatterns.length > 0) {
    logger.info(`Using patterns: ${processedPatterns.join(', ')}`);
  }
  if (processedCopyPathPatterns.length > 0) {
    logger.info(`Using copy-path patterns: ${processedCopyPathPatterns.join(', ')}`);
  }

  // Process each language
  for (const [lang, langConfig] of Object.entries(filteredLangs)) {
    logger.divider();
    logger.info(`language: ${lang} (${langConfig.name})`);

    // Setup target paths
    const translatedRoot = path.join(docsRoot, lang.toLowerCase());
    const translatedConfigPath = path.join(translatedRoot, 'config.json');
    logger.debug(`Target root: ${translatedRoot}`);
    logger.debug(`Target config: ${translatedConfigPath}`);

    // Ensure target directory exists
    await fs$.mkdir(translatedRoot, { recursive: true });

    // Load existing translated config if any
    let translatedConfig = await getTranslatedConfig(translatedConfigPath);
    const configNeedsTranslation = shouldTranslateConfig(docsConfig, translatedConfig);

    // Get document paths from filesystem or use empty array if no patterns
    let docPaths: string[] = [];
    if (processedDocsPathPatterns.length > 0) {
      // Find all matching files from filesystem
      const filesFromFilesystem = await findDocFiles(docsRoot, processedDocsPathPatterns);

      // Filter out language-specific paths
      const langPatterns = Object.keys(langs).map((lang) => `${lang.toLowerCase()}/`);
      docPaths = filesFromFilesystem.filter((filePath) => {
        const relativePath = path.relative(docsRoot, path.join(docsRoot, filePath));
        return !langPatterns.some((langPattern) => relativePath.startsWith(langPattern));
      });
    } else {
      logger.warn(
        'No docsPath specified. No files will be processed. Please provide a docsPath pattern like --docs-path "**/*.md"',
      );
    }

    // Add config.json as special document to process
    const configDocPath = 'config.json';
    docPaths = [configDocPath, ...docPaths];

    // Create normalized patterns for filtering
    const normalizedIncludePatterns = processedPatterns.map((p) =>
      p.endsWith('.md') ? p.slice(0, -3) : p,
    );

    const normalizedCopyPatterns = processedCopyPathPatterns.map((p) =>
      p.endsWith('.md') ? p.slice(0, -3) : p,
    );

    // Apply filtering based on patterns
    let filteredPaths = docPaths;

    // Apply include pattern if specified
    if (normalizedIncludePatterns.length > 0) {
      filteredPaths = micromatch(filteredPaths, normalizedIncludePatterns);
    }

    // Create a set for paths that should be copied without translation
    const copyWithoutTranslationSet = new Set<string>();
    if (normalizedCopyPatterns.length > 0) {
      const copyMatches = micromatch(filteredPaths, normalizedCopyPatterns);
      for (const match of copyMatches) {
        copyWithoutTranslationSet.add(match);
      }
    }

    logger.info(
      `Found ${docPaths.length} files from filesystem, ${filteredPaths.length} files to process`,
    );

    // Extract path to label mappings from translated config
    const pathToLabelMap = extractPathToLabelMap(translatedConfig);

    // Build tasks list and document status table
    const tasks = [];
    const tableData = [];

    for (const docPath of filteredPaths) {
      // Special handling for config.json
      if (docPath === configDocPath) {
        tableData.push({
          Source: docsConfigPath,
          Target: translatedConfigPath,
          'Update?': configNeedsTranslation ? '✅ Yes' : '❌ No',
          'Translate?': configNeedsTranslation ? '✅ Yes' : '❌ No',
          Reason: configNeedsTranslation ? 'Config structure changed' : 'No changes needed',
        });

        if (configNeedsTranslation) {
          tasks.push({
            docPath,
            sourcePath: docsConfigPath,
            shouldTranslate: true,
            targetPath: translatedConfigPath,
            isConfig: true, // Mark as config file for special handling
          });
        }
        continue;
      }

      // Regular document handling
      const sourcePath = path.join(docsRoot, `${docPath}.md`);
      const targetPath = path.join(translatedRoot, `${docPath}.md`);

      // Check if this path should be copied without translation
      const isCopyPath = copyWithoutTranslationSet.has(docPath);
      const [shouldUpdate, shouldTranslate, reason] = await getDocUpdateStatus({
        sourcePath,
        targetPath,
        isCopyPath,
      });

      tableData.push({
        Source: sourcePath,
        Target: targetPath,
        'Update?': shouldUpdate ? '✅ Yes' : '❌ No',
        'Translate?': shouldTranslate ? '✅ Yes' : '❌ No',
        Reason: reason,
      });

      if (shouldUpdate) {
        tasks.push({
          docPath,
          sourcePath,
          shouldTranslate,
          targetPath,
          isConfig: false, // Mark as regular file
        });
      }
    }

    // Display document status table
    console.log('\n📋 Document Status:\n');
    console.table(tableData);
    logger.info(`Found ${tasks.length}/${filteredPaths.length} documents to update`);

    // Process tasks if not in list-only mode
    if (!listOnly) {
      let completedRefDocs = 0;
      const concurrency = 10;

      await executeInBatches(
        tasks,
        async (task) => {
          if (task.isConfig) {
            // Handle config translation
            translatedConfig = await $translateConfig({
              docsConfig,
              langConfig,
              docsContext,
            });

            await fs$.writeFile(task.targetPath, JSON.stringify(translatedConfig, null, 2), 'utf8');

            completedRefDocs++;
            logger.progress(
              completedRefDocs,
              tasks.length,
              'Updating documents',
              `${task.targetPath} translated`,
            );
          } else if (task.shouldTranslate) {
            // Handle document translation
            const title = pathToLabelMap[task.docPath];
            await translateDoc({
              sourcePath: task.sourcePath,
              targetPath: task.targetPath,
              langConfig,
              docsContext,
              title,
            });

            completedRefDocs++;
            logger.progress(
              completedRefDocs,
              tasks.length,
              'Updating documents',
              `${task.targetPath} translated`,
            );
          } else {
            // Handle document copying
            await copyDoc({
              sourcePath: task.sourcePath,
              targetPath: task.targetPath,
              docsRoot,
              translatedRoot,
            });

            completedRefDocs++;
            logger.progress(
              completedRefDocs,
              tasks.length,
              'Updating documents',
              `${task.targetPath} copied`,
            );
          }
        },
        concurrency,
      );
    }

    logger.success(`Completed processing for language: ${lang}`);
  }

  logger.divider();
}
