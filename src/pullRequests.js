const core = require('@actions/core');
const timeUtils = require('./timeUtils');

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
      continue;
    }
    
    // Skip if PR is not old enough
    const createdAt = new Date(pr.created_at);
    if (timeUtils.isAfter(createdAt, minimumAge)) {
      core.debug(`PR #${pr.number} is too recent (${timeUtils.fromNow(createdAt)})`);
      continue;
    }
    
    // Check if PR can be merged
    const { data: prDetails } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pr.number
    });
    
    if (!prDetails.mergeable) {
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
      core.warning(`PR #${pr.number} contains commits from authors other than Dependabot - potential security risk`);
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
    
    if (combinedStatus.state !== 'success') {
      core.debug(`PR #${pr.number} has pending or failing status checks`);
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
      core.debug(`PR #${pr.number} has blocking reviews`);
      continue;
    }
    
    // All checks passed, PR is eligible for auto-merging
    eligiblePRs.push({
      ...pr,
      prDetails,
      dependencyInfo: extractDependencyInfo(pr.title)
    });
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
  let semverChange = 'unknown';
  
  // Common version formats
  const fromParts = fromVersion.split('.').map(p => parseInt(p, 10));
  const toParts = toVersion.split('.').map(p => parseInt(p, 10));
  
  if (fromParts.length >= 3 && toParts.length >= 3) {
    if (toParts[0] > fromParts[0]) {
      semverChange = 'major';
    } else if (toParts[1] > fromParts[1]) {
      semverChange = 'minor';
    } else if (toParts[2] > fromParts[2]) {
      semverChange = 'patch';
    }
  }
  
  return {
    name,
    fromVersion,
    toVersion,
    semverChange
  };
}

module.exports = {
  findMergeablePRs
};