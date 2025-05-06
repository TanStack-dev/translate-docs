import OpenAI from 'openai';
import { buildTranslationContext } from './utils';
import { logger } from './logger';

interface LangConfig {
  name: string;
}

interface DocsConfig {
  [key: string]: Record<string, unknown>;
}

interface TranslateConfigParams {
  docsConfig: DocsConfig;
  langConfig: LangConfig;
  docsContext?: string;
}

interface TranslateDocumentParams {
  content: string;
  langConfig: LangConfig;
  context?: string;
}

// Initialize OpenAI client if API key is available
export const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({
      baseURL: 'https://api.deepseek.com',
      apiKey: process.env.OPENAI_API_KEY,
    })
  : null;

// Check for API key only when translation functions are called
export function checkApiKey() {
  if (!process.env.OPENAI_API_KEY) {
    logger.error('Error: OPENAI_API_KEY is not set.');
    return false;
  }
  return true;
}

export const model = 'deepseek-chat';

export const systemPrompt =
  'You are a professional technical translator specializing in software documentation. You are particularly skilled at translating React, web development, and programming terminology, keeping the translations consistent and readable.';

// Helper function to recursively find all label fields
function findLabelFields(
  obj: Record<string, unknown>,
  path: string[] = [],
): { path: string[]; value: string; context?: string }[] {
  const results: { path: string[]; value: string; context?: string }[] = [];

  if (typeof obj === 'object' && obj !== null) {
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'label' && typeof value === 'string') {
        // Look for a 'to' field as a sibling of the label field
        const to = obj.to;
        const context = typeof to === 'string' ? to : undefined;
        results.push({ path: [...path], value, context });
      } else if (typeof value === 'object' && value !== null) {
        results.push(
          ...findLabelFields(value as Record<string, unknown>, [...path, key]),
        );
      }
    }
  }

  return results;
}

// Helper function to set a value at a nested path
function setValueAtPath(
  obj: Record<string, unknown>,
  path: string[],
  value: string,
): void {
  if (path.length === 0) return;

  // Navigate through the path
  let current = obj;

  // Process the entire path to reach the target object
  for (let i = 0; i < path.length; i++) {
    const key = path[i];

    // For the last segment in the path
    if (i === path.length - 1) {
      // Check if the object at this position exists and has a label property
      if (
        current[key] &&
        typeof current[key] === 'object' &&
        current[key] !== null
      ) {
        // Set the label property on this object
        (current[key] as Record<string, unknown>).label = value;
      }
      return;
    }

    // Ensure the next level exists
    if (current[key] === undefined || current[key] === null) {
      // If the next key is numeric, create an array, otherwise create an object
      current[key] = !Number.isNaN(Number(path[i + 1])) ? [] : {};
    }

    // Move to the next level
    current = current[key] as Record<string, unknown>;
  }
}

// Improved function to translate the config
export async function $translateConfig({
  docsConfig,
  langConfig,
  docsContext,
}: TranslateConfigParams): Promise<DocsConfig> {
  if (!checkApiKey()) {
    throw new Error('OPENAI_API_KEY is not set.');
  }

  // Create a deep copy of the config to avoid modifying the original
  const configCopy = JSON.parse(JSON.stringify(docsConfig));

  // Find all label fields that need translation
  const labelFields = findLabelFields(configCopy);

  console.groupCollapsed('labelFields', labelFields);

  // Create context by summarizing from overview files
  const translationContext = await buildTranslationContext({
    langConfig,
    docsContext,
  });

  // Create a prompt for all labels
  const prompt = `Translate these labels from English to ${langConfig.name}.
IMPORTANT: You must follow these rules exactly:
1. Translate ONLY the values provided below
2. DO NOT translate framework names like "react", "solid", etc.
3. Return EXACTLY the same number of translations as provided
4. Each translation should be on a new line
5. Do not add any additional text or formatting
6. If a translation is unclear, keep the original English text
7. DO NOT add any additional translations or frameworks
8. Use the path context information (when provided) to help understand what the label refers to
9. DO NOT include the context information in your translations, just use it to understand the term better
10. Return ONLY the translated text without context markers
11. DO NOT add any introductory text or explanations
12. Each line of your response should contain ONLY the translated text
13. Your response MUST contain EXACTLY ${labelFields.length} lines - no more, no less

${translationContext}

HERE ARE THE LABELS TO TRANSLATE (translate ONLY these):
${labelFields
  .map((field) => {
    if (field.context) {
      return `${field.value} [context: ${field.context}]`;
    }
    return field.value;
  })
  .join('\n')}`;

  const response = await openai!.chat.completions.create({
    model: model,
    messages: [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  if (!response.choices[0]?.message?.content) {
    throw new Error('Failed to get translation response');
  }

  // Split the response into individual translations and clean them
  let translations = response.choices[0].message.content
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => t.length > 0); // Remove empty lines

  // Remove any explanatory text that might be at the beginning
  // Check if translations count doesn't match expected count
  if (translations.length > labelFields.length) {
    // Try to detect and remove explanatory text
    // Common patterns include introductions like "Here are the translations:"
    const introLines = translations.findIndex((line) => {
      // Check if line contains any of the source labels - that's likely the first real translation
      return labelFields.some((field) => {
        const sourceLabelLower = field.value.toLowerCase();
        // If this line is very similar to one of our source labels, it's probably a translation
        // (This helps identify the first actual translation line)
        return (
          sourceLabelLower.length > 3 &&
          (line.toLowerCase().includes(sourceLabelLower) ||
            sourceLabelLower.includes(line.toLowerCase()))
        );
      });
    });

    if (introLines > 0) {
      // Remove intro lines
      translations = translations.slice(introLines);
    } else {
      // If we can't clearly identify intro text, just take the exact number we need from the end
      translations = translations.slice(
        translations.length - labelFields.length,
      );
    }
  }

  // Further clean translations
  translations = translations
    .map((t) => {
      // Remove any accidentally included context
      const contextMatch = t.match(/^(.*?)(\s*\[context:.*\])$/);
      // Remove any numbering like "1. " at the beginning of lines
      const numberingMatch = t.match(/^\d+\.\s*(.*)$/);

      if (contextMatch) return contextMatch[1].trim();
      if (numberingMatch) return numberingMatch[1].trim();
      return t;
    })
    .slice(0, labelFields.length); // Ensure we have exactly the right number of translations

  console.log('translations', translations);

  if (translations.length !== labelFields.length) {
    throw new Error(
      `Translation count mismatch. Expected ${labelFields.length}, got ${translations.length}. Please ensure you only translate the exact labels provided.`,
    );
  }

  // Apply translations back to the config
  labelFields.forEach((field, index) => {
    setValueAtPath(configCopy, field.path, translations[index]);
  });

  console.log('configCopy', configCopy);

  return configCopy;
}

// Improved $translateDocument function with language-specific prompts
export async function $translateDocument({
  content,
  langConfig,
  context = '',
}: TranslateDocumentParams): Promise<string> {
  if (!checkApiKey()) {
    throw new Error('OPENAI_API_KEY is not set.');
  }

  const textLength = content.length;
  const prompt = `
Translate the following documentation from English to ${langConfig.name}.
Keep all code blocks, markdown formatting, HTML tags, and variables unchanged.
Do not translate text within \`\`\` code blocks or inline \`code\`.
Do not translate URLs or file paths.
Maintain the original paragraph structure and heading levels.
Provide only the translated content without any introduction, prefixes, or meta-explanations about the translation. Output just the translation itself.

${context}

HERE IS THE TEXT TO TRANSLATE:
`;

  logger.debug(
    `Sending translation request, text length: ${textLength} characters, prompt totoal length: ${
      prompt.length + textLength
    } characters`,
  );

  const response = await openai!.chat.completions.create({
    model: model,
    messages: [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: prompt + content,
      },
    ],
  });

  const translatedContent = response.choices[0]?.message?.content;
  if (!translatedContent) {
    throw new Error('Failed to get translation response');
  }

  return translatedContent.trim();
}
