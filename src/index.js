const core = require('@actions/core');
const github = require('@actions/github');
const { findMergeablePRs } = require('./pullRequests');
const { shouldRunAtCurrentTime } = require('./timeUtils');
const { applyFilters } = require('./filters');
const { addWorkflowSummary } = require('./summary');

async function run() {
  try {
    // Get inputs
    const tokenInput = core.getInput('token');
    let token = tokenInput;
    
    // Check if the input is referencing an environment variable
    if (tokenInput.startsWith('$')) {
      const envVarName = tokenInput.substring(1);
      if (process.env[envVarName]) {
        token = process.env[envVarName];
      } else {
        throw new Error(`GitHub token not provided or found in environment variable ${envVarName}`);
      }
    }
    
    if (!token) {
      throw new Error('GitHub token not provided');
    }
    
    const minimumAgeInDays = parseInt(core.getInput('minimum-age-of-pr'), 10);
    const blackoutPeriods = core.getInput('blackout-periods');
    const ignoredDependencies = core.getInput('ignored-dependencies');
    const alwaysAllow = core.getInput('always-allow');
    const ignoredVersions = core.getInput('ignored-versions');
    const semverFilter = core.getInput('semver-filter');
    const mergeMethod = core.getInput('merge-method');
    
    // Check if the action should run at the current time
    if (!shouldRunAtCurrentTime(blackoutPeriods)) {
      core.info('Action is in a blackout period. Skipping execution.');
      
      // Add minimal summary about blackout period
      const summaryOptions = {
        ignoredDependencies: ignoredDependencies ? ignoredDependencies.split(',').map(d => d.trim()) : [],
        alwaysAllow: alwaysAllow ? alwaysAllow.split(',').map(d => d.trim()) : [],
        ignoredVersions: ignoredVersions ? ignoredVersions.split(',').map(v => v.trim()) : [],
        semverFilter: semverFilter ? semverFilter.split(',').map(s => s.trim()) : ['patch', 'minor']
      };
      await addWorkflowSummary([], [], summaryOptions);
      
      return;
    }
    
    // Create octokit client
    const octokit = github.getOctokit(token);
    const context = github.context;
    
    // Find potential PRs to merge
    const pullRequests = await findMergeablePRs(
      octokit, 
      context.repo.owner, 
      context.repo.repo, 
      minimumAgeInDays
    );
    
    // Apply filters and prepare filter options even if no PRs are found
    const filterOptions = {
      ignoredDependencies: ignoredDependencies ? ignoredDependencies.split(',').map(d => d.trim()) : [],
      alwaysAllow: alwaysAllow ? alwaysAllow.split(',').map(d => d.trim()) : [],
      ignoredVersions: ignoredVersions ? ignoredVersions.split(',').map(v => v.trim()) : [],
      semverFilter: semverFilter ? semverFilter.split(',').map(s => s.trim()) : ['patch', 'minor']
    };
    
    // Add information to GitHub workflow summary - do this regardless of whether PRs were found
    await addWorkflowSummary(pullRequests, [], filterOptions);
    
    if (pullRequests.length === 0) {
      core.info('No eligible pull requests found for automerging.');
      return;
    }
    
    // Apply filters to eligible PRs
    const filteredPRs = applyFilters(
      pullRequests, 
      filterOptions
    );
    
    // Update the workflow summary with the filtered results
    await addWorkflowSummary(pullRequests, filteredPRs, filterOptions);
    
    if (filteredPRs.length === 0) {
      core.info('No pull requests passed the filters for automerging.');
      return;
    }
    
    // Merge eligible PRs
    for (const pr of filteredPRs) {
      try {
        core.info(`Attempting to merge PR #${pr.number}: ${pr.title}`);
        
        await octokit.rest.pulls.merge({
          owner: context.repo.owner,
          repo: context.repo.repo,
          pull_number: pr.number,
          merge_method: mergeMethod
        });
        
        core.info(`Successfully merged PR #${pr.number}`);
      } catch (error) {
        core.warning(`Failed to merge PR #${pr.number}: ${error.message}`);
      }
    }
    
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  }
}

// Run the action
if (require.main === module) {
  run();
}

// Export for testing
module.exports = { run };