# @tanstack-dev/translate-docs

A utility for translating TanStack documentation into multiple languages.

## Configuration

Create a `translate.config.mjs` file in your project root with the following structure:

```js
// Single configuration
export default {
  langs: {
    // Language configurations
    // Example: 'zh', 'es', 'fr', etc.
    [languageCode]: {
      name: String,         // Language name
      guide: String,        // Translation guidelines
      terms: {              // Dictionary of common terms
        // 'term': 'translation'
      },
    },
  },
  docsRoot: String | String[],  // Root directory or array of root directories
  docsContext: String,          // Context information for the translator
  pattern: String,              // Optional: File pattern to match (same as --pattern)
}

// OR multiple configurations as an array
export default [
  {
    langs: { /* ... */ },
    docsRoot: String | String[],
    docsContext: String,
    pattern: String,        // Optional
  },
  // ...more configurations
]
```

A sample configuration file (`translation.config.example.mjs`) is included in the repository that demonstrates how to set up translations for multiple languages including Simplified Chinese, Traditional Chinese, Japanese, Spanish, German, French, Russian, and Arabic. You can use this as a starting point for your own translations.

## Usage

Run the translation tool with:

```bash
OPENAI_API_KEY=your-openai-api-key npx translate-docs
```

### Command Line Options

The tool supports the following command line options:

```
Options:
  -c, --config <path>      Path to configuration file
  --verbose            Enable verbose logging
  -p, --pattern <pattern>  File pattern to match for updating (e.g., "*.md" or "**/*.tsx")
  -y, --copy-path <pattern> File pattern to copy without translation (e.g., "reference/**")
  -d, --docs-path <pattern> File pattern for docs to translate (e.g., "**/*.md")
  -l, --list-only          Only list file status without updating docs
  -t, --target-language <language> Specify target language code for translation
  -h, --help               Display help for command
  -v, --version            Show version number
```

Examples:

```bash
# Use a specific configuration file
npx translate-docs --config ./custom-config.mjs

# Only process markdown files
npx translate-docs --pattern "**/*.md"

# Copy specific directories without translation
npx translate-docs --copy-path "reference/**"

# Just check which files would be processed without making changes
npx translate-docs --list-only

# Enable verbose logging for troubleshooting
npx translate-docs --verbose

# Translate only to a specific language
npx translate-docs --target-language "zh-CN"
```

### GitHub Actions Integration

You can automate translations using GitHub Actions. The TanStack Dev team provides an official GitHub Action for this purpose.

For more information and usage examples, refer to:
https://github.com/TanStack-dev/translate-docs-action

## Configuration vs Command Line Options

You can specify file selection options (`pattern`, `copy-path`, `docs-path`) either in the configuration file or as command line arguments:

- **Configuration file approach**: Add pattern fields directly in your configuration file for persistent settings:
  ```js
  export default {
    langs: { /* ... */ },
    docsRoot: 'docs',
    docsContext: 'Your context here',
    pattern: '**/*.md',
    copyPath: 'reference/**,framework/*/reference/**'
  }
  ```

- **Command line approach**: Use CLI flags for one-time executions or to override configuration file settings:
  ```bash
  npx translate-docs --pattern "**/*.md" --copy-path "reference/**,framework/*/reference/**"
  ```

Command line options take precedence over configuration file settings when both are specified.
