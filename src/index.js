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
    
    // Prepare filter options - we'll use this regardless of whether we're in a blackout period
    const filterOptions = {
      ignoredDependencies: ignoredDependencies ? ignoredDependencies.split(',').map(d => d.trim()) : [],
      alwaysAllow: alwaysAllow ? alwaysAllow.split(',').map(d => d.trim()) : [],
      ignoredVersions: ignoredVersions ? ignoredVersions.split(',').map(v => v.trim()) : [],
      semverFilter: semverFilter ? semverFilter.split(',').map(s => s.trim()) : ['patch', 'minor']
    };
    
    // Initialize variables for PR processing
    let pullRequests = [];
    let filteredPRs = [];
    let inBlackoutPeriod = false;
    
    // Check if the action should run at the current time
    if (!shouldRunAtCurrentTime(blackoutPeriods)) {
      inBlackoutPeriod = true;
      core.info('Action is in a blackout period. Skipping execution.');
    } else {      
      // Create octokit client
      const octokit = github.getOctokit(token);
      const context = github.context;
      
      // Find potential PRs to merge
      pullRequests = await findMergeablePRs(
        octokit, 
        context.repo.owner, 
        context.repo.repo, 
        minimumAgeInDays
      );
      
      if (pullRequests.length === 0) {
        core.info('No eligible pull requests found for automerging.');
      } else {
        // Apply filters to eligible PRs
        filteredPRs = applyFilters(
          pullRequests, 
          filterOptions
        );
        
        if (filteredPRs.length === 0) {
          core.info('No pull requests passed the filters for automerging.');
        } else {
          // Merge eligible PRs
          for (const pr of filteredPRs) {
            try {
              core.info(`Attempting to merge PR #${pr.number}: ${pr.title}`);
              
              try {
                await octokit.rest.pulls.merge({
                  owner: context.repo.owner,
                  repo: context.repo.repo,
                  pull_number: pr.number,
                  merge_method: mergeMethod
                });
                
                core.info(`Successfully merged PR #${pr.number}`);
              } catch (mergeError) {
                // Check for merge queue warnings in the error message
                const isMergeQueueError = 
                  (mergeError.message && (
                    mergeError.message.toLowerCase().includes('merge queue') || 
                    mergeError.message.toLowerCase().includes('branch protection') ||
                    mergeError.message.toLowerCase().includes('required status check')
                  )) ||
                  (mergeError.status === 405 || mergeError.status === 422);
                
                // If this appears to be a merge queue error and merge method isn't 'merge'
                if (isMergeQueueError && mergeMethod !== 'merge') {
                  core.warning(`PR #${pr.number} may require a merge queue, but merge method is set to '${mergeMethod}'. Only 'merge' method is supported with merge queues.`);
                  core.warning('To use merge queues, change the \'merge-method\' input to \'merge\' in your workflow configuration.');
                }
                
                // Always throw the error since we're not actually handling merge queues
                throw mergeError;
              }
            } catch (error) {
              core.warning(`Failed to merge PR #${pr.number}: ${error.message}`);
            }
          }
        }
      }
    }
    
    // Always add workflow summary at the end with the final state
    await addWorkflowSummary(pullRequests, filteredPRs, filterOptions);
    
    // If we're in a blackout period or have no PRs to merge, we can return early
    if (inBlackoutPeriod || pullRequests.length === 0 || filteredPRs.length === 0) {
      return;
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