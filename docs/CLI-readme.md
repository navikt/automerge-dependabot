# CLI Usage

The tool can also be used as a command-line interface for testing and one-off analysis of repositories.

### Installation

If you have the repository cloned, you can run the CLI directly:

```bash
npm install
npm run cli -- <options>
```

Or if you want to install it globally (after building):

```bash
npm install -g .
automerge-dependabot <options>
```

### CLI Options

```bash
automerge-dependabot [options] <url>

Arguments:
  url                            GitHub repository URL (e.g., https://github.com/owner/repo)

Options:
  -t, --token <token>            GitHub token (or use GITHUB_TOKEN env var)
  --minimum-age <days>           Minimum age of PR in days before merging (default: "0")
  --blackout-periods <periods>   Blackout periods when action should not run
  --ignored-dependencies <deps>  Comma-separated list of dependencies to ignore
  --always-allow <patterns>      Comma-separated list of patterns to always allow
  --always-allow-labels <labels> Comma-separated list of PR labels that bypass all filters
  --ignored-versions <versions>  Comma-separated list of specific versions to ignore
  --semver-filter <levels>       Semver levels to allow (major,minor,patch,unknown) (default: "patch,minor")
  --merge-method <method>        Merge method (merge, squash, rebase) (default: "merge")
  --retry-delay-ms <ms>          Delay between retries when checking PR mergeability (default: "10000")
  --skip-intermediate-ci         Add [skip ci] to merge commits for all but the last PR
  --no-dry-run                   Actually merge PRs (default is dry run)
  -v, --verbose                  Enable verbose logging
  -h, --help                     Display help for command
```

### Secure Authentication with GitHub CLI

For enhanced security and better credential management, we recommend using [GitHub CLI (gh)](https://cli.github.com/) instead of hardcoding tokens:

#### Setup GitHub CLI
```bash
# Install GitHub CLI (if not already installed)
# macOS
brew install gh

# Windows
winget install --id GitHub.cli

# Ubuntu/Debian
sudo apt install gh

# Login to GitHub
gh auth login
```

#### Use with CLI Tool
```bash
# Use GitHub CLI to provide token securely
automerge-dependabot https://github.com/owner/repo --token "$(gh auth print-token)"

# Or set as environment variable
export GITHUB_TOKEN=$(gh auth print-token)
automerge-dependabot https://github.com/owner/repo
```

#### Benefits of GitHub CLI Authentication
- **🛡️ No hardcoded tokens** - Tokens aren't stored in scripts or shell history
- **🔄 Automatic refresh** - GitHub CLI handles token renewal automatically
- **🏢 SSO support** - Works seamlessly with organizations requiring SSO and 2FA
- **🔐 Secure storage** - Credentials are stored securely by the GitHub CLI

#### Check Authentication Status
```bash
# Check if authentication is properly configured
automerge-dependabot auth-status
```

### CLI Examples

**Dry run analysis** (default behavior, won't actually merge):
```bash
# Using GitHub CLI (recommended for security)
automerge-dependabot https://github.com/owner/repo --token "$(gh auth print-token)"

# Using environment variable for token
export GITHUB_TOKEN=your_token_here
automerge-dependabot https://github.com/owner/repo

# Or pass token directly (less secure)
automerge-dependabot https://github.com/owner/repo --token your_token_here
```

**Check authentication status**:
```bash
automerge-dependabot auth-status
```

**Actually merge PRs**:
```bash
automerge-dependabot https://github.com/owner/repo --no-dry-run
```

**Advanced filtering**:
```bash
automerge-dependabot https://github.com/owner/repo \
  --minimum-age 3 \
  --ignored-dependencies "react,webpack" \
  --semver-filter "patch" \
  --merge-method "squash" \
  --verbose
```

**Test during blackout periods**:
```bash
automerge-dependabot https://github.com/owner/repo \
  --blackout-periods "Sat,Sun,Dec 24-Jan 5"
```

The CLI tool provides detailed output showing:
- Repository information
- Configuration settings
- All eligible PRs found
- Which PRs pass the filters and which are filtered out
- What would be merged (dry run) or what was actually merged

### Example CLI Output

```
🔍 Analyzing repository: owner/repo

⚙️  Configuration:
   • Minimum PR age: 3 days
   • Merge method: merge
   • Dry run: true
   • Semver filter: patch, minor

🏛️  Repository: owner/repo
   • Default branch: main
   • Private: false

🔎 Finding mergeable Dependabot PRs...

🔍 Applying filters...

============================================================
📊 RESULTS
============================================================

📋 All Eligible PRs Found (2):
  • PR #123: Bump lodash from 4.17.20 to 4.17.21
    📅 Created 5 days ago
    🔗 https://github.com/owner/repo/pull/123
    📦 lodash: 4.17.20 → 4.17.21 (patch)

  • PR #124: Bump react from 17.0.2 to 18.0.0
    📅 Created 4 days ago
    🔗 https://github.com/owner/repo/pull/124
    📦 react: 17.0.2 → 18.0.0 (major)

📋 PRs That Pass Filters (1):
  • PR #123: Bump lodash from 4.17.20 to 4.17.21
    📅 Created 5 days ago
    🔗 https://github.com/owner/repo/pull/123
    📦 lodash: 4.17.20 → 4.17.21 (patch)

📋 PRs Filtered Out (1):
  • PR #124: Bump react from 17.0.2 to 18.0.0
    📅 Created 4 days ago
    🔗 https://github.com/owner/repo/pull/124
    📦 react: 17.0.2 → 18.0.0 (major)

📈 Summary:
   • Total eligible PRs: 2
   • PRs that pass filters: 1
   • PRs filtered out: 1

🔍 DRY RUN: Would merge 1 PR(s):
   • PR #123: Bump lodash from 4.17.20 to 4.17.21

💡 Use --no-dry-run to actually merge these PRs.
```