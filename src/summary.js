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
    columns.join(' | '),
    columns.map(() => '---').join(' | ')
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
      createTableHeader(['Filter Type', 'Value']),
      `Ignored Dependencies | ${filters.ignoredDependencies.length > 0 ? filters.ignoredDependencies.join(', ') : 'None'}`,
      `Always Allow | ${filters.alwaysAllow.length > 0 ? filters.alwaysAllow.join(', ') : 'None'}`,
      `Ignored Versions | ${filters.ignoredVersions.length > 0 ? filters.ignoredVersions.join(', ') : 'None'}`,
      `Semver Filter | ${filters.semverFilter.join(', ')}`
    ].join('\n');

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
    if (allPRs.length > 0) {
      core.summary.addRaw(createSectionTitle('Pull Requests Overview') + '\n\n');
      
      const prsToBeMergedTable = [
        createTableHeader(['PR', 'Dependency', 'Status'])
      ];
      
      for (const pr of allPRs) {
        const willBeMerged = prsToMerge.includes(pr);
        // Skip this PR if it is not ready to be merged
        if (!willBeMerged) {
          continue;
        }
        const status = '✅ Will merge';
        
        // Get filter reasons which contain dependency info
        const filterData = getFilterReasons(pr.number);
        
        if (filterData && filterData.length > 0) {
          // Show a row for each dependency associated with this PR
          for (const data of filterData) {
            if (data.dependency !== 'general') {
              const tableRow = `[#${pr.number}](${pr.html_url}) | ${data.dependency} | ${status}`;
              prsToBeMergedTable.push(tableRow);
            }
          }
        }
      }
      
      core.summary.addRaw(prsToBeMergedTable.join('\n') + '\n\n');
    }
    
    /*
    * Filtered Out PRs
    */
    const filteredOutPRs = allPRs.filter(pr => !prsToMerge.includes(pr));
    if (filteredOutPRs.length > 0) {
      core.summary.addRaw(createSectionTitle('Filtered Out PRs') + '\n\n');
      
      const filteredOutTable = [
        createTableHeader(['PR', 'Dependency', 'Reason'])
      ];
      
      for (const pr of filteredOutPRs) {
        // Get the filter data for this PR
        const filterData = getFilterReasons(pr.number);
        
        if (filterData && filterData.length > 0) {
          // Show reasons for each dependency that was filtered
          for (const data of filterData) {
            const dependency = data.dependency;
            // Skip generic reasons if they aren't for a specific dependency
            if (dependency !== 'general') {
              const tableRow = `[#${pr.number}](${pr.html_url}) | ${dependency} | ❌ ${data.reason}`;
              filteredOutTable.push(tableRow);
            } else {
              // For general reasons, we'll just show "General" as the dependency
              const tableRow = `[#${pr.number}](${pr.html_url}) | General | ❌ ${data.reason}`;
              filteredOutTable.push(tableRow);
            }
          }
        } else {
          // Fallback if no filter data is available
          const tableRow = `[#${pr.number}](${pr.html_url}) | Unknown | ❌ No specific reason recorded`;
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
