const core = require('@actions/core');

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
      core.debug(`PR #${pr.number}: Skipping - Not created by Dependabot (creator: ${pr.user?.login || 'unknown'})`);
      return false;
    }
    
    // Check if PR contains multiple dependencies or a single dependency
    if (pr.dependencyInfoList && pr.dependencyInfoList.length > 0) {
      // For PRs with multiple dependencies, ALL dependencies must pass the filters
      for (const dependencyInfo of pr.dependencyInfoList) {
        const { name, toVersion, semverChange } = dependencyInfo || {};
        
        // Skip the entire PR if any dependency info is incomplete
        if (!name || !toVersion || !semverChange) {
          core.debug(`PR #${pr.number}: Skipping - Dependency missing info in multiple dependency PR`);
          return false;
        }
        
        // Skip the entire PR if any dependency is in the ignored list
        if (ignoredDependencies.some(dep => dep === name)) {
          core.debug(`PR #${pr.number}: Skipping - Dependency "${name}" is in ignored list`);
          return false;
        }
        
        // Skip the entire PR if any version is in the ignored list
        const versionMatches = ignoredVersions.some(ignoredVersion => {
          const [ignoredName, ignoredVer] = ignoredVersion.split('@');
          return ignoredName === name && (ignoredVer === toVersion || ignoredVer === '*');
        });
        
        if (versionMatches) {
          core.debug(`PR #${pr.number}: Skipping - Version "${name}@${toVersion}" is in ignored list`);
          return false;
        }
        
        // Skip semver check for this dependency if it matches always allow pattern
        if (shouldAlwaysAllow(name, alwaysAllow)) {
          core.debug(`PR #${pr.number}: Bypassing semver filter for "${name}" - matches always-allow pattern`);
          continue;
        }
        
        // Skip the entire PR if any semver change level is not allowed
        if (!semverFilter.includes(semverChange)) {
          core.debug(`PR #${pr.number}: Skipping - Semver change "${semverChange}" for "${name}" is not in allowed list: ${semverFilter.join(', ')}`);
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
        core.debug(`PR #${pr.number}: Skipping - No dependency info available`);
        return false;
      }
      
      const { name, toVersion, semverChange } = dependencyInfo;
      
      // Skip if no dependency info could be extracted
      if (!name || !toVersion || !semverChange) {
        core.debug(`PR #${pr.number}: Skipping - Could not extract dependency info from title "${pr.title}"`);
        return false;
      }
      
      // Check if dependency is in ignored list
      if (ignoredDependencies.some(dep => dep === name)) {
        core.debug(`PR #${pr.number}: Skipping - Dependency "${name}" is in ignored list`);
        return false;
      }
      
      // Check if specific version is in ignored list
      const versionMatches = ignoredVersions.some(ignoredVersion => {
        const [ignoredName, ignoredVer] = ignoredVersion.split('@');
        return ignoredName === name && (ignoredVer === toVersion || ignoredVer === '*');
      });
      
      if (versionMatches) {
        core.debug(`PR #${pr.number}: Skipping - Version "${name}@${toVersion}" is in ignored list`);
        return false;
      }
      
      // Check if dependency should always be allowed
      if (shouldAlwaysAllow(name, alwaysAllow)) {
        core.debug(`PR #${pr.number}: Bypassing semver filter - "${name}" matches always-allow pattern`);
        return true;
      }
      
      // Check semver change level
      if (!semverFilter.includes(semverChange)) {
        core.debug(`PR #${pr.number}: Skipping - Semver change "${semverChange}" is not in allowed list: ${semverFilter.join(', ')}`);
        return false;
      }
      
      core.debug(`PR #${pr.number}: Passed all filters - ${name}@${toVersion} (${semverChange} change)`);
      return true;
    }
  });
}

module.exports = {
  applyFilters,
  shouldAlwaysAllow
};