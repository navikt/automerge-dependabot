# Contributing

Contributions are welcome. We encourage opening an issue first to discuss whether your proposed change aligns with the project scope.

## Scope

This action has a singular purpose: automatically merge Dependabot pull requests based on configurable rules. We maintain strict boundaries to keep the action secure, maintainable, and focused.

**Hard boundaries:**
- Only `api.github.com` — no external APIs or services
- Minimal permissions — `contents: write`, `pull-requests: write`, `statuses: read` only
- Dependabot PRs only — no support for other bots or user PRs

**In scope:**
- Filters for controlling which Dependabot PRs to merge
- Merge strategies and timing rules for Dependabot PRs
- Improvements to existing features
- Bug fixes and test coverage

**Out of scope:**
- Support for non-Dependabot PRs
- Additional API integrations beyond GitHub
- Requirements for additional permissions
- Notification systems (Slack, email, etc.)
- Custom workflows unrelated to Dependabot PR merging

If you're unsure whether a feature fits, open an issue to discuss it.

## Development

**Requirements:**
- Node.js (latest LTS version)
- Run `npm install` to install dependencies

**Code standards:**
- Code style is enforced by ESLint (see [eslint.config.mjs](eslint.config.mjs))
- Tests must mock external dependencies only, not internal code
- Follow clean code principles
- Avoid adding unnecessary dependencies

**Test approach:**
- See [__tests__](__tests__) for patterns
- Mock external dependencies (GitHub API, etc.)
- Do not mock internal dependencies
- Do not write to the file system in tests

## Before Submitting

Run these commands before submitting a pull request:

```bash
npm test          # Run all tests
npm run lint      # Check code style
npm run build     # Build the action
```

All checks must pass before your PR can be merged.
