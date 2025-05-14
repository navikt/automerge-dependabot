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
    
    if (combinedStatus.state === 'failure') {
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
      core.debug(`PR #${pr.number} has blocking reviews`);
      continue;
    }
    
    // All checks passed, PR is eligible for auto-merging
    const prData = {
      ...pr,
      prDetails
    };

    // Check if PR title matches multiple dependency pattern
    const isMultipleDependencyPR = pr.title.match(/Bump ([^ ]+) and ([^ ]+) in ([^ ]+)/) || 
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

/**
 * Extract information from multiple dependencies from PR title and body, returns list of dependency information
 * 
 * @param {string} title - Pull request title
 * @param {string} body - Pull request body
 * @returns {Array} List of dependency information
 */
function extractMultipleDependencyInfo(title, body) {
  // Expected format: "Bump dependency-A and dependency-B in /my-group"
  const matchTwoDeps = title.match(/Bump ([^ ]+) and ([^ ]+) in ([^ ]+)/);

  if(matchTwoDeps) {
    // Extract dependency information in the body for each dependency
    // Expected format: Updates dependency-A from x.y.z to x.y.z
    const bodyMatches = body.match(/Updates ([^ ]+) from ([0-9.]+) to ([0-9.]+)/g);
    if (bodyMatches) {
      return bodyMatches.map(match => {
        const updateMatch = match.match(/Updates ([^ ]+) from ([0-9.]+) to ([0-9.]+)/);
        if (!updateMatch) return null;
        
        const [, name, fromVersion, toVersion] = updateMatch;
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
      
      // Determine semver change level
      let semverChange = 'unknown';
      
      // Clean up versions (remove backticks if present)
      fromVersion = fromVersion.trim().replace(/`/g, '');
      toVersion = toVersion.trim().replace(/`/g, '');
      
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
  extractMultipleDependencyInfo
};