const core = require('@actions/core');

/**
 * Apply filters to pull requests
 * 
 * @param {Array} pullRequests - Array of pull requests
 * @param {Object} filters - Filter options
 * @returns {Array} Filtered pull requests
 */
function applyFilters(pullRequests, filters) {
  const { ignoredDependencies, ignoredVersions, semverFilter } = filters;
  
  core.info(`Applying filters: ${
    [
      ignoredDependencies.length > 0 ? `Ignored dependencies: ${ignoredDependencies.join(', ')}` : null,
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
    
    const { dependencyInfo } = pr;
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
    
    // Check semver change level
    if (!semverFilter.includes(semverChange)) {
      core.debug(`PR #${pr.number}: Skipping - Semver change "${semverChange}" is not in allowed list: ${semverFilter.join(', ')}`);
      return false;
    }
    
    core.debug(`PR #${pr.number}: Passed all filters - ${name}@${toVersion} (${semverChange} change)`);
    return true;
  });
}

module.exports = {
  applyFilters
};