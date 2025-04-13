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
}

// OR multiple configurations as an array
export default [
  {
    langs: { /* ... */ },
    docsRoot: String | String[],
    docsContext: String,
  },
  {
    langs: { /* ... */ },
    docsRoot: String | String[],
    docsContext: String,
  }
]
```

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
  -v, --verbose            Enable verbose logging
  -p, --pattern <pattern>  File pattern to match for updating (e.g., "*.md" or "docs/**/*.tsx")
  -l, --list-only          Only list file status without updating docs
  -u, --update-config-only Only update config without processing docs
  -h, --help               Display help for command
```

Examples:

```bash
# Use a specific configuration file
npx translate-docs --config ./custom-config.mjs

# Only process markdown files
npx translate-docs --pattern "**/*.md"

# Just check which files would be processed without making changes
npx translate-docs --list-only

# Update translation configuration without processing docs
npx translate-docs --update-config-only

# Enable verbose logging for troubleshooting
npx translate-docs --verbose
```
