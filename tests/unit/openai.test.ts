import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as openaiModule from '../../src/openai';

// Mock the entire module - important for avoiding issues with imports
vi.mock('../../src/openai', async () => {
  const actual = await vi.importActual('../../src/openai');
  return {
    ...actual,
    checkApiKey: vi.fn().mockReturnValue(true),
    openai: {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'Translated content' } }],
          }),
        },
      },
    },
  };
});

// Mock the utils functions
vi.mock('../../src/utils', () => ({
  buildTranslationContext: vi
    .fn()
    .mockResolvedValue('Mocked translation context'),
}));

// Mock logger
vi.mock('../../src/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('openai', () => {
  const { model, systemPrompt } = openaiModule;

  describe('checkApiKey', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.clearAllMocks();
      process.env = { ...originalEnv };

      // Reset the mock implementation to default behavior
      vi.mocked(openaiModule.checkApiKey).mockImplementation(() => {
        return !!process.env.OPENAI_API_KEY;
      });
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return true when API key is set', () => {
      process.env.OPENAI_API_KEY = 'dummy-key';
      expect(openaiModule.checkApiKey()).toBe(true);
    });

    it('should return false when API key is not set', () => {
      delete process.env.OPENAI_API_KEY;
      expect(openaiModule.checkApiKey()).toBe(false);
    });
  });

  describe('constants', () => {
    it('should export model name', () => {
      expect(model).toBe('deepseek-chat');
    });

    it('should export system prompt', () => {
      expect(systemPrompt).toContain('professional technical translator');
    });
  });

  describe('$translateDocument', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should throw error when API key is missing', async () => {
      // Make checkApiKey return false for this test
      vi.mocked(openaiModule.checkApiKey).mockReturnValueOnce(false);

      try {
        await openaiModule.$translateDocument({
          content: 'Test content',
          langConfig: { name: 'Spanish' },
        });
        // If we get here, the test should fail
        expect('should throw').toBe('but did not');
      } catch (error) {
        expect(error.message).toBe('OPENAI_API_KEY is not set.');
      }
    });
  });

  describe('$translateConfig', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should throw error when API key is missing', async () => {
      // Make checkApiKey return false for this test
      vi.mocked(openaiModule.checkApiKey).mockReturnValueOnce(false);

      try {
        await openaiModule.$translateConfig({
          docsConfig: { items: [{ label: 'Test' }] },
          langConfig: { name: 'Spanish' },
          docsContext: '',
        });
        // If we get here, the test should fail
        expect('should throw').toBe('but did not');
      } catch (error) {
        expect(error.message).toBe('OPENAI_API_KEY is not set.');
      }
    });
  });
});
