const core = require('@actions/core');

/**
 * Creates a summary section title
 * 
 * @param {string} title - The title for the section
 * @returns {string} Markdown formatted section title
 */
function createSectionTitle(title) {
  return `## ${title}`;
}

/**
 * Creates a summary table header with specified columns
 * 
 * @param {Array<string>} columns - Array of column names
 * @returns {string} Markdown formatted table header
 */
function createTableHeader(columns) {
  return [
    '| ' + columns.join(' | ') + ' |',
    '| ' + columns.map(() => '---').join(' | ') + ' |'
  ].join('\n');
}

/**
 * Adds PR information to the workflow summary
 * 
 * @param {Array} allPRs - Array of all PRs retrieved from GitHub before filtering
 * @param {Array} prsToMerge - Array of PRs after filtering that will be merged
 * @param {Object} filters - Filtering rules that were applied
 * @returns {Promise<void>}
 */
async function addWorkflowSummary(allPRs, prsToMerge, filters) {
  try {
    // Import filter functions
    const { getFilterReasons } = require('./filters');
    
    // Start with a header
    core.summary.addHeading('Dependabot Automerge Summary');
    
    // Add filter information
    const filterTable = [
        createTableHeader(['Filter Type', 'Value'])
      ];
    filterTable.push(`| Always Allow | ${filters.alwaysAllow.length > 0 ? filters.alwaysAllow.join(', ') : 'None'} |`);
    filterTable.push(`| Ignored Versions | ${filters.ignoredVersions.length > 0 ? filters.ignoredVersions.join(', ') : 'None'} |`);
    filterTable.push(`| Ignored Dependencies | ${filters.ignoredDependencies.length > 0 ? filters.ignoredDependencies.join(', ') : 'None'} |`);
    filterTable.push(`| Semver Filter | ${filters.semverFilter.join(', ')} |`);

    core.summary.addRaw(filterTable + '\n\n');

    /*
    * Pull Request Summary
    */
    core.summary.addRaw(createSectionTitle('Pull Request Summary') + '\n\n');
    
    if (allPRs.length === 0 && prsToMerge.length === 0) {
      // Check if it's a blackout period
      const { shouldRunAtCurrentTime } = require('./timeUtils');
      const blackoutPeriods = core.getInput('blackout-periods');
      const isInBlackoutPeriod = blackoutPeriods && !shouldRunAtCurrentTime(blackoutPeriods);
      
      let message = 'No pull requests found that meet basic criteria.';
      if (isInBlackoutPeriod) {
        message = 'Action is currently in a blackout period. No PRs will be merged during this time.';
      }
      
      core.summary.addRaw(message + '\n\n');
    } else {
      core.summary.addRaw(`Found ${allPRs.length} pull request(s), ${prsToMerge.length} will be merged.\n\n`);
    }
    
    /*
    * PRs to be Merged
    */
    if (prsToMerge.length > 0) {
      core.summary.addRaw(createSectionTitle('Pull Requests to Merge') + '\n\n');
      
      const prsToBeMergedTable = [
        createTableHeader(['PR', 'Dependency', 'Version'])
      ];
      
      for (const pr of prsToMerge) {
        // For PRs that will be merged, we need to extract dependency info directly
        if (pr.dependencyInfoList && pr.dependencyInfoList.length > 0) {
          // Handle multiple dependencies
          for (const depInfo of pr.dependencyInfoList) {
            if (depInfo.name) {
              const tableRow = `| [#${pr.number}](${pr.html_url}) | ${depInfo.name} | ${depInfo.toVersion} |`;
              prsToBeMergedTable.push(tableRow);
            }
          }
        } else if (pr.dependencyInfo && pr.dependencyInfo.name) {
          // Handle single dependency
          const depInfo = pr.dependencyInfo;
          const tableRow = `| [#${pr.number}](${pr.html_url}) | ${depInfo.name} | ${depInfo.toVersion} |`;
          prsToBeMergedTable.push(tableRow);
        } else {
          // Fallback if no dependency info is available
          const tableRow = `| [#${pr.number}](${pr.html_url}) | Unknown | Unknown |`;
          prsToBeMergedTable.push(tableRow);
        }
      }
      
      core.summary.addRaw(prsToBeMergedTable.join('\n') + '\n\n');
    }
    
    /*
    * Filtered Out Dependencies
    */
    const filteredOutPRs = allPRs.filter(pr => !prsToMerge.includes(pr));
    if (filteredOutPRs.length > 0) {
      core.summary.addRaw(createSectionTitle('Filtered Out Dependencies') + '\n\n');
      
      const filteredOutTable = [
        createTableHeader(['PR', 'Dependency', 'Version', 'Reason for Filtering'])
      ];
      
      for (const pr of filteredOutPRs) {
        // Get the filter data for this PR
        const filterData = getFilterReasons(pr.number);
        
        if (filterData && filterData.length > 0) {
          // Show reasons for each dependency that was filtered
          for (const data of filterData) {
            const dependency = data.dependency;
            let version = '';
            
            // Try to find version information for this dependency
            if (pr.dependencyInfoList) {
              const depInfo = pr.dependencyInfoList.find(info => info.name === dependency);
              if (depInfo && depInfo.toVersion) {
                version = depInfo.toVersion;
              }
            } else if (pr.dependencyInfo && pr.dependencyInfo.name === dependency) {
              version = pr.dependencyInfo.toVersion;
            }
            
            // Skip generic reasons if they aren't for a specific dependency
            if (dependency !== 'general') {
              const tableRow = `| [#${pr.number}](${pr.html_url}) | ${dependency} | ${version} | ${data.reason} |`;
              filteredOutTable.push(tableRow);
            } else {
              // For general reasons, we'll just show "General" as the dependency
              const tableRow = `| [#${pr.number}](${pr.html_url}) | General | - | ${data.reason} |`;
              filteredOutTable.push(tableRow);
            }
          }
        } else {
          // Fallback if no filter data is available
          const tableRow = `| [#${pr.number}](${pr.html_url}) | Unknown | - | No specific reason recorded |`;
          filteredOutTable.push(tableRow);
        }
      }
      
      core.summary.addRaw(filteredOutTable.join('\n') + '\n\n');
    }
    
    // Write the summary to the workflow
    await core.summary.write();
    core.info('Added workflow summary with dependency decisions and PR information');
  } catch (error) {
    core.warning(`Failed to add workflow summary: ${error.message}`);
    return null;
  }
}

module.exports = {
  addWorkflowSummary
};
