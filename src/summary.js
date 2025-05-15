const core = require('@actions/core');

// For testing purposes - will store summary content when in test mode
let summaryContent = null;

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
 * @param {Array} eligiblePRs - Array of eligible PRs before filtering
 * @param {Array} filteredPRs - Array of PRs after filtering that will be merged
 * @param {Object} filters - Filtering rules that were applied
 * @returns {Promise<void>}
 */
async function addWorkflowSummary(eligiblePRs, filteredPRs, filters) {
  try {
    // Reset summary content for testing
    summaryContent = '';
    
    // Collection of summary sections for testing
    const summaryParts = {
      title: 'Dependabot Automerge Summary',
      filters: {},
      prCount: { eligible: eligiblePRs.length, toMerge: filteredPRs.length },
      prsToMerge: [],
      prsFilteredOut: []
    };
    
    // Start with a header
    await core.summary.addHeading('Dependabot Automerge Summary');
    summaryContent += '# Dependabot Automerge Summary\n\n';
    
    // Add filter info
    await core.summary.addRaw(createSectionTitle('Applied Filters') + '\n\n');
    summaryContent += `${createSectionTitle('Applied Filters')}\n\n`;
    
    const filterTable = [
      createTableHeader(['Filter Type', 'Value']),
      `Ignored Dependencies | ${filters.ignoredDependencies.length > 0 ? filters.ignoredDependencies.join(', ') : 'None'}`,
      `Always Allow | ${filters.alwaysAllow.length > 0 ? filters.alwaysAllow.join(', ') : 'None'}`,
      `Ignored Versions | ${filters.ignoredVersions.length > 0 ? filters.ignoredVersions.join(', ') : 'None'}`,
      `Semver Filter | ${filters.semverFilter.join(', ')}`
    ].join('\n');

    await core.summary.addRaw(filterTable + '\n\n');
    summaryContent += `${filterTable}\n\n`;
    
    // Add to summary parts for testing
    summaryParts.filters = {
      ignoredDependencies: filters.ignoredDependencies.length > 0 ? filters.ignoredDependencies.join(', ') : 'None',
      alwaysAllow: filters.alwaysAllow.length > 0 ? filters.alwaysAllow.join(', ') : 'None',
      ignoredVersions: filters.ignoredVersions.length > 0 ? filters.ignoredVersions.join(', ') : 'None',
      semverFilter: filters.semverFilter.join(', ')
    };
    
    // Add PR summary
    await core.summary.addRaw(createSectionTitle('Pull Request Summary') + '\n\n');
    summaryContent += `${createSectionTitle('Pull Request Summary')}\n\n`;
    
    if (eligiblePRs.length === 0) {
      const noPRsMessage = 'No eligible PRs found.';
      
      await core.summary.addRaw(noPRsMessage + '\n\n');
      summaryContent += `${noPRsMessage}\n\n`;
    } else {
      await core.summary.addRaw(`Found ${eligiblePRs.length} eligible PR(s), ${filteredPRs.length} will be merged.\n\n`);
      summaryContent += `Found ${eligiblePRs.length} eligible PR(s), ${filteredPRs.length} will be merged.\n\n`;
    }
    
    // Add PR details for filtered PRs
    if (filteredPRs.length > 0) {
      await core.summary.addRaw(createSectionTitle('PRs to Merge') + '\n\n');
      summaryContent += `${createSectionTitle('PRs to Merge')}\n\n`;
      
      const prTable = [
        createTableHeader(['PR', 'Dependency', 'From → To', 'Change Level', 'Status'])
      ];
      
      for (const pr of filteredPRs) {
        // Handle both single dependency and multiple dependency PRs
        if (pr.dependencyInfoList && pr.dependencyInfoList.length > 0) {
          // Multiple dependencies
          for (const depInfo of pr.dependencyInfoList) {
            const tableRow = `[#${pr.number}](${pr.html_url}) | ${depInfo.name} | ${depInfo.fromVersion} → ${depInfo.toVersion} | ${depInfo.semverChange} | ✅ Will merge`;
            prTable.push(tableRow);
            
            // Add to summary parts for testing
            summaryParts.prsToMerge.push({
              prNumber: pr.number,
              dependency: depInfo.name,
              fromVersion: depInfo.fromVersion,
              toVersion: depInfo.toVersion,
              semverChange: depInfo.semverChange
            });
          }
        } else if (pr.dependencyInfo) {
          // Single dependency
          const { name, fromVersion, toVersion, semverChange } = pr.dependencyInfo;
          const tableRow = `[#${pr.number}](${pr.html_url}) | ${name} | ${fromVersion} → ${toVersion} | ${semverChange} | ✅ Will merge`;
          prTable.push(tableRow);
          
          // Add to summary parts for testing
          summaryParts.prsToMerge.push({
            prNumber: pr.number,
            dependency: name,
            fromVersion,
            toVersion,
            semverChange
          });
        }
      }
      
      await core.summary.addRaw(prTable.join('\n') + '\n\n');
      summaryContent += `${prTable.join('\n')}\n\n`;
    }
    
    // Add info about PRs that were filtered out
    const filteredOutPRs = eligiblePRs.filter(pr => !filteredPRs.includes(pr));
    if (filteredOutPRs.length > 0) {
      await core.summary.addRaw(createSectionTitle('PRs Filtered Out') + '\n\n');
      summaryContent += `${createSectionTitle('PRs Filtered Out')}\n\n`;
      
      const filteredOutTable = [
        createTableHeader(['PR', 'Dependency', 'From → To', 'Change Level', 'Reason'])
      ];
      
      for (const pr of filteredOutPRs) {
        // Get specific filtering reason from our tracking
        const { getFilterReasons } = require('./filters');
        
        // Handle both single dependency and multiple dependency PRs
        if (pr.dependencyInfoList && pr.dependencyInfoList.length > 0) {
          // Multiple dependencies
          for (const depInfo of pr.dependencyInfoList) {
            // Get the specific reason from our tracking, or use a default
            const filterData = getFilterReasons(pr.number);
            let reason = 'Does not match filter criteria';
            
            if (filterData && filterData.reasons && filterData.reasons.length > 0) {
              // Use the first recorded reason
              reason = filterData.reasons[0];
            } else {
              // Fallback checks if no tracked reason (shouldn't happen normally)
              if (filters.ignoredDependencies.includes(depInfo.name)) {
                reason = 'Ignored dependency';
              } else if (!filters.semverFilter.includes(depInfo.semverChange)) {
                reason = `Semver change '${depInfo.semverChange}' not allowed`;
              }
            }
            
            const tableRow = `[#${pr.number}](${pr.html_url}) | ${depInfo.name} | ${depInfo.fromVersion} → ${depInfo.toVersion} | ${depInfo.semverChange} | ❌ ${reason}`;
            filteredOutTable.push(tableRow);
            
            // Add to summary parts for testing
            summaryParts.prsFilteredOut.push({
              prNumber: pr.number,
              dependency: depInfo.name,
              fromVersion: depInfo.fromVersion,
              toVersion: depInfo.toVersion,
              semverChange: depInfo.semverChange,
              reason
            });
          }
        } else if (pr.dependencyInfo) {
          // Single dependency
          const { name, fromVersion, toVersion, semverChange } = pr.dependencyInfo;
          
          // Get the specific reason from our tracking, or use a default
          const filterData = getFilterReasons(pr.number);
          let reason = 'Does not match filter criteria';
          
          if (filterData && filterData.reasons && filterData.reasons.length > 0) {
            // Use the first recorded reason
            reason = filterData.reasons[0];
          } else {
            // Fallback checks if no tracked reason
            if (filters.ignoredDependencies.includes(name)) {
              reason = 'Ignored dependency';
            } else if (!filters.semverFilter.includes(semverChange)) {
              reason = `Semver change '${semverChange}' not allowed`;
            }
          }
          
          const tableRow = `[#${pr.number}](${pr.html_url}) | ${name} | ${fromVersion} → ${toVersion} | ${semverChange} | ❌ ${reason}`;
          filteredOutTable.push(tableRow);
          
          // Add to summary parts for testing
          summaryParts.prsFilteredOut.push({
            prNumber: pr.number,
            dependency: name,
            fromVersion,
            toVersion,
            semverChange,
            reason
          });
        }
      }
      
      await core.summary.addRaw(filteredOutTable.join('\n') + '\n\n');
      summaryContent += `${filteredOutTable.join('\n')}\n\n`;
    }
    
    // Write the summary to the workflow
    await core.summary.write();
    core.info('Added workflow summary with dependency decisions and PR information');
    
    // Return summary parts for testing
    return summaryParts;
  } catch (error) {
    core.warning(`Failed to add workflow summary: ${error.message}`);
    return null;
  }
}

/**
 * Get the current summary content (for testing)
 * 
 * @returns {string} The current summary content
 */
function getSummaryContent() {
  return summaryContent;
}

module.exports = {
  addWorkflowSummary,
  getSummaryContent
};
