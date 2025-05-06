import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { main } from '../../src/main';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { executeInBatches } from '../../src/batch';
import { $translateConfig } from '../../src/openai';
import * as utils from '../../src/utils';
import { logger } from '../../src/logger';

// Mock dependencies
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock('../../src/batch', () => ({
  executeInBatches: vi.fn(),
}));

vi.mock('../../src/openai', () => ({
  $translateConfig: vi.fn(),
}));

vi.mock('../../src/utils', () => ({
  getTranslatedConfig: vi.fn(),
  shouldTranslateConfig: vi.fn(),
  copyDoc: vi.fn(),
  translateDoc: vi.fn(),
  getDocUpdateStatus: vi.fn(),
  findDocFiles: vi.fn(),
  normalizePatterns: vi.fn(),
  extractPathToLabelMap: vi.fn(),
}));

vi.mock('../../src/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    divider: vi.fn(),
    progress: vi.fn(),
  },
}));

// Mock console.log and console.table to prevent test output
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'table').mockImplementation(() => {});

describe('main', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('main function', () => {
    it('should handle missing targetLanguage correctly', async () => {
      // Setup config with multiple languages
      const config = {
        langs: {
          en: { name: 'English' },
          fr: { name: 'French' },
          es: { name: 'Spanish' },
        },
        docsRoot: '/docs',
        docsContext: 'Test context',
      };

      // Set up mocks for a specific non-existent language
      const nonExistentLang = 'de';

      // Execute main with non-existent language
      await main({ ...config, targetLanguage: nonExistentLang });

      // Verify warning was logged and no further processing happened
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        expect.stringContaining(
          `Target language "${nonExistentLang}" not found`,
        ),
      );
      expect(vi.mocked(fs.readFile)).not.toHaveBeenCalled();
    });

    it('should process single language when targetLanguage is specified', async () => {
      // Setup
      const config = {
        langs: {
          en: { name: 'English' },
          fr: { name: 'French' },
          es: { name: 'Spanish' },
        },
        docsRoot: '/docs',
        docsContext: 'Test context',
      };

      // Mock utils.normalizePatterns to return empty arrays
      vi.mocked(utils.normalizePatterns).mockReturnValue([]);

      // Mock readFile for docs config
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ items: [] }));

      // Execute main with specific language
      await main({ ...config, targetLanguage: 'fr' });

      // Verify only one language was processed (French)
      const logCalls = vi.mocked(logger.info).mock.calls;
      const languageLogCall = logCalls.find(
        (call) =>
          typeof call[0] === 'string' && call[0].startsWith('language:'),
      );

      expect(languageLogCall).toBeDefined();
      expect(languageLogCall?.[0]).toContain('language: fr');
      expect(languageLogCall?.[0]).toContain('French');

      // Verify no other languages were processed
      expect(
        logCalls.every(
          (call) =>
            typeof call[0] !== 'string' || !call[0].includes('language: en'),
        ),
      ).toBe(true);
      expect(
        logCalls.every(
          (call) =>
            typeof call[0] !== 'string' || !call[0].includes('language: es'),
        ),
      ).toBe(true);
    });

    it('should handle docs path patterns correctly', async () => {
      // Setup
      const config = {
        langs: {
          fr: { name: 'French' },
        },
        docsRoot: '/docs',
        docsContext: 'Test context',
        docsPath: ['**/*.md'],
      };

      // Mock the necessary functions
      const mockDocPaths = ['guide/intro', 'reference/api'];
      vi.mocked(utils.normalizePatterns)
        .mockReturnValueOnce([]) // pattern
        .mockReturnValueOnce([]) // copyPath
        .mockReturnValueOnce(['**/*.md']); // docsPath

      vi.mocked(utils.findDocFiles).mockResolvedValue(mockDocPaths);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ items: [] }));
      vi.mocked(utils.getTranslatedConfig).mockResolvedValue({});
      vi.mocked(utils.shouldTranslateConfig).mockReturnValue(false);
      vi.mocked(utils.getDocUpdateStatus).mockResolvedValue([
        false,
        false,
        'No updates needed',
      ]);
      vi.mocked(utils.extractPathToLabelMap).mockReturnValue({});

      // Execute main
      await main(config);

      // Verify findDocFiles was called with the correct patterns
      expect(utils.findDocFiles).toHaveBeenCalledWith('/docs', ['**/*.md']);

      // Verify getDocUpdateStatus was called for each doc path
      expect(utils.getDocUpdateStatus).toHaveBeenCalledTimes(
        mockDocPaths.length,
      );
    });

    it('should translate config when it needs updating', async () => {
      // Setup
      const config = {
        langs: {
          fr: { name: 'French' },
        },
        docsRoot: '/docs',
        docsContext: 'Test context',
      };

      // Mock utils functions
      vi.mocked(utils.normalizePatterns).mockReturnValue([]);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ items: [] }));
      vi.mocked(utils.getTranslatedConfig).mockResolvedValue({});
      vi.mocked(utils.shouldTranslateConfig).mockReturnValue(true); // Config needs translation
      vi.mocked(utils.extractPathToLabelMap).mockReturnValue({});

      // Mock executeInBatches to execute the task function immediately
      vi.mocked(executeInBatches).mockImplementation(async (tasks, fn) => {
        for (const task of tasks) {
          await fn(task);
        }
        return [];
      });

      // Mock $translateConfig to return a translated config
      const mockTranslatedConfig = { items: [{ label: 'Translated' }] };
      vi.mocked($translateConfig).mockResolvedValue(mockTranslatedConfig);

      // Execute main
      await main(config);

      // Verify $translateConfig was called
      expect($translateConfig).toHaveBeenCalledWith({
        docsConfig: { items: [] },
        langConfig: { name: 'French' },
        docsContext: 'Test context',
      });

      // Verify the translated config was written to file
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('config.json'),
        JSON.stringify(mockTranslatedConfig, null, 2),
        'utf8',
      );
    });

    it('should translate documents that need updating', async () => {
      // Setup
      const config = {
        langs: {
          fr: { name: 'French' },
        },
        docsRoot: '/docs',
        docsContext: 'Test context',
        docsPath: ['**/*.md'],
      };

      // Mock utility functions
      const mockDocPaths = ['guide/intro', 'reference/api'];
      vi.mocked(utils.normalizePatterns)
        .mockReturnValueOnce([]) // pattern
        .mockReturnValueOnce([]) // copyPath
        .mockReturnValueOnce(['**/*.md']); // docsPath

      vi.mocked(utils.findDocFiles).mockResolvedValue(mockDocPaths);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ items: [] }));
      vi.mocked(utils.getTranslatedConfig).mockResolvedValue({});
      vi.mocked(utils.shouldTranslateConfig).mockReturnValue(false);

      // Config doesn't need translation, but documents do
      vi.mocked(utils.getDocUpdateStatus)
        .mockResolvedValueOnce([true, true, 'Source updated']) // guide/intro needs translation
        .mockResolvedValueOnce([true, false, 'Source updated but copy only']); // reference/api needs update but not translation

      // Mock path to label mapping
      vi.mocked(utils.extractPathToLabelMap).mockReturnValue({
        'guide/intro': 'Introduction Guide',
      });

      // Mock executeInBatches to execute the tasks immediately
      vi.mocked(executeInBatches).mockImplementation(async (tasks, fn) => {
        for (const task of tasks) {
          await fn(task);
        }
        return [];
      });

      // Execute main
      await main({ ...config, listOnly: false });

      // Verify translateDoc was called for the file needing translation
      expect(utils.translateDoc).toHaveBeenCalledWith({
        sourcePath: '/docs/guide/intro.md',
        targetPath: expect.stringContaining('fr/guide/intro.md'),
        langConfig: { name: 'French' },
        docsContext: 'Test context',
        title: 'Introduction Guide',
      });

      // Verify copyDoc was called for the file needing update but not translation
      expect(utils.copyDoc).toHaveBeenCalledWith({
        sourcePath: '/docs/reference/api.md',
        targetPath: expect.stringContaining('fr/reference/api.md'),
        docsRoot: '/docs',
        translatedRoot: expect.stringContaining('/fr'),
      });
    });

    it('should respect copyPath patterns to prevent translation', async () => {
      // Setup
      const config = {
        langs: {
          fr: { name: 'French' },
        },
        docsRoot: '/docs',
        docsContext: 'Test context',
        docsPath: ['**/*.md'],
        copyPath: ['reference/**'], // Force reference docs to be copied without translation
      };

      // Mock utility functions
      const mockDocPaths = ['guide/intro', 'reference/api'];
      vi.mocked(utils.normalizePatterns)
        .mockReturnValueOnce([]) // pattern
        .mockReturnValueOnce(['reference/**']) // copyPath
        .mockReturnValueOnce(['**/*.md']); // docsPath

      vi.mocked(utils.findDocFiles).mockResolvedValue(mockDocPaths);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ items: [] }));
      vi.mocked(utils.getTranslatedConfig).mockResolvedValue({});
      vi.mocked(utils.shouldTranslateConfig).mockReturnValue(false);

      // Both documents need translation, but reference/api should be forced to copy
      vi.mocked(utils.getDocUpdateStatus)
        .mockResolvedValueOnce([true, true, 'Source updated']) // guide/intro
        .mockResolvedValueOnce([true, true, 'Source updated']); // reference/api

      vi.mocked(utils.extractPathToLabelMap).mockReturnValue({});

      // Mock executeInBatches
      vi.mocked(executeInBatches).mockImplementation(async (tasks, fn) => {
        for (const task of tasks) {
          await fn(task);
        }
        return [];
      });

      // Execute main
      await main(config);

      // Verify translateDoc was called only for guide/intro
      expect(utils.translateDoc).toHaveBeenCalledTimes(1);
      expect(utils.translateDoc).toHaveBeenCalledWith(
        expect.objectContaining({
          sourcePath: '/docs/guide/intro.md',
        }),
      );

      // Verify copyDoc was called for reference/api despite it needing translation
      expect(utils.copyDoc).toHaveBeenCalledWith(
        expect.objectContaining({
          sourcePath: '/docs/reference/api.md',
        }),
      );
    });

    it('should respect the listOnly flag and not execute tasks', async () => {
      // Setup
      const config = {
        langs: {
          fr: { name: 'French' },
        },
        docsRoot: '/docs',
        docsContext: 'Test context',
        docsPath: ['**/*.md'],
        listOnly: true, // Only list files, don't process them
      };

      // Mock utility functions
      const mockDocPaths = ['guide/intro', 'reference/api'];
      vi.mocked(utils.normalizePatterns)
        .mockReturnValueOnce([]) // pattern
        .mockReturnValueOnce([]) // copyPath
        .mockReturnValueOnce(['**/*.md']); // docsPath

      vi.mocked(utils.findDocFiles).mockResolvedValue(mockDocPaths);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ items: [] }));
      vi.mocked(utils.getTranslatedConfig).mockResolvedValue({});
      vi.mocked(utils.shouldTranslateConfig).mockReturnValue(true); // Config needs translation
      vi.mocked(utils.getDocUpdateStatus)
        .mockResolvedValueOnce([true, true, 'Source updated'])
        .mockResolvedValueOnce([true, true, 'Source updated']);

      vi.mocked(utils.extractPathToLabelMap).mockReturnValue({});

      // Execute main with listOnly: true
      await main(config);

      // Verify that executeInBatches was not called
      expect(executeInBatches).not.toHaveBeenCalled();

      // Verify that no translation or copy operations were performed
      expect(utils.translateDoc).not.toHaveBeenCalled();
      expect(utils.copyDoc).not.toHaveBeenCalled();
      expect($translateConfig).not.toHaveBeenCalled();
      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });
});
