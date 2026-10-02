# Third-party software and model licenses

The application currently uses the packages listed in `package.json` and resolved in `package-lock.json`. Review each package's installed license and any transitive notices before redistributing a production build. The project does not bundle a neural speech model or voice dataset at this time.

Important runtime dependencies include React, Vite, TypeScript, Lucide React, PDF.js, Mammoth, JSZip, Express, Express Session, Helmet, Express Rate Limit, and Microsoft Authentication Library for Node.js. Their licenses and notices should be verified against the exact versions being shipped; this file is not a substitute for the package-provided license texts.

No voice recordings, embeddings, neural model weights, or third-party voice datasets are included in this repository.

## Development and test tooling added for audiobook export work

These packages are development-only and are not included in the production application bundle:

| Package | Version | Declared license | Use |
|---|---:|---|---|
| ESLint (`eslint`, `@eslint/js`) | 9.39.5 | MIT | Linting |
| `typescript-eslint` | 8.71.0 | MIT | TypeScript lint rules |
| `eslint-plugin-react-hooks` | 7.1.1 | MIT | React Hooks lint rules |
| `eslint-plugin-jsx-a11y` | 6.10.2 | MIT | JSX accessibility lint rules |
| Prettier | 3.9.9 | MIT | Formatting |
| `@playwright/test` | 1.63.0 | Apache-2.0 | Browser tests |
| `@axe-core/playwright` | 4.13.0 | MPL-2.0 | Automated accessibility tests |
| `@types/node` | 26.6.4 | MIT | Node.js type definitions for test configuration |

These permissive/open-source development tools do not add a runtime service or paid dependency. Review package notices for the exact versions in `package-lock.json` when redistributing tooling or CI environments. Browser binaries used by Playwright are test-only and are not shipped in the application.
