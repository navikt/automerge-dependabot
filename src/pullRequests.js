const core = require('@actions/core');
const timeUtils = require('./timeUtils');
const semver = require('semver');
const { recordFilterReason } = require('../src/filters');

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
      if (semver.major(cleanedToVersion) > semver.major(cleanedFromVersion)) {
        semverChange = 'major';
      } else if (semver.minor(cleanedToVersion) > semver.minor(cleanedFromVersion)) {
        semverChange = 'minor';
      } else if (semver.patch(cleanedToVersion) > semver.patch(cleanedFromVersion)) {
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
 * Find pull requests that are eligible for auto-merging
 * 
 * @param {Object} octokit - GitHub API client
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} minimumAgeInDays - Minimum age of PR in days
 * @returns {Array} Array of eligible pull requests
 */
async function findMergeablePRs(octokit, owner, repo, minimumAgeInDays) {
  core.info('Finding eligible pull requests for auto-merging...');
  
  // Get open pull requests created by Dependabot
  const { data: pullRequests } = await octokit.rest.pulls.list({
    owner,
    repo,
    state: 'open',
    sort: 'created',
    direction: 'asc'
  });
  
  const minimumAge = timeUtils.subtractDays(new Date(), minimumAgeInDays);
  
  core.info(`Found ${pullRequests.length} open pull requests. Filtering based on criteria...`);
  
  // Filter for Dependabot PRs that meet our criteria
  const eligiblePRs = [];
  
  for (const pr of pullRequests) {
    // Skip if not from Dependabot
    if (pr.user.login !== 'dependabot[bot]') {
      recordFilterReason(pr.number, pr.packageName, `Not created by Dependabot (creator: ${pr.user.login})`);
      continue;
    }
    
    // Skip if PR is not old enough
    const createdAt = new Date(pr.created_at);
    if (timeUtils.isAfter(createdAt, minimumAge)) {
      const reason = `Too recent (${timeUtils.fromNow(createdAt)}, needs to be at least ${minimumAgeInDays} days old)`;
      recordFilterReason(pr.number, pr.packageName, reason);
      core.debug(`PR #${pr.number} is ${reason}`);
      continue;
    }
    
    // Check if PR can be merged
    const { data: prDetails } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pr.number
    });
    
    if (!prDetails.mergeable) {
      recordFilterReason(pr.number, pr.packageName, 'Not in mergeable state');
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
      recordFilterReason(pr.number, pr.packageName, `${reason} (security risk)`);
      core.warning(`PR #${pr.number} ${reason}`);
      for (const commit of nonDependabotCommits) {
        core.debug(`  Non-Dependabot commit: ${commit.sha.substring(0, 7)} from ${commit.author?.login || 'unknown'}`);
      }
      continue;
    }
    
    // Check for required checks
    const { data: combinedStatus } = await octokit.rest.repos.getCombinedStatusForRef({
      owner,
      repo,
      ref: pr.head.sha
    });
    
    if (combinedStatus.state === 'failure') {
      recordFilterReason(pr.number, pr.packageName, 'Has failing status checks');
      core.debug(`PR #${pr.number} has failing status checks`);
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
      recordFilterReason(pr.number, pr.packageName, 'Has blocking reviews');
      core.debug(`PR #${pr.number} has blocking reviews`);
      continue;
    }
    
    // All checks passed, PR is eligible for auto-merging
    const prData = {
      ...pr,
      prDetails
    };

    // Check if PR title matches multiple dependency pattern
    const isMultipleDependencyPR = pr.title.match(/Bump ([^ ]+) and ([^ ]+)( in ([^ ]+))?/) || 
                                  pr.title.match(/Bump the ([^ ]+)( group| across| with| in| updates|[ ]+)+/);

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
  return eligiblePRs;
}

/**
 * Extract dependency information from PR title
 * 
 * @param {string} title - Pull request title
 * @returns {Object} Dependency information
 */
function extractDependencyInfo(title) {
  // Expected format: "Bump dependency-name from X.Y.Z to A.B.C"
  const match = title.match(/Bump ([^ ]+) from ([^ ]+) to ([^ ]+)/);
  
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
  const matchTwoDeps = title.match(/Bump ([^ ]+) and ([^ ]+)( in ([^ ]+))?/);

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
  const matchDependencyGroup = title.match(/Bump the ([^ ]+)( group| across| with| in| updates|[ ]+)+/);
  if (matchDependencyGroup) {
    // Extract dependency information from the markdown table in the PR body
    // Match only table rows with exactly 3 cells (Package, From, To)
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
    
    return dependencies;
  }

  return [];
}

module.exports = {
  findMergeablePRs,
  extractDependencyInfo,
  extractMultipleDependencyInfo,
  determineSemverChange
};