import graymatter, { GrayMatterFile } from 'gray-matter';
import * as fs$ from 'node:fs/promises';
import { logger } from './logger';

export type Doc = {
  filepath: string;
};

export type DocFrontMatter = {
  title: string;
  published?: string;
  exerpt?: string;
};

/**
 * Perform global string replace in text for given key-value map
 */
function replaceContent(text: string, frontmatter: GrayMatterFile<string>) {
  let result = text;
  const replace = frontmatter.data.replace as
    | Record<string, string>
    | undefined;
  if (replace) {
    for (const [key, value] of Object.entries(replace)) {
      result = result.replace(new RegExp(key, 'g'), value);
    }
  }

  return result;
}

/**
 * Perform tokenized sections replace in text.
 * - Discover sections based on token marker via RegExp in origin file.
 * - Discover sections based on token marker via RegExp in target file.
 * - replace sections in target file staring from the end, with sections defined in origin file
 * @param text File content
 * @param frontmatter Referencing file front-matter
 * @returns File content with replaced sections
 */
function replaceSections(text: string, frontmatter: GrayMatterFile<string>) {
  let result = text;
  // RegExp defining token pair to dicover sections in the document
  // [//]: # (<Section Token>)
  const sectionMarkerRegex = /\[\/\/\]: # '([a-zA-Z\d]*)'/g;
  const sectionRegex =
    /\[\/\/\]: # '([a-zA-Z\d]*)'[\S\s]*?\[\/\/\]: # '([a-zA-Z\d]*)'/g;

  // Find all sections in origin file
  const substitutes = new Map<string, RegExpMatchArray>();
  for (const match of frontmatter.content.matchAll(sectionRegex)) {
    if (match[1] !== match[2]) {
      console.error(
        `Origin section '${match[1]}' does not have matching closing token (found '${match[2]}'). Please make sure that each section has corresponsing closing token and that sections are not nested.`,
      );
    }

    substitutes.set(match[1], match);
  }

  // Find all sections in target file
  const sections = new Map<string, RegExpMatchArray>();
  for (const match of result.matchAll(sectionRegex)) {
    if (match[1] !== match[2]) {
      console.error(
        `Target section '${match[1]}' does not have matching closing token (found '${match[2]}'). Please make sure that each section has corresponsing closing token and that sections are not nested.`,
      );
    }

    sections.set(match[1], match);
  }

  Array.from(substitutes.entries())
    .reverse()
    .forEach(([key, value]) => {
      const sectionMatch = sections.get(key);
      if (sectionMatch) {
        result =
          result.slice(0, sectionMatch.index!) +
          value[0] +
          result.slice(
            sectionMatch.index! + sectionMatch[0].length,
            result.length,
          );
      }
    });

  // Remove all section markers from the result
  result = result.replaceAll(sectionMarkerRegex, '');

  return result;
}

export async function getSourceRefContent(filepath: string) {
  const maxDepth = 4;
  let currentDepth = 1;
  let originFrontmatter: GrayMatterFile<string> | undefined;
  while (maxDepth > currentDepth) {
    if (currentDepth > 2) {
      console.warn(
        `Referenced file ${filepath} is nested too deeply. Max depth is ${maxDepth}. Current depth is ${currentDepth}.`,
      );
    }
    let text: string | null;
    // Read file contents
    try {
      text = await fs$.readFile(filepath, 'utf8');
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      return null;
    }

    if (text === null) {
      return null;
    }
    try {
      const frontmatter = extractFrontMatter(text);
      // If file does not have a ref in front-matter, replace necessary content
      if (!frontmatter.data.ref) {
        if (originFrontmatter) {
          text = replaceContent(text, originFrontmatter);
          text = replaceSections(text, originFrontmatter);
        }

        return Promise.resolve(text);
      }
      // If file has a ref to another file, cache current front-matter and load referenced file
      filepath = frontmatter.data.ref;
      originFrontmatter = frontmatter;
    } catch (error) {
      return Promise.resolve(text);
    }
    currentDepth++;
  }

  return null;
}

export function extractFrontMatter(content: string) {
  return graymatter(content);
}
