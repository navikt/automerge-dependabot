const core = require('@actions/core');
const github = require('@actions/github');
const { findMergeablePRs, approvePullRequest } = require('./pullRequests');
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
    const retryDelayMs = parseInt(core.getInput('retry-delay-ms'), 10) || 10000;
    const autoApprove = core.getInput('auto-approve') === 'true';
    
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
    let initialPRs = [];
    let mergedPRCount = 0;

    // Check if the action should run at the current time
    if (!shouldRunAtCurrentTime(blackoutPeriods)) {
      core.info('Action is in a blackout period. Skipping execution.');
    } else {
      // Create octokit client
      const octokit = github.getOctokit(token);
      const context = github.context;

      // Check if running from default branch for security
      try {
        const { data: repo } = await octokit.rest.repos.get({
          owner: context.repo.owner,
          repo: context.repo.repo
        });

        const currentRef = context.ref;
        const defaultBranch = `refs/heads/${repo.default_branch}`;

        if (currentRef !== defaultBranch) {
          core.warning(`Action is not running from the default branch (${repo.default_branch}). Current ref: ${currentRef}. Skipping execution for security reasons.`);
          core.setOutput('merged-pr-count', 0);
          return 0;
        }

        core.info(`Action is running from the default branch (${repo.default_branch}). Proceeding with execution.`);
      } catch (error) {
        core.warning(`Failed to verify default branch: ${error.message}. Skipping execution for security reasons.`);
        core.setOutput('merged-pr-count', 0);
        return 0;
      }

      // Find potential PRs to merge
      const result = await findMergeablePRs(
        octokit,
        context.repo.owner,
        context.repo.repo,
        minimumAgeInDays,
        retryDelayMs
      );

      pullRequests = result.eligiblePRs;
      initialPRs = result.initialPRs;

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

              // Auto-approve if enabled
              if (autoApprove) {
                const approved = await approvePullRequest(
                  octokit,
                  context.repo.owner,
                  context.repo.repo,
                  pr.number
                );
                if (!approved) {
                  core.warning(
                    `Skipping merge of PR #${pr.number} due to approval failure`
                  );
                  continue;
                }
              }

              try {
                await octokit.rest.pulls.merge({
                  owner: context.repo.owner,
                  repo: context.repo.repo,
                  pull_number: pr.number,
                  merge_method: mergeMethod
                });

                core.info(`Successfully merged PR #${pr.number}`);
                mergedPRCount++;

                // Add a delay after successful merge to allow GitHub to process the changes
                // This helps prevent race conditions with subsequent PRs
                if (retryDelayMs > 0) {
                  core.debug(`Waiting ${retryDelayMs}ms after merge to allow GitHub to process changes`);
                  await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                }
                
              } catch (mergeError) {
                // Check if this is a "base branch was modified" error that we can retry
                const isBaseBranchModifiedError =
                  mergeError.message &&
                  mergeError.message.toLowerCase().includes('base branch was modified');

                if (isBaseBranchModifiedError) {
                  core.warning(`PR #${pr.number} failed due to base branch modification. Re-verifying mergeability and retrying...`);

                  // Re-verify PR mergeability after base branch modification
                  const { checkPRMergeability } = require('./pullRequests');
                  const currentPRDetails = await checkPRMergeability(octokit, context.repo.owner, context.repo.repo, pr.number, retryDelayMs);

                  if (!currentPRDetails || !currentPRDetails.mergeable) {
                    core.warning(`PR #${pr.number} is no longer mergeable after base branch modification. Skipping.`);
                    continue;
                  }

                  // Retry the merge
                  core.info(`Retrying merge for PR #${pr.number} after re-verification`);
                  await octokit.rest.pulls.merge({
                    owner: context.repo.owner,
                    repo: context.repo.repo,
                    pull_number: pr.number,
                    merge_method: mergeMethod
                  });

                  core.info(`Successfully merged PR #${pr.number} on retry`);
                  mergedPRCount++;

                  // Add a delay after successful merge
                  if (retryDelayMs > 0) {
                    core.debug(`Waiting ${retryDelayMs}ms after merge to allow GitHub to process changes`);
                    await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                  }
                } else {
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

                  // Always throw the error since we're not handling other types of merge errors
                  throw mergeError;
                }
              }
            } catch (error) {
              core.warning(`Failed to merge PR #${pr.number}: ${error.message}`);
            }
          }
        }
      }
    }

    // Always add workflow summary at the end with the final state
    await addWorkflowSummary(pullRequests, filteredPRs, filterOptions, initialPRs);

    // Set the output for the number of merged PRs
    core.setOutput('merged-pr-count', mergedPRCount);

    return mergedPRCount;

  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
    core.setOutput('merged-pr-count', 0);
    return 0;
  }
}

// Run the action
if (require.main === module) {
  (async () => {
    try {
      const mergedPRCount = await run();
      if (process.env.GITHUB_ACTIONS) {
        core.info(`Action finished. Merged ${mergedPRCount} PR(s).`);
      }
    } catch (error) {
      if (process.env.GITHUB_ACTIONS) {
        core.setFailed(`Action failed with an unhandled error: ${error.message}`);
      } else {
        console.error('Action failed with an unhandled error:', error);
        process.exit(1);
      }
    }
  })();
}

// Export for testing
module.exports = { run };