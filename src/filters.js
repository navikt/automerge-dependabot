const core = require('@actions/core');

/**
 * Store the filtering reasons for a PR
 * Key: PR number
 * Value: Object with reason details
 */
const filteringReasons = new Map();

/**
 * Record a filtering reason for a PR
 * 
 * @param {number} prNumber - The pull request number
 * @param {string} reason - The reason for filtering
 */
function recordFilterReason(prNumber, reason) {
  if (!filteringReasons.has(prNumber)) {
    filteringReasons.set(prNumber, { reasons: [] });
  }
  filteringReasons.get(prNumber).reasons.push(reason);
}

/**
 * Reset all stored filtering reasons
 */
function resetFilterReasons() {
  filteringReasons.clear();
}

/**
 * Get filtering reasons for a PR
 * 
 * @param {number} prNumber - The pull request number
 * @returns {Object|null} The filtering reasons for the PR or null if not found
 */
function getFilterReasons(prNumber) {
  return filteringReasons.has(prNumber) ? filteringReasons.get(prNumber) : null;
}

/**
 * Get all filtering reasons
 * 
 * @returns {Map} Map of PR numbers to filtering reasons
 */
function getAllFilterReasons() {
  return filteringReasons;
}

/**
 * Check if a dependency should always be allowed based on the alwaysAllow list
 * 
 * @param {string} name - The dependency name
 * @param {Array} alwaysAllowList - List of always allow patterns
 * @returns {boolean} Whether the dependency should be allowed
 */
function shouldAlwaysAllow(name, alwaysAllowList) {
  // If the list contains a wildcard '*', always allow everything
  if (alwaysAllowList.includes('*')) {
    return true;
  }
  
  // Otherwise, check for pattern matches
  return alwaysAllowList.some(pattern => {
    // First check for exact match with the dependency name
    if (pattern === name) {
      return true;
    }
    
    // If the pattern starts with 'name:', it's a string matching pattern
    if (pattern.startsWith('name:')) {
      const matchValue = pattern.substring(5); // length of 'name:'
      if (matchValue && name.includes(matchValue)) {
        return true;
      }
    }
    
    // Also allow prefix matches (e.g., "no.nav.appsec" should match "no.nav.appsec:contracts")
    if (name.startsWith(pattern)) {
      return true;
    }
    
    return false;
  });
}

/**
 * Apply filters to pull requests
 * 
 * @param {Array} pullRequests - Array of pull requests
 * @param {Object} filters - Filter options
 * @returns {Array} Filtered pull requests
 */
function applyFilters(pullRequests, filters) {
  const { ignoredDependencies, alwaysAllow = [], ignoredVersions, semverFilter } = filters;
  
  // Reset filtering reasons for a new run
  resetFilterReasons();
  
  core.info(`Applying filters: ${
    [
      ignoredDependencies.length > 0 ? `Ignored dependencies: ${ignoredDependencies.join(', ')}` : null,
      alwaysAllow.length > 0 ? `Always allow: ${alwaysAllow.join(', ')}` : null,
      ignoredVersions.length > 0 ? `Ignored versions: ${ignoredVersions.join(', ')}` : null,
      `Semver filter: ${semverFilter.join(', ')}`
    ].filter(Boolean).join('; ')
  }`);
  
  return pullRequests.filter(pr => {
    // Security check: Ensure PR is created by Dependabot
    if (!pr.user || pr.user.login !== 'dependabot[bot]') {
      const reason = `Not created by Dependabot (creator: ${pr.user?.login || 'unknown'})`;
      recordFilterReason(pr.number, reason);
      core.debug(`PR #${pr.number}: Skipping - ${reason}`);
      return false;
    }
    
    // Check if PR contains multiple dependencies or a single dependency
    if (pr.dependencyInfoList && pr.dependencyInfoList.length > 0) {
      // For PRs with multiple dependencies, ALL dependencies must pass the filters
      for (const dependencyInfo of pr.dependencyInfoList) {
        const { name, toVersion, semverChange } = dependencyInfo || {};
        
        // Skip the entire PR if any dependency info is incomplete
        if (!name || !toVersion || !semverChange) {
          const reason = 'Dependency missing info in multiple dependency PR';
          recordFilterReason(pr.number, reason);
          core.debug(`PR #${pr.number}: Skipping - ${reason}`);
          return false;
        }
        
        // Skip the entire PR if any dependency is in the ignored list
        if (ignoredDependencies.some(dep => dep === name)) {
          const reason = `Dependency "${name}" is in ignored list`;
          recordFilterReason(pr.number, reason);
          core.debug(`PR #${pr.number}: Skipping - ${reason}`);
          return false;
        }
        
        // Skip the entire PR if any version is in the ignored list
        const versionMatches = ignoredVersions.some(ignoredVersion => {
          const [ignoredName, ignoredVer] = ignoredVersion.split('@');
          return ignoredName === name && (ignoredVer === toVersion || ignoredVer === '*');
        });
        
        if (versionMatches) {
          const reason = `Version "${name}@${toVersion}" is in ignored list`;
          recordFilterReason(pr.number, reason);
          core.debug(`PR #${pr.number}: Skipping - ${reason}`);
          return false;
        }
        
        // Skip semver check for this dependency if it matches always allow pattern
        if (shouldAlwaysAllow(name, alwaysAllow)) {
          core.debug(`PR #${pr.number}: Bypassing semver filter for "${name}" - matches always-allow pattern`);
          continue;
        }
        
        // Skip the entire PR if any semver change level is not allowed
        if (!semverFilter.includes(semverChange)) {
          const reason = `Semver change "${semverChange}" for "${name}" is not in allowed list: ${semverFilter.join(', ')}`;
          recordFilterReason(pr.number, reason);
          core.debug(`PR #${pr.number}: Skipping - ${reason}`);
          return false;
        }
      }
      
      // If we got here, all dependencies passed all filters
      core.debug(`PR #${pr.number}: All ${pr.dependencyInfoList.length} dependencies passed filters`);
      return true;
    } else {
      // Handle single dependency PR
      const { dependencyInfo } = pr;
      
      // Skip if dependencyInfo is undefined
      if (!dependencyInfo) {
        const reason = 'No dependency info available';
        recordFilterReason(pr.number, reason);
        core.debug(`PR #${pr.number}: Skipping - ${reason}`);
        return false;
      }
      
      const { name, toVersion, semverChange } = dependencyInfo;
      
      // Skip if no dependency info could be extracted
      if (!name || !toVersion || !semverChange) {
        const reason = `Could not extract dependency info from title "${pr.title}"`;
        recordFilterReason(pr.number, reason);
        core.debug(`PR #${pr.number}: Skipping - ${reason}`);
        return false;
      }
      
      // Check if dependency is in ignored list
      if (ignoredDependencies.some(dep => dep === name)) {
        const reason = `Dependency "${name}" is in ignored list`;
        recordFilterReason(pr.number, reason);
        core.debug(`PR #${pr.number}: Skipping - ${reason}`);
        return false;
      }
      
      // Check if specific version is in ignored list
      const versionMatches = ignoredVersions.some(ignoredVersion => {
        const [ignoredName, ignoredVer] = ignoredVersion.split('@');
        return ignoredName === name && (ignoredVer === toVersion || ignoredVer === '*');
      });
      
      if (versionMatches) {
        const reason = `Version "${name}@${toVersion}" is in ignored list`;
        recordFilterReason(pr.number, reason);
        core.debug(`PR #${pr.number}: Skipping - ${reason}`);
        return false;
      }
      
      // Check if dependency should always be allowed
      if (shouldAlwaysAllow(name, alwaysAllow)) {
        core.debug(`PR #${pr.number}: Bypassing semver filter - "${name}" matches always-allow pattern`);
        return true;
      }
      
      // Check semver change level
      if (!semverFilter.includes(semverChange)) {
        const reason = `Semver change "${semverChange}" is not in allowed list: ${semverFilter.join(', ')}`;
        recordFilterReason(pr.number, reason);
        core.debug(`PR #${pr.number}: Skipping - ${reason}`);
        return false;
      }
      
      core.debug(`PR #${pr.number}: Passed all filters - ${name}@${toVersion} (${semverChange} change)`);
      return true;
    }
  });
}

module.exports = {
  applyFilters,
  shouldAlwaysAllow,
  getFilterReasons,
  getAllFilterReasons,
  resetFilterReasons,
  recordFilterReason
};