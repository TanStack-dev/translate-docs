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
    docsRootName,
  );

  // Process copy paths
  const processedCopyPathPatterns = normalizePatterns(
    copyPath,
    normalizedDocsRoot,
    docsRootName,
  );

  // Process docs path patterns
  const processedDocsPathPatterns = normalizePatterns(
    docsPath,
    normalizedDocsRoot,
    docsRootName,
  );

  // Log patterns if provided
  if (processedDocsPathPatterns.length > 0) {
    logger.info(
      `Using docs-path patterns: ${processedDocsPathPatterns.join(', ')}`,
    );
  }
  if (processedPatterns.length > 0) {
    logger.info(`Using patterns: ${processedPatterns.join(', ')}`);
  }
  if (processedCopyPathPatterns.length > 0) {
    logger.info(
      `Using copy-path patterns: ${processedCopyPathPatterns.join(', ')}`,
    );
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

    // Add config.json handling to regular document processing instead of handling it separately
    const configNeedsTranslation = shouldTranslateConfig(
      docsConfig,
      translatedConfig,
    );

    // Initialize document paths - will be populated from docsPath or set to empty array
    let docPaths: string[] = [];

    // Use docsPath to find files from the filesystem
    if (processedDocsPathPatterns.length > 0) {
      logger.info('Finding files from filesystem using docsPath patterns...');
      const filesFromFilesystem = await findDocFiles(
        docsRoot,
        processedDocsPathPatterns,
      );

      // Filter out language-specific directory paths (e.g. "/en/", "/fr/", etc.)
      const langPatterns = Object.keys(langs).map(
        (lang) => `${lang.toLowerCase()}/`,
      );

      const filteredPaths = filesFromFilesystem.filter((filePath) => {
        const relativePath = path.relative(
          docsRoot,
          path.join(docsRoot, filePath),
        );
        // Check if the path starts with any language code
        return !langPatterns.some((langPattern) =>
          relativePath.startsWith(langPattern),
        );
      });

      logger.info(`Found ${filteredPaths.length} files from filesystem`);

      docPaths = filteredPaths;
    } else {
      // If docsPath isn't specified, show a warning that no files will be processed
      logger.warn(
        'No docsPath specified. No files will be processed. Please provide a docsPath pattern like --docs-path "**/*.md"',
      );
    }

    // Add config.json as a special entry to be processed with other documents
    // Using a virtual path 'config.json' without .md extension
    const configDocPath = 'config.json';
    docPaths = [configDocPath, ...docPaths];

    // Apply file filtering based on patterns
    let filteredPaths = docPaths;

    // Step 1: Apply include pattern if specified
    if (processedPatterns.length > 0) {
      // Normalize the patterns by removing .md extension if present
      const normalizedPatterns = processedPatterns.map((p) =>
        p.endsWith('.md') ? p.slice(0, -3) : p,
      );

      filteredPaths = micromatch(filteredPaths, normalizedPatterns);
    }

    // Create a set for paths that should be copied without translation
    const copyWithoutTranslationSet = new Set<string>();
    if (processedCopyPathPatterns.length > 0) {
      // Remove .md extension from patterns if present
      const normalizedCopyPatterns = processedCopyPathPatterns.map((p) =>
        p.endsWith('.md') ? p.slice(0, -3) : p,
      );

      // Find matches and add to set
      const copyMatches = micromatch(filteredPaths, normalizedCopyPatterns);
      copyMatches.forEach((match) => copyWithoutTranslationSet.add(match));
    }

    // Extract path to label mappings from translated config
    const pathToLabelMap = extractPathToLabelMap(translatedConfig);

    // Create translation tasks list
    const tasks = [];

    // Log document status
    const tableData = [];

    for (const docPath of filteredPaths) {
      // Special handling for config.json
      if (docPath === configDocPath) {
        tableData.push({
          Source: docsConfigPath,
          Target: translatedConfigPath,
          'Update?': configNeedsTranslation ? '✅ Yes' : '❌ No',
          'Translate?': configNeedsTranslation ? '✅ Yes' : '❌ No',
          Reason: configNeedsTranslation
            ? 'Config structure changed'
            : 'No changes needed',
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

      const sourcePath = path.join(docsRoot, `${docPath}.md`);
      const targetPath = path.join(translatedRoot, `${docPath}.md`);
      // Check if this path should be copied without translation
      const isCopyPath = copyWithoutTranslationSet.has(docPath);
      const [shouldUpdate, shouldTranslate, reason] = await getDocUpdateStatus({
        sourcePath,
        targetPath,
        isCopyPath,
      });

      // If it's in copyPath list, we should force copy without translation
      const finalShouldTranslate = isCopyPath ? false : shouldTranslate;

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
          shouldTranslate: finalShouldTranslate,
          targetPath,
          isConfig: false, // Mark as regular file
        });
      }
    }

    console.log('\n📋 Document Status:\n');
    console.table(tableData);
    logger.info(
      `Found ${tasks.length}/${filteredPaths.length} documents to update`,
    );

    let completedRefDocs = 0;
    const concurrency = 10;
    if (!listOnly) {
      await executeInBatches(
        tasks,
        async (task) => {
          // Special handling for config.json
          if (task.isConfig) {
            translatedConfig = await $translateConfig({
              docsConfig,
              langConfig,
              docsContext,
            });

            await fs$.writeFile(
              task.targetPath,
              JSON.stringify(translatedConfig, null, 2),
              'utf8',
            );

            completedRefDocs++;
            logger.progress(
              completedRefDocs,
              tasks.length,
              'Updating documents',
              `${task.targetPath} translated`,
            );
          } else if (task.shouldTranslate) {
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
