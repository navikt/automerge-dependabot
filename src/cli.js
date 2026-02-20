import { Command } from 'commander';
import * as github from '@actions/github';
import { fileURLToPath } from 'node:url';
import { findMergeablePRs } from './pullRequests.js';
import { shouldRunAtCurrentTime } from './timeUtils.js';
import { applyFilters, getAllFilterReasons } from './filters.js';

/**
 * Parse GitHub repository URL to extract owner and repo
 * @param {string} url - GitHub repository URL
 * @returns {Object} Object containing owner and repo
 */
function parseGitHubUrl(url) {
  const githubUrlRegex = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/;
  const match = url.match(githubUrlRegex);
  
  if (!match) {
    throw new Error('Invalid GitHub repository URL. Expected format: https://github.com/owner/repo');
  }
  
  return {
    owner: match[1],
    repo: match[2]
  };
}

/**
 * Create a mock GitHub context for CLI usage
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {Object} Mock GitHub context
 */
function createMockContext(owner, repo) {
  return {
    repo: {
      owner,
      repo
    },
    ref: 'refs/heads/main' // Default to main branch for CLI
  };
}

/**
 * Create a mock core module for CLI usage
 * @param {boolean} verbose - Whether to enable verbose logging
 * @returns {Object} Mock core module
 */
function createMockCore(verbose = false) {
  const logger = {
    info: (message) => console.log(`ℹ️  ${message}`),
    warning: (message) => console.warn(`⚠️  ${message}`),
    debug: (message) => {
      if (verbose) {
        console.log(`🐛 ${message}`);
      }
    },
    setFailed: (message) => {
      console.error(`❌ ${message}`);
      process.exit(1);
    }
  };

  return {
    ...logger,
    getInput: () => '', // CLI doesn't use core.getInput
    summary: {
      addHeading: () => ({ addRaw: () => ({ write: async () => {} }) }),
      addRaw: () => ({ write: async () => {} }),
      write: async () => {}
    }
  };
}

/**
 * Format PR information for CLI output
 * @param {Array} pullRequests - Array of pull requests
 * @param {string} title - Section title
 */
function formatPRList(pullRequests, title) {
  if (pullRequests.length === 0) {
    console.log(`\n📭 ${title}: None`);
    return;
  }

  console.log(`\n📋 ${title} (${pullRequests.length}):`);
  pullRequests.forEach(pr => {
    const ageInDays = Math.floor((new Date() - new Date(pr.created_at)) / (1000 * 60 * 60 * 24));
    console.log(`  • PR #${pr.number}: ${pr.title}`);
    console.log(`    📅 Created ${ageInDays} days ago`);
    console.log(`    🔗 ${pr.html_url || `https://github.com/${pr.base?.repo?.owner?.login || 'owner'}/${pr.base?.repo?.name || 'repo'}/pull/${pr.number}`}`);
    
    if (pr.dependencyInfo) {
      console.log(`    📦 ${pr.dependencyInfo.name}: ${pr.dependencyInfo.fromVersion} → ${pr.dependencyInfo.toVersion} (${pr.dependencyInfo.semverChange})`);
    } else if (pr.dependencyInfoList && pr.dependencyInfoList.length > 0) {
      console.log('    📦 Multiple dependencies:');
      pr.dependencyInfoList.forEach(dep => {
        console.log(`       - ${dep.name}: ${dep.fromVersion} → ${dep.toVersion} (${dep.semverChange})`);
      });
    }
    console.log();
  });
}

/**
 * Main CLI runner function
 * @param {Object} options - CLI options
 */
async function runCli(options) {
  try {
    // Parse GitHub URL
    const { owner, repo } = parseGitHubUrl(options.url);
    console.log(`🔍 Analyzing repository: ${owner}/${repo}`);
    
    // Setup authentication
    const token = options.token || process.env.GITHUB_TOKEN;
    
    if (!token) {
      throw new Error('GitHub token not provided. Options:\n' +
        '  1. Use --token option with a personal access token\n' +
        '  2. Set GITHUB_TOKEN environment variable\n' +
        '  3. Use GitHub CLI: --token "$(gh auth print-token)"\n' +
        '  4. Use GitHub CLI with environment: export GITHUB_TOKEN=$(gh auth print-token)\n' +
        '\n' +
        '💡 For secure token management, consider using GitHub CLI (gh):\n' +
        '   • Install: https://cli.github.com/\n' +
        '   • Login: gh auth login\n' +
        '   • Usage: automerge-dependabot run <repo-url> --token "$(gh auth print-token)"');
    }
    
    // Setup mock modules for CLI usage
    const mockCore = createMockCore(options.verbose);
    
    // Create Octokit client
    const octokit = github.getOctokit(token);
    
    // Prepare filter options
    const filterOptions = {
      ignoredDependencies: options.ignoredDependencies ? options.ignoredDependencies.split(',').map(d => d.trim()) : [],
      alwaysAllow: options.alwaysAllow ? options.alwaysAllow.split(',').map(d => d.trim()) : [],
      alwaysAllowLabels: options.alwaysAllowLabels ? options.alwaysAllowLabels.split(',').map(l => l.trim()) : [],
      ignoredVersions: options.ignoredVersions ? options.ignoredVersions.split(',').map(v => v.trim()) : [],
      semverFilter: options.semverFilter ? options.semverFilter.split(',').map(s => s.trim()) : ['patch', 'minor']
    };
    
    console.log('\n⚙️  Configuration:');
    console.log(`   • Minimum PR age: ${options.minimumAge} days`);
    console.log(`   • Merge method: ${options.mergeMethod}`);
    console.log(`   • Dry run: ${options.dryRun}`);
    console.log(`   • Semver filter: ${filterOptions.semverFilter.join(', ')}`);
    if (filterOptions.ignoredDependencies.length > 0) {
      console.log(`   • Ignored dependencies: ${filterOptions.ignoredDependencies.join(', ')}`);
    }
    if (filterOptions.alwaysAllowLabels.length > 0) {
      console.log(`   • Always allow labels: ${filterOptions.alwaysAllowLabels.join(', ')}`);
    }
    if (filterOptions.alwaysAllow.length > 0) {
      console.log(`   • Always allow: ${filterOptions.alwaysAllow.join(', ')}`);
    }
    if (filterOptions.ignoredVersions.length > 0) {
      console.log(`   • Ignored versions: ${filterOptions.ignoredVersions.join(', ')}`);
    }
    
    // Check blackout periods
    if (options.blackoutPeriods && !shouldRunAtCurrentTime(options.blackoutPeriods)) {
      console.log('\n⏰ Currently in a blackout period. Skipping execution.');
      return;
    }
    
    // Get repository info for default branch check
    try {
      const { data: repoData } = await octokit.rest.repos.get({
        owner,
        repo
      });
      console.log(`\n🏛️  Repository: ${repoData.full_name}`);
      console.log(`   • Default branch: ${repoData.default_branch}`);
      console.log(`   • Private: ${repoData.private}`);
    } catch (error) {
      mockCore.warning(`Failed to get repository information: ${error.message}`);
    }
    
    // Find mergeable PRs
    console.log('\n🔎 Finding mergeable Dependabot PRs...');
    const result = await findMergeablePRs(
      octokit,
      owner,
      repo,
      options.minimumAge,
      options.retryDelayMs
    );
    
    const pullRequests = result.eligiblePRs;
    const initialPRs = result.initialPRs;
    
    console.log(`Found ${initialPRs.length} open pull requests, ${pullRequests.length} eligible for auto-merging.`);
    
    if (pullRequests.length === 0) {
      // Show what was filtered out during basic criteria if there were initial PRs
      if (initialPRs.length > 0) {
        const basicCriteriaFiltered = initialPRs.filter(pr => 
          !pullRequests.some(eligible => eligible.number === pr.number)
        );
        
        if (basicCriteriaFiltered.length > 0) {
          console.log(`\n📋 PRs Filtered Out (Basic Criteria) (${basicCriteriaFiltered.length}):`);
          const allFilterReasons = getAllFilterReasons();
          
          basicCriteriaFiltered.forEach(pr => {
            const reasons = allFilterReasons.get(pr.number);
            const reasonText = reasons && reasons.length > 0 
              ? reasons.map(r => r.reason).join(', ')
              : 'Unknown reason';
            
            console.log(`  • PR #${pr.number}: ${pr.title}`);
            console.log(`    🚫 Reason: ${reasonText}`);
            console.log();
          });
        }
      }
      
      console.log('\n✅ No eligible pull requests found for automerging.');
      return;
    }
    
    // Apply filters
    console.log('\n🔍 Applying filters...');
    const filteredPRs = applyFilters(pullRequests, filterOptions, mockCore);
    
    // Display results
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESULTS');
    console.log('='.repeat(60));
    
    // Calculate filtered PRs from basic criteria
    const basicCriteriaFiltered = initialPRs.filter(pr => 
      !pullRequests.some(eligible => eligible.number === pr.number)
    );
    
    // Show basic criteria filtering if any PRs were filtered out
    if (basicCriteriaFiltered.length > 0) {
      console.log(`\n📋 PRs Filtered Out (Basic Criteria) (${basicCriteriaFiltered.length}):`);
      const allFilterReasons = getAllFilterReasons();
      
      basicCriteriaFiltered.forEach(pr => {
        const ageInDays = Math.floor((new Date() - new Date(pr.created_at)) / (1000 * 60 * 60 * 24));
        const reasons = allFilterReasons.get(pr.number);
        const reasonText = reasons && reasons.length > 0 
          ? reasons.map(r => r.reason).join(', ')
          : 'Unknown reason';
        
        console.log(`  • PR #${pr.number}: ${pr.title}`);
        console.log(`    📅 Created ${ageInDays} days ago`);
        console.log(`    🔗 ${pr.html_url || `https://github.com/${pr.base?.repo?.owner?.login || 'owner'}/${pr.base?.repo?.name || 'repo'}/pull/${pr.number}`}`);
        console.log(`    🚫 Reason: ${reasonText}`);
        console.log();
      });
    }

    formatPRList(pullRequests, 'All Eligible PRs Found');
    formatPRList(filteredPRs, 'PRs That Pass Filters');
    
    const filteredOutPRs = pullRequests.filter(pr => 
      !filteredPRs.some(filtered => filtered.number === pr.number)
    );
    if (filteredOutPRs.length > 0) {
      formatPRList(filteredOutPRs, 'PRs Filtered Out (User Filters)');
    }
    
    // Summary
    console.log('\n📈 Summary:');
    console.log(`   • Total PRs found: ${initialPRs.length}`);
    console.log(`   • PRs filtered out (basic criteria): ${basicCriteriaFiltered.length}`);
    console.log(`   • Eligible PRs: ${pullRequests.length}`);
    console.log(`   • PRs that pass user filters: ${filteredPRs.length}`);
    console.log(`   • PRs filtered out (user filters): ${filteredOutPRs.length}`);
    
    // Merge or dry run
    if (filteredPRs.length === 0) {
      console.log('\n✅ No pull requests to merge.');
      return;
    }
    
    if (options.dryRun) {
      console.log(`\n🔍 DRY RUN: Would merge ${filteredPRs.length} PR(s):`);
      filteredPRs.forEach(pr => {
        console.log(`   • PR #${pr.number}: ${pr.title}`);
      });
      console.log('\n💡 Use --no-dry-run to actually merge these PRs.');
    } else {
      console.log(`\n🚀 Merging ${filteredPRs.length} PR(s)...`);
      
      for (const pr of filteredPRs) {
        try {
          console.log(`\n⏳ Merging PR #${pr.number}: ${pr.title}`);
          
          await octokit.rest.pulls.merge({
            owner,
            repo,
            pull_number: pr.number,
            merge_method: options.mergeMethod
          });
          
          console.log(`✅ Successfully merged PR #${pr.number}`);
        } catch (error) {
          console.error(`❌ Failed to merge PR #${pr.number}: ${error.message}`);
        }
      }
      
      console.log('\n🎉 Merge operation completed!');
    }
    
  } catch (error) {
    console.error(`❌ CLI failed: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Setup and run the CLI
 */
function main() {
  const program = new Command();
  
  program
    .name('automerge-dependabot')
    .description('CLI tool to analyze and optionally merge Dependabot pull requests')
    .version('1.0.0');

  // Main command
  program
    .command('run')
    .description('Analyze and optionally merge Dependabot pull requests')
    .argument('<url>', 'GitHub repository URL (e.g., https://github.com/owner/repo)')
    .option('-t, --token <token>', 'GitHub token (or use GITHUB_TOKEN env var, or use "$(gh auth print-token)" for secure CLI authentication)')
    .option('--minimum-age <days>', 'Minimum age of PR in days before merging', '0')
    .option('--blackout-periods <periods>', 'Blackout periods when action should not run')
    .option('--ignored-dependencies <deps>', 'Comma-separated list of dependencies to ignore')
    .option('--always-allow <patterns>', 'Comma-separated list of patterns to always allow')
    .option('--always-allow-labels <labels>', 'Comma-separated list of PR labels that bypass all filters')
    .option('--ignored-versions <versions>', 'Comma-separated list of specific versions to ignore')
    .option('--semver-filter <levels>', 'Semver levels to allow (major,minor,patch,unknown)', 'patch,minor')
    .option('--merge-method <method>', 'Merge method (merge, squash, rebase)', 'merge')
    .option('--retry-delay-ms <ms>', 'Delay in milliseconds between retries when checking PR mergeability', '2000')
    .option('--no-dry-run', 'Actually merge PRs (default is dry run)')
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (url, options) => {
      // Convert string options to appropriate types
      options.url = url;
      options.minimumAge = parseInt(options.minimumAge, 10);
      options.retryDelayMs = parseInt(options.retryDelayMs, 10) || 10000;
      options.dryRun = !options.noDryRun; // Commander converts --no-dry-run to noDryRun: true
      
      await runCli(options);
    });

  // Auth status command
  program
    .command('auth-status')
    .description('Check authentication status and show secure setup options')
    .action(() => {
      console.log('🔑 Checking authentication status...\n');
      
      // Check environment variable
      const envToken = process.env.GITHUB_TOKEN;
      if (envToken) {
        console.log('✅ GITHUB_TOKEN environment variable is set');
        console.log(`   Token length: ${envToken.length} characters`);
        console.log(`   Token prefix: ${envToken.substring(0, 8)}...`);
      } else {
        console.log('❌ GITHUB_TOKEN environment variable is not set');
      }
      
      console.log('\n📋 Authentication options (in priority order):');
      console.log('  1. --token option with a personal access token');
      console.log('  2. GITHUB_TOKEN environment variable');
      
      console.log('\n🛡️  Secure authentication with GitHub CLI:');
      console.log('  • Install GitHub CLI: https://cli.github.com/');
      console.log('  • Login to GitHub: gh auth login');
      console.log('  • Use with CLI tool: --token "$(gh auth print-token)"');
      console.log('  • Set environment: export GITHUB_TOKEN=$(gh auth print-token)');
      
      console.log('\n💡 Benefits of using GitHub CLI:');
      console.log('  • No hardcoded tokens in scripts or history');
      console.log('  • Automatic token refresh when needed');
      console.log('  • Works with SSO and 2FA enabled organizations');
      console.log('  • Secure credential storage');
      
      console.log('\n🔗 Example usage:');
      console.log('  automerge-dependabot run https://github.com/owner/repo --token "$(gh auth print-token)"');
    });

  // If no command specified, default to 'run' for backward compatibility
  if (process.argv.length <= 2 || !['run', 'auth-status'].includes(process.argv[2])) {
    // Insert 'run' command if not present
    if (process.argv.length > 2 && !process.argv[2].startsWith('-')) {
      process.argv.splice(2, 0, 'run');
    }
  }
  
  program.parse();
}

// Only run if this is the main module
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

export {
  runCli,
  parseGitHubUrl,
  createMockContext,
  createMockCore,
  main
};
