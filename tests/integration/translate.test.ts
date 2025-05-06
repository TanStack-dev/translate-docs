import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';

// Mock child_process before importing any other modules
vi.mock('node:child_process', () => ({
  execSync: vi.fn().mockImplementation(() => {
    // Return a mock timestamp for any git command
    return '1714490076';
  })
}));

// Now import the modules that depend on child_process
import { main } from '../../src/main';
import { logger } from '../../src/logger';
import * as openai from '../../src/openai';
import * as utils from '../../src/utils';

// Mock the OpenAI functionality
vi.mock('../../src/openai', () => ({
  checkApiKey: vi.fn().mockReturnValue(true),
  $translateDocument: vi.fn().mockImplementation(({ content, langConfig }) => {
    // Mock translation by adding a prefix
    return `[Translated to ${langConfig.name}]\n${content}`;
  }),
  $translateConfig: vi.fn().mockImplementation(({ docsConfig, langConfig }) => {
    // Mock translation of config by just copying and adding a translated flag
    return {
      ...docsConfig,
      translated: true,
      language: langConfig.name
    };
  }),
  model: 'gpt-4',
  systemPrompt: 'mock-prompt'
}));

// Mock utils functions that need special handling
vi.spyOn(utils, 'copyDoc').mockImplementation(async ({ sourcePath, targetPath }) => {
  // Create target directory
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  // Copy file content
  const content = await fs.readFile(sourcePath, 'utf8');
  await fs.writeFile(targetPath, content, 'utf8');
  return true;
});

vi.spyOn(utils, 'translateDoc').mockImplementation(async ({ 
  sourcePath, targetPath, langConfig 
}) => {
  // Create necessary directories
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  
  // Read the source content
  const content = await fs.readFile(sourcePath, 'utf8');
  
  // Add translation prefix and write to target
  await fs.writeFile(
    targetPath, 
    `[Translated to ${langConfig.name}]\n${content}`,
    'utf8'
  );
});

// Mock logger to prevent console output during tests
vi.mock('../../src/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    divider: vi.fn(),
    progress: vi.fn(),
    setVerbose: vi.fn()
  },
}));

// Silence console.log and console.table during tests
const originalConsoleLog = console.log;
const originalConsoleTable = console.table;

describe('Translation Integration Tests', () => {
  let tempDir: string;
  let docsDir: string;
  let configFile: string;
  let sampleDoc: string;
  let sampleReferenceDoc: string;

  beforeEach(async () => {
    // Mock console methods
    console.log = vi.fn();
    console.table = vi.fn();
    
    // Create temporary test directories
    tempDir = path.join(os.tmpdir(), `translate-docs-test-${Date.now()}`);
    docsDir = path.join(tempDir, 'docs');
    
    // Set up test docs structure
    await fs.mkdir(docsDir, { recursive: true });
    await fs.mkdir(path.join(docsDir, 'guide'), { recursive: true });
    await fs.mkdir(path.join(docsDir, 'reference'), { recursive: true });
    
    // Create a config.json file
    configFile = path.join(docsDir, 'config.json');
    await fs.writeFile(configFile, JSON.stringify({
      items: [
        { to: '/docs/guide/intro', label: 'Introduction' },
        { to: '/docs/reference/api', label: 'API Reference' },
      ]
    }), 'utf8');
    
    // Create sample markdown files
    sampleDoc = path.join(docsDir, 'guide', 'intro.md');
    await fs.writeFile(sampleDoc, `---
title: Introduction Guide
---
# Introduction

This is a sample introduction document.`, 'utf8');
    
    sampleReferenceDoc = path.join(docsDir, 'reference', 'api.md');
    await fs.writeFile(sampleReferenceDoc, `---
title: API Reference
---
# API Reference

This is a sample API reference document.`, 'utf8');
  });

  afterEach(async () => {
    // Restore console methods
    console.log = originalConsoleLog;
    console.table = originalConsoleTable;
    
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (err) {
      console.error('Failed to clean up temp directory:', err);
    }
    
    // Clear mocks
    vi.clearAllMocks();
  });

  it('should translate documents and config to French', async () => {
    // Setup test configuration
    const config = {
      langs: {
        fr: { name: 'French' }
      },
      docsRoot: docsDir,
      docsContext: 'Test documentation context',
      docsPath: ['**/*.md'] // Process all markdown files
    };
    
    // Execute main function
    await main(config);
    
    // Verify French directory was created
    const frDir = path.join(docsDir, 'fr');
    const frExists = await fileExists(frDir);
    expect(frExists).toBe(true);
    
    // Verify config.json was translated
    const frConfigFile = path.join(frDir, 'config.json');
    const frConfigExists = await fileExists(frConfigFile);
    expect(frConfigExists).toBe(true);
    
    const frConfigContent = JSON.parse(await fs.readFile(frConfigFile, 'utf8'));
    expect(frConfigContent).toHaveProperty('translated', true);
    expect(frConfigContent).toHaveProperty('language', 'French');
    
    // Verify markdown files were translated
    const frIntroFile = path.join(frDir, 'guide', 'intro.md');
    const frIntroExists = await fileExists(frIntroFile);
    expect(frIntroExists).toBe(true);
    
    const frIntroContent = await fs.readFile(frIntroFile, 'utf8');
    expect(frIntroContent).toContain('[Translated to French]');
    
    const frApiFile = path.join(frDir, 'reference', 'api.md');
    const frApiExists = await fileExists(frApiFile);
    expect(frApiExists).toBe(true);
    
    const frApiContent = await fs.readFile(frApiFile, 'utf8');
    expect(frApiContent).toContain('[Translated to French]');
  });

  it('should translate only to specified target language when provided', async () => {
    // Setup test configuration with multiple languages
    const config = {
      langs: {
        fr: { name: 'French' },
        es: { name: 'Spanish' }
      },
      docsRoot: docsDir,
      docsContext: 'Test documentation context',
      docsPath: ['**/*.md'],
      targetLanguage: 'es' // Only translate to Spanish
    };
    
    // Execute main function
    await main(config);
    
    // Verify Spanish directory was created
    const esDir = path.join(docsDir, 'es');
    const esExists = await fileExists(esDir);
    expect(esExists).toBe(true);
    
    // Verify Spanish config.json was translated
    const esConfigFile = path.join(esDir, 'config.json');
    const esConfigExists = await fileExists(esConfigFile);
    expect(esConfigExists).toBe(true);
    
    // Verify French directory was not created (not in targetLanguage)
    const frDir = path.join(docsDir, 'fr');
    const frExists = await fileExists(frDir);
    expect(frExists).toBe(false);
  });

  it('should respect copyPath and not translate files matching those patterns', async () => {
    // Setup test configuration
    const config = {
      langs: {
        fr: { name: 'French' }
      },
      docsRoot: docsDir,
      docsContext: 'Test documentation context',
      docsPath: ['**/*.md'],
      copyPath: ['reference/**'] // Copy reference docs without translation
    };
    
    // Execute main function
    await main(config);
    
    // Verify French directory was created
    const frDir = path.join(docsDir, 'fr');
    const frExists = await fileExists(frDir);
    expect(frExists).toBe(true);
    
    // Verify intro.md was translated (not in copyPath)
    const frIntroFile = path.join(frDir, 'guide', 'intro.md');
    const frIntroExists = await fileExists(frIntroFile);
    expect(frIntroExists).toBe(true);
    
    const frIntroContent = await fs.readFile(frIntroFile, 'utf8');
    expect(frIntroContent).toContain('[Translated to French]');
    
    // Verify api.md was copied but not translated (in copyPath)
    const frApiFile = path.join(frDir, 'reference', 'api.md');
    const frApiExists = await fileExists(frApiFile);
    expect(frApiExists).toBe(true);
    
    const frApiContent = await fs.readFile(frApiFile, 'utf8');
    expect(frApiContent).not.toContain('[Translated to French]');
    
    // It should be an exact copy of the original
    const originalApiContent = await fs.readFile(sampleReferenceDoc, 'utf8');
    expect(frApiContent).toBe(originalApiContent);
  });

  it('should respect listOnly flag and not modify any files', async () => {
    // Setup test configuration
    const config = {
      langs: {
        fr: { name: 'French' }
      },
      docsRoot: docsDir,
      docsContext: 'Test documentation context',
      docsPath: ['**/*.md'],
      listOnly: true // Only show what would be translated
    };
    
    // Execute main function
    await main(config);
    
    // Verify French directory was created (even in listOnly mode)
    const frDir = path.join(docsDir, 'fr');
    const frExists = await fileExists(frDir);
    expect(frExists).toBe(true);
    
    // Verify no config.json was created
    const frConfigFile = path.join(frDir, 'config.json');
    const frConfigExists = await fileExists(frConfigFile);
    expect(frConfigExists).toBe(false);
    
    // Verify no markdown files were created
    const frIntroFile = path.join(frDir, 'guide', 'intro.md');
    const frIntroExists = await fileExists(frIntroFile);
    expect(frIntroExists).toBe(false);
    
    const frApiFile = path.join(frDir, 'reference', 'api.md');
    const frApiExists = await fileExists(frApiFile);
    expect(frApiExists).toBe(false);
  });

  it('should handle reference documents with ref fields', async () => {
    // Create a document with a ref field pointing to another document
    const refTargetDoc = path.join(docsDir, 'reference', 'target.md');
    await fs.writeFile(refTargetDoc, `---
title: Target Document
---
# Target Document

This is the target document content.`, 'utf8');
    
    const refDoc = path.join(docsDir, 'reference', 'ref-doc.md');
    await fs.writeFile(refDoc, `---
title: Reference Document
ref: reference/target.md
replace:
  "Target Document": "Referenced Document"
---
`, 'utf8'); // Note: No content, just frontmatter with ref
    
    // Mock getSourceRefContent to handle ref documents
    vi.spyOn(utils, 'getDocUpdateStatus').mockImplementation(async ({ sourcePath }) => {
      // Always indicate docs need updating for test purposes
      return [true, true, 'Mocked: file needs updating'];
    });
    
    // Setup test configuration
    const config = {
      langs: {
        fr: { name: 'French' }
      },
      docsRoot: docsDir,
      docsContext: 'Test documentation context',
      docsPath: ['**/*.md']
    };
    
    // Execute main function
    await main(config);
    
    // Verify the ref doc was created in French directory
    const frDir = path.join(docsDir, 'fr');
    const frRefDocFile = path.join(frDir, 'reference', 'ref-doc.md');
    const frRefDocExists = await fileExists(frRefDocFile);
    expect(frRefDocExists).toBe(true);
  });

  it('should use language-specific guides and term dictionaries', async () => {
    // Replace our spy on translateDoc with a new implementation for this test
    const translateDocSpy = vi.spyOn(utils, 'translateDoc').mockImplementation(async ({ 
      sourcePath, targetPath, langConfig, docsContext, title 
    }) => {
      // Create necessary directories
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      
      // Read the source content
      const content = await fs.readFile(sourcePath, 'utf8');
      
      // Add guide and terms info to the translated content
      const translatedContent = `[Translated with guide: ${langConfig.guide}]\n[Terms used: ${JSON.stringify(langConfig.terms)}]\n${content}`;
      
      // Write the result
      await fs.writeFile(targetPath, translatedContent, 'utf8');
    });
    
    // Setup test configuration with language-specific guides and terms
    const config = {
      langs: {
        fr: { 
          name: 'French',
          guide: 'Use formal language for translations',
          terms: {
            'Introduction': 'Introduction',
            'API Reference': 'Référence API'
          }
        }
      },
      docsRoot: docsDir,
      docsContext: 'Test documentation context',
      docsPath: ['**/*.md']
    };
    
    // Execute main function
    await main(config);
    
    // Verify the French directory was created with translated files
    const frDir = path.join(docsDir, 'fr');
    const frExists = await fileExists(frDir);
    expect(frExists).toBe(true);
    
    // Verify that translated content exists and contains language guide information
    const frIntroFile = path.join(frDir, 'guide', 'intro.md');
    const frIntroContent = await fs.readFile(frIntroFile, 'utf8');
    
    expect(frIntroContent).toContain('Use formal language for translations');
    expect(frIntroContent).toContain('Introduction');
    expect(frIntroContent).toContain('Référence API');
  });
});

// Helper function to check if a file exists
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}