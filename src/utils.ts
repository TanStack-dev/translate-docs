import { execSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs$ from 'node:fs/promises';
import matter, { GrayMatterFile } from 'gray-matter';
import { logger } from './logger';
import path from 'node:path';
import { $translateDocument } from './openai';
import { getSourceRefContent } from './ref-docs';
import { glob } from 'glob';
interface Config {
  to?: string;
  label?: string;
  [key: string]: any;
}

interface LangConfig {
  name: string;
  guide?: string;
  terms?: Record<string, string>;
}

interface CheckFileUpdateParams {
  sourcePath: string;
  targetPath: string;
}

interface BuildTranslationContextParams {
  langConfig: LangConfig;
  docsContext?: string;
}

export async function getTranslatedConfig(
  configPath: string,
): Promise<Record<string, unknown>> {
  let translatedConfig: Record<string, unknown>;
  try {
    translatedConfig = JSON.parse(await fs$.readFile(configPath, 'utf8'));
    logger.debug(`Found existing config ${configPath}`);
  } catch (error) {
    logger.info(`No existing config ${configPath}`);
    translatedConfig = {};
  }
  return translatedConfig;
}

// check if translation is needed using MD5
export function shouldTranslateConfig(
  docsConfig: Config,
  translatedConfig: Config,
): boolean {
  // Create deep copies to avoid modifying the originals
  const sourceCopy = JSON.parse(JSON.stringify(docsConfig));
  const targetCopy = JSON.parse(JSON.stringify(translatedConfig));

  // Strip out all label fields for comparison
  stripLabels(sourceCopy);
  stripLabels(targetCopy);

  // Create MD5 hashes
  const sourceHash = crypto
    .createHash('md5')
    .update(JSON.stringify(sourceCopy))
    .digest('hex');

  const targetHash = crypto
    .createHash('md5')
    .update(JSON.stringify(targetCopy))
    .digest('hex');

  logger.debug(`Source config structure hash: ${sourceHash}`);
  logger.debug(`Target config structure hash: ${targetHash}`);

  // Return true if hashes are different
  return sourceHash !== targetHash;
}

// Helper function to strip out all label fields from config
function stripLabels(obj: any): void {
  if (!obj || typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      stripLabels(item);
    }
  } else {
    // Remove label field from this object
    delete obj.label;

    // Process all nested objects
    for (const key in obj) {
      if (typeof obj[key] === 'object') {
        stripLabels(obj[key]);
      }
    }
  }
}

// Extract paths from config, skipping example paths
export function extractDocPaths(config: Config): string[] {
  const paths: string[] = [];

  function traverse(obj: Config): void {
    if (!obj || typeof obj !== 'object') return;

    if (obj.to) {
      // Don't collect paths containing examples
      if (!obj.to.includes('/examples/')) {
        paths.push(obj.to);
      }
    }

    for (const key in obj) {
      if (Array.isArray(obj[key])) {
        for (const item of obj[key]) {
          traverse(item);
        }
      } else if (typeof obj[key] === 'object') {
        traverse(obj[key]);
      }
    }
  }

  traverse(config);
  return paths;
}

export function getLastModifiedTimeFromGit(filePath: string): Date {
  const result = execSync(`git log -1 --format=%at -- "${filePath}"`, {
    encoding: 'utf8',
  }).trim();

  // console.log('filePath',filePath, result, new Date(parseInt(result, 10) * 1000));
  if (result) {
    return new Date(parseInt(result, 10) * 1000);
  }
  // git log returned no results, file might be new
  logger.error(`File ${filePath} has no git history,`);
  throw new Error(`File ${filePath} has no git history`);
}

// Extract path to label mappings from config
export function extractPathToLabelMap(
  translatedConfig: Config,
): Record<string, string> {
  const map: Record<string, string> = {};

  function traverse(obj: Config, parentPath = ''): void {
    if (Array.isArray(obj)) {
      obj.forEach((item) => {
        traverse(item);
      });
    } else if (obj && typeof obj === 'object') {
      // If object has to and label attributes, and not example path, add to mapping
      if (obj.to && obj.label && !obj.to.includes('/examples/')) {
        map[obj.to] = obj.label;
      }

      // Recursively process all attributes
      for (const key in obj) {
        if (typeof obj[key] === 'object') {
          traverse(obj[key]);
        }
      }
    }
  }

  traverse(translatedConfig);
  return map;
}

/**
 * Check if a document needs updating based on source file last modified date (git log) and target file metadata (source-updated-at)
 * Returns [shouldUpdate, shouldTranslate, reason]
 */
export async function getDocUpdateStatus({
  sourcePath,
  targetPath,
}: CheckFileUpdateParams): Promise<[boolean, boolean, string]> {
  try {
    await fs$.access(sourcePath);
  } catch (error) {
    logger.error(
      `Source file not found: ${sourcePath}, don't need updating, consider removing it`,
    );
    return [
      false,
      false,
      `Source file not found, don't need updating, consider REMOVING it`,
    ];
  }

  const sourceContent = await fs$.readFile(sourcePath, 'utf8');
  const sourceParsed = matter(sourceContent);

  let sourceLastModifiedDate = getLastModifiedTimeFromGit(sourcePath);
  if (sourceParsed.data.ref) {
    try {
      await fs$.access(sourceParsed.data.ref);
    } catch (error) {
      logger.error(
        `Referenced file not found: ${sourceParsed.data.ref}, don't need updating, consider REMOVING it`,
      );
      return [
        false,
        false,
        `Referenced file not found, don't need updating, consider REMOVING it`,
      ];
    }

    const refLastModifiedDate = getLastModifiedTimeFromGit(
      sourceParsed.data.ref,
    );
    if (refLastModifiedDate > sourceLastModifiedDate) {
      sourceLastModifiedDate = refLastModifiedDate;
    }
  }

  const [shouldTranslate, reason] = shouldTranslateDoc(sourceParsed);

  try {
    await fs$.access(targetPath);
  } catch (error) {
    logger.debug(`Target file not found: ${targetPath}, needs updating`);
    return [
      true,
      shouldTranslate,
      `Target file not found, needs updating. ${reason}`,
    ];
  }

  // Read target file and parse frontmatter
  const targetContent = await fs$.readFile(targetPath, 'utf8');
  const targetParsed = matter(targetContent);

  // First, check for timestamp-based updates
  if (targetParsed.data['translation-updated-at']) {
    const metadataTranslationUpdatedAt = new Date(
      targetParsed.data['translation-updated-at'],
    );

    // console.log('sourceLastModifiedDate', sourceLastModifiedDate, 'metadataTranslationUpdatedAt', metadataTranslationUpdatedAt);
    // If the source file has been updated since the last translation
    if (sourceLastModifiedDate > metadataTranslationUpdatedAt) {
      logger.debug(
        `Source file ${sourcePath} has been updated since last translation, needs updating`,
      );
      return [
        true,
        shouldTranslate,
        `Source file has been updated since last translation, needs updating. ${reason}`,
      ];
    }
    return [
      false,
      false,
      `Source file has not been updated since last translation. ${reason}`,
    ];
  }

  // If there's no source-updated-at in target, it needs to be updated
  logger.debug(
    `Target file ${targetPath} has no source-updated-at metadata, needs updating`,
  );
  return [
    true,
    shouldTranslate,
    `Target file has no source-updated-at metadata, needs updating. ${reason}`,
  ];
}

/**
 * Check if a document needs translation based on frontmatter metadata
 */
export function shouldTranslateDoc(
  frontmatter: GrayMatterFile<string>,
): [boolean, string] {
  if (!frontmatter.data.ref) {
    if (frontmatter.content) {
      return [true, 'Document has content, needs translation'];
    }
    return [false, 'Document has no content, no translation needed'];
  }

  const needsTranslation = frontmatter.data['needs-translation'];

  if (needsTranslation === true) {
    return [
      true,
      'Ref-document has needs-translation=true metadata, needs translation',
    ];
  }

  if (needsTranslation === false) {
    return [
      false,
      'Ref-document has needs-translation=false metadata, no translation needed',
    ];
  }

  const replace = frontmatter.data.replace as
    | Record<string, string>
    | undefined;

  if (
    replace &&
    Object.keys(replace).some((key) => {
      // if key has a space, then the ref doc needs full translation
      return key.includes(' ');
    })
  ) {
    return [true, 'Ref-document has replace metadata, needs translation'];
  }

  if (frontmatter.content) {
    return [true, 'Ref-document has content, needs translation'];
  }

  return [
    false,
    'Ref-document has no replace metadata, no content, no translation needed',
  ];
}

// New helper function to extract context from overview files
export function buildTranslationContext({
  langConfig,
  docsContext = '',
}: BuildTranslationContextParams): string {
  // Build context prompt
  let contextPrompt = '';

  // Add introduction
  if (docsContext) {
    contextPrompt += `CONTEXT FOR DOCUMENTATION:\n${docsContext}\n\n`;
  }

  if (langConfig.guide) {
    contextPrompt += `TRANSLATION GUIDELINES:\n${langConfig.guide}\n\n`;
  }

  // Add common technical term translations
  if (langConfig.terms && Object.keys(langConfig.terms).length > 0) {
    contextPrompt += 'COMMON TERM TRANSLATIONS:\n';
    // Only add terms relevant to current document type

    for (const [english, translated] of Object.entries(langConfig.terms)) {
      contextPrompt += `- "${english}" → "${translated}"\n`;
    }
    contextPrompt += '\n';
  }

  return contextPrompt;
}

interface CopyReferenceDocumentParams {
  sourcePath: string;
  targetPath: string;
  docsRoot: string;
  translatedRoot: string;
}

export async function copyDoc({
  sourcePath,
  targetPath,
  docsRoot,
  translatedRoot,
}: CopyReferenceDocumentParams): Promise<boolean> {
  logger.debug(`Copying  document from ${sourcePath} to ${targetPath}`);

  // Read source file
  const sourceContent = await fs$.readFile(sourcePath, 'utf8');
  const parsed = matter(sourceContent);

  // Format as ISO strings (UTC)
  const sourceUpdatedAt = getLastModifiedTimeFromGit(sourcePath).toISOString();
  const translationUpdatedAt = new Date().toISOString();

  // Create a new data object for frontmatter
  const newData = {
    'source-updated-at': sourceUpdatedAt,
    'translation-updated-at': translationUpdatedAt,
    ...parsed.data,
  };

  // Adjust the ref path to point to the translated version
  const currentRef = parsed.data.ref;
  if (currentRef) {
    // Extract the path after the docs root
    const relativePath = currentRef.substring(docsRoot.length + 1);

    // Check if ref starts with any of our docs roots
    const newRef = `${translatedRoot}/${relativePath}`;
    if (currentRef) {
      newData.ref = newRef;
    }
  }

  // Generate the new content with updated frontmatter
  const newContent = matter.stringify(parsed.content, newData);

  // Create target directory if needed
  await fs$.mkdir(path.dirname(targetPath), { recursive: true });

  // Write the file with adjusted ref and timestamps
  await fs$.writeFile(targetPath, newContent, 'utf8');

  logger.debug('Document copied and updated successfully');
  return true;
}

interface TranslateDocumentFileParams {
  sourcePath: string;
  targetPath: string;
  langConfig: LangConfig;
  docsContext?: string;
  title?: string;
}

export async function translateDoc({
  sourcePath,
  targetPath,
  langConfig,
  docsContext,
  title,
}: TranslateDocumentFileParams) {
  // Create directory if it doesn't exist
  logger.debug(`Translating ${sourcePath} to ${targetPath}`);
  await fs$.mkdir(path.dirname(targetPath), { recursive: true });

  // Read source file
  const sourceContent = await fs$.readFile(sourcePath, 'utf8');
  let parsed = matter(sourceContent);

  if (parsed.data.ref) {
    const refContent = await getSourceRefContent(sourcePath);
    if (refContent) {
      parsed = matter(refContent);
    } else {
      logger.error(`Failed to fetch referenced file: ${parsed.data.ref}`);
      return;
    }
  }

  const translationContext = `This is a complete document, title: ${
    parsed.data.title
  } (don't include this in the translation)\n${await buildTranslationContext({
    langConfig,
    docsContext,
  })}`;

  // Check if source file has frontmatter and extract content
  const translatedContent = await $translateDocument({
    content: parsed.content,
    langConfig,
    context: translationContext,
  });

  // Format as ISO strings (UTC)
  const sourceUpdatedAt = getLastModifiedTimeFromGit(sourcePath).toISOString();
  const translationUpdatedAt = new Date().toISOString();

  const newContent = matter.stringify(translatedContent, {
    'source-updated-at': sourceUpdatedAt,
    'translation-updated-at': translationUpdatedAt,
    ...parsed.data,
    title,
  });

  await fs$.writeFile(targetPath, newContent, 'utf8');
  logger.debug(`Completed translation of ${path.basename(sourcePath)}`);
}

/**
 * Finds Markdown files based on glob patterns
 */
export async function findDocFiles(
  docsRoot: string,
  patterns: string[],
): Promise<string[]> {
  const files: string[] = [];

  for (const pattern of patterns) {
    const fullPattern = path.join(docsRoot, pattern);
    // Ensure the pattern has the .md extension
    const filePattern = fullPattern.endsWith('.md')
      ? fullPattern
      : `${fullPattern}.md`;

    try {
      // Use the glob function with ES modules syntax
      const matches = await glob.glob(filePattern);
      files.push(...matches);
    } catch (error) {
      logger.error(`Error finding files for pattern ${pattern}: ${error}`);
    }
  }

  // Convert absolute paths to paths relative to docsRoot without .md extension
  return files.map((file) => {
    const relativePath = path.relative(docsRoot, file);
    return relativePath.endsWith('.md')
      ? relativePath.slice(0, -3)
      : relativePath;
  });
}

/**
 * Normalizes a pattern by removing docsRoot prefix if present
 */
export function normalizePattern(
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
  }
  if (pattern.startsWith(`${docsRootName}/`)) {
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
export function normalizePatterns(
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
      .map((p) => normalizePattern(p.trim(), normalizedDocsRoot, docsRootName))
      .filter((p) => p !== '');
  }

  // Otherwise, treat as a string and split by comma
  return patterns
    .split(',')
    .map((p) => normalizePattern(p.trim(), normalizedDocsRoot, docsRootName))
    .filter((p) => p !== '');
}
