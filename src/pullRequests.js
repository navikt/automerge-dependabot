import * as core from '@actions/core';
import * as timeUtils from './timeUtils.js';
import semver from 'semver';
import { recordFilterReason } from './filters.js';

/**
 * Determine semver change level between two versions
 * 
 * @param {string} fromVersion - The original version
 * @param {string} toVersion - The new version
 * @returns {string} The semver change level ('major', 'minor', 'patch', or 'unknown')
 */
function determineSemverChange(fromVersion, toVersion) {
  // Initialize with unknown
  let semverChange = 'unknown';
  
  // If either version is not a string or is empty, return unknown
  if (!fromVersion || !toVersion || typeof fromVersion !== 'string' || typeof toVersion !== 'string') {
    return semverChange;
  }

   // Handle common non-semver patterns explicitly
  // Check for commit hashes (Git SHA-like strings)
  const isFromHash = /^[a-f0-9]{7,40}$/i.test(fromVersion);
  const isToHash = /^[a-f0-9]{7,40}$/i.test(toVersion);
  if (isFromHash && isToHash) {
    return semverChange;
  }
  
  // Try to use semver library to determine the change type
  try {
    // Use semver.coerce to handle non-standard version formats
    const cleanedFromVersion = semver.valid(semver.coerce(fromVersion));
    const cleanedToVersion = semver.valid(semver.coerce(toVersion));
    
    if (cleanedFromVersion && cleanedToVersion) {
      const fromMajor = semver.major(cleanedFromVersion);
      const toMajor = semver.major(cleanedToVersion);
      const fromMinor = semver.minor(cleanedFromVersion);
      const toMinor = semver.minor(cleanedToVersion);
      const fromPatch = semver.patch(cleanedFromVersion);
      const toPatch = semver.patch(cleanedToVersion);
      
      // Check for downgrades (when the to version is lower than the from version)
      if (semver.lt(cleanedToVersion, cleanedFromVersion)) {
        // For downgrades, keep the semver change as 'unknown'
        semverChange = 'unknown';
      }
      // Only handle upgrades with semver labels (not downgrades)
      else if (toMajor > fromMajor) {
        semverChange = 'major';
      } else if (toMinor > fromMinor) {
        semverChange = 'minor';
      } else if (toPatch > fromPatch) {
        semverChange = 'patch';
      }
      // If versions are equal after coercion, keep as 'unknown'
    }
  } catch (error) {
    // If semver parsing fails, keep as 'unknown'
    core.debug(`Failed to determine semver change: ${error.message}`);
  }
  
  return semverChange;
}

/**
 * Evaluate the combined status and check runs for a given commit ref.
 *
 * GitHub exposes two separate APIs for CI results:
 *
 * 1. Status API  (legacy) — GET /repos/{owner}/{repo}/commits/{ref}/status
 *    https://docs.github.com/en/rest/commits/statuses#get-the-combined-status-for-a-specific-reference
 *    Combined state is one of: "failure" | "pending" | "success"
 *    - "failure"  → at least one context reported "error" or "failure"
 *    - "pending"  → no statuses exist (total_count === 0) OR a context is still pending
 *    - "success"  → all contexts reported success
 *
 * 2. Checks API (modern) — GET /repos/{owner}/{repo}/commits/{ref}/check-runs
 *    https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference
 *    Each check run has a "status" (queued | in_progress | completed | waiting | requested | pending)
 *    and, when completed, a "conclusion" (success | failure | neutral | cancelled | skipped |
 *    timed_out | action_required | stale).
 *    GitHub Actions and all modern CI providers use this API exclusively.
 *
 * @param {Object} combinedStatus - Response data from getCombinedStatusForRef
 * @param {Array}  checkRuns      - Array of check run objects from checks.listForRef
 * @returns {{ failed: boolean, pending: boolean }}
 */
function evaluateChecks(combinedStatus, checkRuns) {
  // Status API: "failure" covers both "error" and "failure" individual states.
  // "pending" with total_count > 0 means a legacy status is still running.
  const statusFailed  = combinedStatus.state === 'failure';
  const statusPending = combinedStatus.state === 'pending' && combinedStatus.total_count > 0;

  // Checks API: these conclusions mean the check did not pass cleanly.
  const anyCheckFailed = checkRuns.some(run =>
    run.conclusion === 'failure' ||
    run.conclusion === 'cancelled' ||
    run.conclusion === 'timed_out' ||
    run.conclusion === 'action_required' ||
    run.conclusion === 'stale'
  );
  const anyCheckPending = checkRuns.some(run =>
    run.status === 'queued' || run.status === 'in_progress'
  );

  return {
    failed:  statusFailed  || anyCheckFailed,
    pending: statusPending || anyCheckPending,
  };
}

/**
 * Find pull requests that are eligible for auto-merging
 * 
 * @param {Object} octokit - GitHub API client
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} minimumAgeInDays - Minimum age of PR in days
 * @param {number} retryDelayMs - Delay in milliseconds between retries
 * @returns {Object} Object with eligiblePRs and initialPRs arrays
 */
async function findMergeablePRs(octokit, owner, repo, minimumAgeInDays, retryDelayMs = 2000) {
  core.info('Finding eligible pull requests for auto-merging...');
  
  // Get open pull requests created by Dependabot
  const { data: pullRequests } = await octokit.rest.pulls.list({
    owner,
    repo,
    state: 'open',
    sort: 'created',
    direction: 'asc',
    per_page: 100
  });
  
  const minimumAge = timeUtils.subtractDays(new Date(), minimumAgeInDays);
  
  core.info(`Found ${pullRequests.length} open pull requests. Filtering based on criteria...`);
  
  // Filter for Dependabot PRs that meet our criteria
  const eligiblePRs = [];
  
  for (const pr of pullRequests) {
    // Skip if not from Dependabot
    if (pr.user.login !== 'dependabot[bot]') {
      recordFilterReason(pr.number, 'general', `Not created by Dependabot (creator: ${pr.user.login})`);
      continue;
    }
    
    // Skip if PR is not old enough
    const createdAt = new Date(pr.created_at);
    if (timeUtils.isAfter(createdAt, minimumAge)) {
      const reason = `Too recent (${timeUtils.fromNow(createdAt)}, needs to be at least ${minimumAgeInDays} days old)`;
      recordFilterReason(pr.number, 'general', reason);
      core.debug(`PR #${pr.number} is ${reason}`);
      continue;
    }
    
    // Check if PR can be merged with retry logic for null mergeable state
    const prDetails = await checkPRMergeability(octokit, owner, repo, pr.number, retryDelayMs);
    
    if (!prDetails) {
      recordFilterReason(pr.number, null, 'Could not determine mergeable state after retries');
      core.debug(`PR #${pr.number} mergeable state could not be determined`);
      continue;
    }
    
    if (!prDetails.mergeable) {
      recordFilterReason(pr.number, 'general', 'Not in mergeable state');
      core.debug(`PR #${pr.number} is not mergeable`);
      continue;
    }
    
    // Security check: Ensure all commits are from Dependabot
    const { data: commits } = await octokit.rest.pulls.listCommits({
      owner,
      repo,
      pull_number: pr.number
    });
    
    const nonDependabotCommits = commits.filter(commit => {
      const author = commit.author?.login || '';
      const committer = commit.committer?.login || '';
      return author !== 'dependabot[bot]' && committer !== 'dependabot[bot]';
    });
    
    if (nonDependabotCommits.length > 0) {
      const reason = 'contains commits from authors other than Dependabot';
      recordFilterReason(pr.number, 'general', `${reason} (security risk)`);
      core.warning(`PR #${pr.number} ${reason}`);
      for (const commit of nonDependabotCommits) {
        core.debug(`  Non-Dependabot commit: ${commit.sha.substring(0, 7)} from ${commit.author?.login || 'unknown'}`);
      }
      continue;
    }
    
    // Check for required checks — Status API (legacy) and Checks API (GitHub Actions / modern CI).
    // See evaluateChecks() above for documentation on both APIs.
    const { data: combinedStatus } = await octokit.rest.repos.getCombinedStatusForRef({
      owner,
      repo,
      ref: pr.head.sha
    });
    const { data: checkRunsData } = await octokit.rest.checks.listForRef({
      owner,
      repo,
      ref: pr.head.sha
    });
    const { failed: checksFailed, pending: checksPending } = evaluateChecks(
      combinedStatus,
      checkRunsData.check_runs || []
    );

    if (checksFailed) {
      recordFilterReason(pr.number, 'general', 'Has failing checks');
      core.debug(`PR #${pr.number} has failing checks`);
      continue;
    }

    if (checksPending) {
      recordFilterReason(pr.number, 'general', 'Has pending checks');
      core.debug(`PR #${pr.number} has pending checks`);
      continue;
    }
    
    // Get PR reviews
    const { data: reviews } = await octokit.rest.pulls.listReviews({
      owner,
      repo,
      pull_number: pr.number
    });
    
    // Check if there are any blocking reviews
    const hasBlockingReviews = reviews.some(review => 
      review.state === 'REQUEST_CHANGES' && !reviews.some(r => 
        r.user.id === review.user.id && 
        r.submitted_at > review.submitted_at && 
        r.state === 'APPROVED'
      )
    );
    
    if (hasBlockingReviews) {
      recordFilterReason(pr.number, 'general', 'Has blocking reviews');
      core.debug(`PR #${pr.number} has blocking reviews`);
      continue;
    }
    
    // All checks passed, PR is eligible for auto-merging
    const prData = {
      ...pr,
      prDetails,
      labels: pr.labels || [] // Ensure labels are included
    };

    // Check if PR title matches multiple dependency pattern
    const isMultipleDependencyPR = pr.title.match(/(?:B|: b)ump([s]?) ([^ ]+) and ([^ ]+)( in ([^ ]+))?/) ||
                                  pr.title.match(/(?:B|: b)ump([s]?) the ([^ ]+)( group| across| with| in| updates|[ ]+)+/);

    if (isMultipleDependencyPR) {
      prData.dependencyInfoList = extractMultipleDependencyInfo(pr.title, pr.body);
      // If no dependencies could be extracted, fall back to single dependency info
      if (prData.dependencyInfoList.length === 0) {
        prData.dependencyInfo = extractDependencyInfo(pr.title);
      }
    } else {
      // Single dependency update
      prData.dependencyInfo = extractDependencyInfo(pr.title);
    }

    eligiblePRs.push(prData);
  }
  
  core.info(`Found ${eligiblePRs.length} eligible pull requests for auto-merging`);
  return {
    eligiblePRs,
    initialPRs: pullRequests
  };
}

/**
 * Check PR mergeability with retry logic for null mergeable state
 * Reason: https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-your-git-database?apiVersion=2022-11-28#checking-mergeability-of-pull-requests
 * 
 * @param {Object} octokit - GitHub API client
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} pullNumber - Pull request number
 * @param {number} retryDelayMs - Delay in milliseconds between retries
 * @returns {Object|null} PR details with mergeable state, or null if could not be determined
 */
async function checkPRMergeability(octokit, owner, repo, pullNumber, retryDelayMs = 10000) {
  const maxRetries = 3;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { data: prDetails } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: pullNumber
      });
      
      // If mergeable is not null, we have a definitive answer
      if (prDetails.mergeable !== null) {
        core.debug(`PR #${pullNumber} mergeable state determined: ${prDetails.mergeable} (attempt ${attempt})`);
        return prDetails;
      }
      
      // If mergeable is null and this isn't our last attempt, wait and retry
      if (attempt < maxRetries) {
        core.debug(`PR #${pullNumber} mergeable state is null (attempt ${attempt}/${maxRetries}), retrying in ${retryDelayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      } else {
        core.warning(`PR #${pullNumber} mergeable state is still null after ${maxRetries} attempts`);
        return null;
      }
      
    } catch (error) {
      core.warning(`Error checking PR #${pullNumber} mergeability (attempt ${attempt}): ${error.message}`);
      if (attempt === maxRetries) {
        return null;
      }
      // Wait before retrying on error
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }
  
  return null;
}

/**
 * Extract dependency information from PR title
 * 
 * @param {string} title - Pull request title
 * @returns {Object} Dependency information
 */
function extractDependencyInfo(title) {
  // Expected format: "Bump dependency-name from X.Y.Z to A.B.C", or a conventional-commit variant of this:
  // "build(deps): bump dependency-name from X.Y.Z to A.B.C"
  const match = title.match(/(?:B|: b)ump ([^ ]+) from ([^ ]+) to ([^ ]+)/);
  
  if (!match) {
    return {
      name: null,
      fromVersion: null,
      toVersion: null,
      semverChange: null
    };
  }
  
  const [, name, fromVersion, toVersion] = match;
  
  // Determine semver change level
  const semverChange = determineSemverChange(fromVersion, toVersion);
  
  return {
    name,
    fromVersion,
    toVersion,
    semverChange
  };
}

/**
 * Extract information from multiple dependencies from PR title and body, returns list of dependency information
 * 
 * @param {string} title - Pull request title
 * @param {string} body - Pull request body
 * @returns {Array} List of dependency information
 */
function extractMultipleDependencyInfo(title, body) {
  // Look for any format that mentions bumping two dependencies
  // Format 1: "Bump dependency-A and dependency-B in /my-group"
  // Format 2: "Bump cookie and express" (without the "in" part)
  // or conventional-commit variants of these, e.g.
  // Format 1: "chore(deps-dev): bump dependency-A and dependency-B in /my-group"
  // Format 2: "build(deps): bump cookie and express"
  const matchTwoDeps = title.match(/(?:B|: b)ump ([^ ]+) and ([^ ]+)( in ([^ ]+))?/);

  if(matchTwoDeps) {
    // Extract dependency information in the body for each dependency
    // Expected format: Updates dependency-A from x.y.z to x.y.z
    // Alternative format: Updates `dependency-A` from x.y.z to x.y.z (with backticks)
    const bodyMatches = body.match(/Updates [`']?([^`'\s]+)[`']? from ([0-9.]+) to ([0-9.]+)/g);
    if (bodyMatches) {
      return bodyMatches.map(match => {
        const updateMatch = match.match(/Updates [`']?([^`'\s]+)[`']? from ([0-9.]+) to ([0-9.]+)/);
        if (!updateMatch) return null;
        
        const [, name, fromVersion, toVersion] = updateMatch;
        // Determine semver change level
        const semverChange = determineSemverChange(fromVersion, toVersion);
        
        return {
          name,
          fromVersion,
          toVersion,
          semverChange
        };
      }).filter(item => item !== null);
    }
    return [];
  }

  // Expected format: "Bump the dependabot-group across X directory with Z updates"
  // or "Bumps the maven group in /app with 3 updates", or conventional-commit variants of these
  const matchDependencyGroup = title.match(/(?:B|: b)ump([s]?) the ([^ ]+)( group| across| with| in| updates|[ ]+)+/);
  if (matchDependencyGroup) {
    // First, try to extract dependency information from the markdown table in the PR body
    const tableRegex = /\|\s*([^|\n]+?)\s*\|\s*`?([^`|\n]+)`?\s*\|\s*`?([^`|\n]+)`?\s*\|/g;
    const dependencies = [];
    
    let tableMatch;
    // Skip the header row with column names and the formatting row (with ---)
    let rowCount = 0;
    
    while ((tableMatch = tableRegex.exec(body)) !== null) {
      // Skip the header row and formatting row
      if (rowCount < 2) {
        rowCount++;
        continue;
      }
      
      // Extract package name, removing any markdown links
      let [, packageName, fromVersion, toVersion] = tableMatch;
      // Clean up package name (remove markdown links if present)
      packageName = packageName.replace(/\[([^\]]+)\]\([^)]+\)/, '$1').trim();
      
      // Clean up versions (remove backticks if present)
      fromVersion = fromVersion.trim().replace(/`/g, '');
      toVersion = toVersion.trim().replace(/`/g, '');
      
      // Determine semver change level
      const semverChange = determineSemverChange(fromVersion, toVersion);
      
      dependencies.push({
        name: packageName,
        fromVersion,
        toVersion,
        semverChange
      });
    }
    
    // If we found dependencies from the table, return them
    if (dependencies.length > 0) {
      return dependencies;
    }
    
    // No table found, try to extract from the "Updates" format
    const updateMatches = body.match(/Updates [`']?([^`'\s]+)[`']? from ([0-9.]+) to ([0-9.]+)/g);
    if (updateMatches) {
      return updateMatches.map(match => {
        const updateMatch = match.match(/Updates [`']?([^`'\s]+)[`']? from ([0-9.]+) to ([0-9.]+)/);
        if (!updateMatch) return null;
        
        const [, name, fromVersion, toVersion] = updateMatch;
        // Determine semver change level
        const semverChange = determineSemverChange(fromVersion, toVersion);
        
        return {
          name,
          fromVersion,
          toVersion,
          semverChange
        };
      }).filter(item => item !== null);
    }
    
    return dependencies;
  }

  return [];
}

/**
 * Approve a pull request
 *
 * @param {Object} octokit - GitHub API client
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} pullNumber - Pull request number
 * @returns {boolean} True if approval succeeded, false otherwise
 */
async function approvePullRequest(octokit, owner, repo, pullNumber) {
  try {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: pullNumber,
      event: 'APPROVE'
    });
    core.info(`Approved PR #${pullNumber}`);
    return true;
  } catch (error) {
    core.warning(`Failed to approve PR #${pullNumber}: ${error.message}`);
    return false;
  }
}

/**
 * Update a pull request branch to sync with the base branch
 *
 * @param {Object} octokit - GitHub API client
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} pullNumber - Pull request number
 * @returns {boolean} True if update succeeded, false otherwise
 */
async function updatePRBranch(octokit, owner, repo, pullNumber) {
  try {
    await octokit.rest.pulls.updateBranch({
      owner,
      repo,
      pull_number: pullNumber
    });
    core.info(`Updated branch for PR #${pullNumber} to sync with base branch`);
    return true;
  } catch (error) {
    core.warning(`Failed to update branch for PR #${pullNumber}: ${error.message}`);
    return false;
  }
}

/**
 * Wait for checks to pass after updating a PR branch
 *
 * @param {Object} octokit - GitHub API client
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} pullNumber - Pull request number
 * @param {number} maxWaitSeconds - Maximum time to wait in seconds
 * @param {number} retryDelayMs - Delay in milliseconds between retries
 * @returns {boolean} True if checks pass, false if timeout or failure
 */
async function waitForChecksAfterUpdate(octokit, owner, repo, pullNumber, maxWaitSeconds, retryDelayMs = 2000) {
  const startTime = Date.now();
  const maxWaitMs = maxWaitSeconds * 1000;
  let attempt = 0;
  
  core.info(`Waiting up to ${maxWaitSeconds} seconds for checks to pass on PR #${pullNumber} after branch update...`);
  
  while (true) {
    attempt++;
    
    try {
      // Check PR mergeability
      const prDetails = await checkPRMergeability(octokit, owner, repo, pullNumber, retryDelayMs);
      
      if (prDetails) {
        // Evaluate both APIs via shared helper — see evaluateChecks() for API documentation.
        const { data: combinedStatus } = await octokit.rest.repos.getCombinedStatusForRef({
          owner,
          repo,
          ref: prDetails.head.sha
        });
        const { data: checkRunsData } = await octokit.rest.checks.listForRef({
          owner,
          repo,
          ref: prDetails.head.sha
        });
        const { failed: checksFailed, pending: checksPending } = evaluateChecks(
          combinedStatus,
          checkRunsData.check_runs || []
        );
        const statusSuccess = combinedStatus.state === 'success' || combinedStatus.total_count === 0;

        // If any check has failed, no point in waiting
        if (checksFailed) {
          core.warning(`Checks failed for PR #${pullNumber} after branch update`);
          return false;
        }
        
        // Check if all checks are passing
        if (prDetails.mergeable && statusSuccess && !checksPending) {
          core.info(`Checks passed for PR #${pullNumber} after ${Math.round((Date.now() - startTime) / 1000)}s`);
          return true;
        }
        
        // If not mergeable due to conflicts, fail immediately
        if (!prDetails.mergeable) {
          core.warning(`PR #${pullNumber} is not mergeable after branch update (may have conflicts)`);
          return false;
        }
        
        core.debug(`PR #${pullNumber} checks still pending (attempt ${attempt}, elapsed: ${Math.round((Date.now() - startTime) / 1000)}s)`);
      } else {
        core.debug(`PR #${pullNumber} mergeable state could not be determined (attempt ${attempt})`);
      }

      // Timeout check after API calls – ensures we don't sleep past the deadline
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs >= maxWaitMs) {
        core.warning(`Timeout waiting for checks to pass on PR #${pullNumber} (waited ${Math.round(elapsedMs / 1000)}s)`);
        return false;
      }
      
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      
    } catch (error) {
      core.warning(`Error checking PR #${pullNumber} status (attempt ${attempt}): ${error.message}`);
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs >= maxWaitMs) {
        core.warning(`Timeout waiting for checks to pass on PR #${pullNumber} (waited ${Math.round(elapsedMs / 1000)}s)`);
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }
}

export {
  findMergeablePRs,
  extractDependencyInfo,
  extractMultipleDependencyInfo,
  determineSemverChange,
  checkPRMergeability,
  approvePullRequest,
  updatePRBranch,
  waitForChecksAfterUpdate,
  evaluateChecks
};
