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
 * @param {Array} initialPRs - Array of all initial PRs found (including those filtered in basic criteria)
 * @returns {Promise<void>}
 */
async function addWorkflowSummary(allPRs, prsToMerge, filters, initialPRs = []) {
  try {
    // Import filter functions
    const { getFilterReasons } = require('./filters');
    
    // Start with a header (or two)
    core.summary.addHeading('Dependabot Automerge Summary', 1);
    core.summary.addHeading('Applied Filters', 2);
    
    // Add each table row separately instead of joining them to ensure proper rendering
    core.summary.addRaw('\n'); // Test to see if this helps with rendering
    core.summary.addRaw(createTableHeader(['Filter Type', 'Value']) + '\n');
    core.summary.addRaw(`| Always Allow | ${filters.alwaysAllow.length > 0 ? filters.alwaysAllow.join(', ') : 'None'} |\n`);
    core.summary.addRaw(`| Ignored Versions | ${filters.ignoredVersions.length > 0 ? filters.ignoredVersions.join(', ') : 'None'} |\n`);
    core.summary.addRaw(`| Ignored Dependencies | ${filters.ignoredDependencies.length > 0 ? filters.ignoredDependencies.join(', ') : 'None'} |\n`);
    core.summary.addRaw(`| Semver Filter | ${filters.semverFilter.join(', ')} |\n\n`);

    /*
    * Pull Request Summary
    */
    core.summary.addRaw(createSectionTitle('Pull Request Summary') + '\n\n');
    
    if (allPRs.length === 0 && prsToMerge.length === 0) {
      // Check if it's a blackout period
      const { shouldRunAtCurrentTime } = require('./timeUtils');
      const blackoutPeriods = core.getInput('blackout-periods');
      const isInBlackoutPeriod = blackoutPeriods && !shouldRunAtCurrentTime(blackoutPeriods);
      
      let message;
      if (isInBlackoutPeriod) {
        message = 'Action is currently in a blackout period. No PRs will be merged during this time.';
      } else if (initialPRs.length > 0) {
        message = `Found ${initialPRs.length} open pull request(s), but none met the basic criteria for auto-merging.`;
      } else {
        message = 'No open pull requests found in the repository.';
      }
      
      core.summary.addRaw(message + '\n\n');
    } else {
      let summaryMessage = `Found ${allPRs.length} pull request(s) that met basic criteria`;
      if (initialPRs.length > allPRs.length) {
        summaryMessage += ` (out of ${initialPRs.length} total open PRs)`;
      }
      summaryMessage += `, ${prsToMerge.length} will be merged.`;
      core.summary.addRaw(summaryMessage + '\n\n');
    }
    
    /*
    * PRs to be Merged
    */
    if (prsToMerge.length > 0) {
      core.summary.addRaw(createSectionTitle('Pull Requests to Merge') + '\n\n');
      
      // Add the table header first
      core.summary.addRaw(createTableHeader(['PR', 'Dependency', 'Version']) + '\n');
      
      // Add each PR as a separate row
      for (const pr of prsToMerge) {
        // For PRs that will be merged, we need to extract dependency info directly
        if (pr.dependencyInfoList && pr.dependencyInfoList.length > 0) {
          // Handle multiple dependencies
          for (const depInfo of pr.dependencyInfoList) {
            if (depInfo.name) {
              const tableRow = `| [#${pr.number}](${pr.html_url}) | ${depInfo.name} | ${depInfo.toVersion} |`;
              core.summary.addRaw(tableRow + '\n');
            }
          }
        } else if (pr.dependencyInfo && pr.dependencyInfo.name) {
          // Handle single dependency
          const depInfo = pr.dependencyInfo;
          const tableRow = `| [#${pr.number}](${pr.html_url}) | ${depInfo.name} | ${depInfo.toVersion} |`;
          core.summary.addRaw(tableRow + '\n');
        } else {
          // Fallback if no dependency info is available
          const tableRow = `| [#${pr.number}](${pr.html_url}) | Unknown | Unknown |`;
          core.summary.addRaw(tableRow + '\n');
        }
      }
      
      core.summary.addRaw('\n');
    }
    
    /*
    * Filtered Out Dependencies
    */
    const filteredOutPRs = allPRs.filter(pr => !prsToMerge.includes(pr));
    if (filteredOutPRs.length > 0) {
      core.summary.addRaw(createSectionTitle('Filtered Out Dependencies') + '\n\n');
      
      // Add the table header first
      core.summary.addRaw(createTableHeader(['PR', 'Dependency', 'Version', 'Reason for Filtering']) + '\n');
      
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
              core.summary.addRaw(tableRow + '\n');
            } else {
              // For general reasons, we'll just show "General" as the dependency
              const tableRow = `| [#${pr.number}](${pr.html_url}) | General | - | ${data.reason} |`;
              core.summary.addRaw(tableRow + '\n');
            }
          }
        } else {
          // Fallback if no filter data is available
          const tableRow = `| [#${pr.number}](${pr.html_url}) | Unknown | - | No specific reason recorded |`;
          core.summary.addRaw(tableRow + '\n');
        }
      }
      
      core.summary.addRaw('\n');
    }
    
    /*
    * PRs Filtered Out During Basic Criteria
    */
    if (initialPRs.length > allPRs.length) {
      // Show PRs that were filtered out during basic criteria phase
      const basicCriteriaFiltered = initialPRs.filter(pr => 
        !allPRs.some(eligible => eligible.number === pr.number)
      );
      
      core.summary.addRaw(createSectionTitle('Pull Requests Filtered Out (Basic Criteria)') + '\n\n');
      
      // Add the table header first
      core.summary.addRaw(createTableHeader(['PR', 'Title', 'Reason for Filtering']) + '\n');
      
      for (const pr of basicCriteriaFiltered) {
        // Get the filter data for this PR
        const filterData = getFilterReasons(pr.number);
        
        if (filterData && filterData.length > 0) {
          // Show the first/main reason for filtering
          const mainReason = filterData[0];
          const tableRow = `| [#${pr.number}](${pr.html_url}) | ${pr.title} | ${mainReason.reason} |`;
          core.summary.addRaw(tableRow + '\n');
        } else {
          // Fallback if no filter data is available
          const tableRow = `| [#${pr.number}](${pr.html_url}) | ${pr.title} | No specific reason recorded |`;
          core.summary.addRaw(tableRow + '\n');
        }
      }
      
      core.summary.addRaw('\n');
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
