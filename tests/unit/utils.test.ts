import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  shouldTranslateConfig,
  stripLabels,
  extractDocPaths,
  shouldTranslateDoc,
} from '../../src/utils';
import matter from 'gray-matter';

// Mock the openai module
vi.mock('../../src/openai', () => ({
  checkApiKey: vi.fn(() => true),
  openai: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
  model: 'mock-model',
  systemPrompt: 'mock-system-prompt',
  $translateDocument: vi.fn(),
  $translateConfig: vi.fn(),
}));

describe('utils', () => {
  describe('shouldTranslateConfig', () => {
    it('should return true when configs have different structures', () => {
      const docsConfig = {
        items: [{ to: '/docs/page1', label: 'Page 1' }],
      };
      const translatedConfig = {
        items: [{ to: '/docs/page1', label: 'Página 1' }],
        extraItem: true,
      };

      expect(shouldTranslateConfig(docsConfig, translatedConfig)).toBe(true);
    });

    it('should return false when configs have the same structure ignoring labels', () => {
      const docsConfig = {
        items: [{ to: '/docs/page1', label: 'Page 1' }],
      };
      const translatedConfig = {
        items: [{ to: '/docs/page1', label: 'Página 1' }],
      };

      expect(shouldTranslateConfig(docsConfig, translatedConfig)).toBe(false);
    });
  });

  describe('extractDocPaths', () => {
    it('should extract paths from config', () => {
      const config = {
        items: [
          { to: '/docs/page1', label: 'Page 1' },
          { to: '/docs/page2', label: 'Page 2' },
          {
            to: '/docs/section',
            label: 'Section',
            items: [{ to: '/docs/section/page3', label: 'Page 3' }],
          },
        ],
      };

      const paths = extractDocPaths(config);

      expect(paths).toContain('/docs/page1');
      expect(paths).toContain('/docs/page2');
      expect(paths).toContain('/docs/section');
      expect(paths).toContain('/docs/section/page3');
      expect(paths.length).toBe(4);
    });

    it('should skip example paths', () => {
      const config = {
        items: [
          { to: '/docs/page1', label: 'Page 1' },
          { to: '/docs/examples/example1', label: 'Example 1' },
        ],
      };

      const paths = extractDocPaths(config);

      expect(paths).toContain('/docs/page1');
      expect(paths).not.toContain('/docs/examples/example1');
      expect(paths.length).toBe(1);
    });
  });

  describe('shouldTranslateDoc', () => {
    it('should return true for document with content', () => {
      const doc = matter('# Content here\nThis is some content');
      const [shouldTranslate, reason] = shouldTranslateDoc(doc);

      expect(shouldTranslate).toBe(true);
      expect(reason).toContain('Document has content');
    });

    it('should return false for empty document', () => {
      const doc = matter('---\ntitle: Empty Doc\n---\n');
      const [shouldTranslate, reason] = shouldTranslateDoc(doc);

      expect(shouldTranslate).toBe(false);
      expect(reason).toContain('no translation needed');
    });
  });
});
