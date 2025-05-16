const core = require('@actions/core');

/**
 * Store filtering data with relationships between dependencies and PRs
 * 
 * Structure:
 * {
 *   dependencies: Map<String, Set<Number>>, // Maps dependency name to set of PR numbers
 *   prReasons: Map<Number, Array<{dependency: String, reason: String}>> // Maps PR to dependency-specific reasons
 * }
 */
const filteringData = {
  dependencies: new Map(),
  prReasons: new Map()
};

/**
 * Record a filtering reason for a PR and specific dependency
 * 
 * @param {number} prNumber - The pull request number
 * @param {string} dependency - The dependency name
 * @param {string} reason - The reason for filtering
 */
function recordFilterReason(prNumber, dependency, reason) {
  // Track dependency to PR relationship
  if (!filteringData.dependencies.has(dependency)) {
    filteringData.dependencies.set(dependency, new Set());
  }
  filteringData.dependencies.get(dependency).add(prNumber);
  
  // Track PR to reasons relationship
  if (!filteringData.prReasons.has(prNumber)) {
    filteringData.prReasons.set(prNumber, []);
  }
  
  filteringData.prReasons.get(prNumber).push({
    dependency,
    reason
  });
}

/**
 * Get filtering reasons for a PR
 * 
 * @param {number} prNumber - The pull request number
 * @returns {Array|null} Array of objects with dependency name and reason, or null if not found
 */
function getFilterReasons(prNumber) {
  return filteringData.prReasons.has(prNumber) ? filteringData.prReasons.get(prNumber) : null;
}

/**
 * Get all filter reasons
 * 
 * @returns {Map} Map of PR numbers to filter reasons
 */
function getAllFilterReasons() {
  return filteringData.prReasons;
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
 * Validate a single dependency against the filters
 * 
 * @param {number} prNumber - The pull request number
 * @param {Object} dependencyInfo - The dependency information
 * @param {Object} filters - The filter settings
 * @returns {boolean} Whether the dependency passes all filters
 */
function validateDependency(prNumber, dependencyInfo, filters) {
  const { ignoredDependencies, alwaysAllow = [], ignoredVersions, semverFilter } = filters;
  const { name, toVersion, semverChange } = dependencyInfo || {};
  
  // Check if dependency info is complete
  if (!name || !toVersion || !semverChange) {
    const reason = 'Dependency missing required information';
    recordFilterReason(prNumber, name || 'general', reason);
    core.debug(`PR #${prNumber}: Dependency validation failed - ${reason}`);
    return false;
  }
  
  // Check if dependency is in ignored list
  if (ignoredDependencies.some(dep => dep === name)) {
    const reason = `Dependency "${name}" is in ignored list`;
    recordFilterReason(prNumber, name, reason);
    core.debug(`PR #${prNumber}: Dependency validation failed - ${reason}`);
    return false;
  }
  
  // Check if specific version is in ignored list
  const versionMatches = ignoredVersions.some(ignoredVersion => {
    // Split the ignored entry into name and version parts
    const [ignoredName, ignoredVer] = ignoredVersion.split('@');
    
    // Check if the name matches and either:
    // 1. The version matches exactly
    // 2. The ignored version is a wildcard '*'
    // 3. The version part is undefined meaning ignore all versions
    return (
      ignoredName === name && 
      (ignoredVer === toVersion || ignoredVer === '*' || ignoredVer === undefined)
    );
  });
  
  if (versionMatches) {
    const reason = `Version "${name}@${toVersion}" is in ignored list`;
    recordFilterReason(prNumber, name, reason);
    core.debug(`PR #${prNumber}: Dependency validation failed - ${reason}`);
    return false;
  }
  
  // Check if dependency should always be allowed
  if (shouldAlwaysAllow(name, alwaysAllow)) {
    core.debug(`PR #${prNumber}: Bypassing semver filter for "${name}" - matches always-allow pattern`);
    return true;
  }
  
  // Check semver change level
  if (!semverFilter.includes(semverChange)) {
    const reason = `Semver change "${semverChange}" for "${name}" is not in allowed list: ${semverFilter.join(', ')}`;
    recordFilterReason(prNumber, name, reason);
    core.debug(`PR #${prNumber}: Dependency validation failed - ${reason}`);
    return false;
  }
  
  // Passed all checks
  return true;
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
      recordFilterReason(pr.number, 'general', reason);
      core.debug(`PR #${pr.number}: Skipping - ${reason}`);
      return false;
    }
    
    // Check if PR contains multiple dependencies or a single dependency
    if (pr.dependencyInfoList && pr.dependencyInfoList.length > 0) {
      // For PRs with multiple dependencies, ALL dependencies must pass the filters
      for (const dependencyInfo of pr.dependencyInfoList) {
        const isValid = validateDependency(pr.number, dependencyInfo, filters);
        if (!isValid) {
          // If any dependency fails validation, filter out the entire PR
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
        recordFilterReason(pr.number, 'general', reason);
        core.debug(`PR #${pr.number}: Skipping - ${reason}`);
        return false;
      }
      
      const isValid = validateDependency(pr.number, dependencyInfo, filters);
      if (!isValid) {
        return false;
      }
      
      const { name, toVersion, semverChange } = dependencyInfo;
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
  recordFilterReason,
  validateDependency
};