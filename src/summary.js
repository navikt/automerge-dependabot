import * as core from '@actions/core';
import { getFilterReasons, shouldAlwaysAllowByLabel } from './filters.js';
import { shouldRunAtCurrentTime } from './timeUtils.js';

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
 * @param {Array} prsToMerge - Array of PRs after filtering that were attempted for merge
 * @param {Set<number>} mergedPRNumbers - Set of PR numbers that were successfully merged
 * @param {Object} filters - Filtering rules that were applied
 * @param {Array} initialPRs - Array of all initial PRs found (including those filtered in basic criteria)
 * @returns {Promise<void>}
 */
async function addWorkflowSummary(allPRs, prsToMerge, mergedPRNumbers, filters, initialPRs = []) {
  try {
    // Start with a header (or two)
    core.summary.addHeading('Dependabot Automerge Summary', 1);
    core.summary.addHeading('Applied Filters', 2);
    
    // Add each table row separately instead of joining them to ensure proper rendering
    core.summary.addRaw('\n'); // Test to see if this helps with rendering
    core.summary.addRaw(createTableHeader(['Filter Type', 'Value']) + '\n');
    core.summary.addRaw(`| Always Allow | ${filters.alwaysAllow.length > 0 ? filters.alwaysAllow.join(', ') : 'None'} |\n`);
    core.summary.addRaw(`| Always Allow Labels | ${filters.alwaysAllowLabels && filters.alwaysAllowLabels.length > 0 ? filters.alwaysAllowLabels.join(', ') : 'None'} |\n`);
    core.summary.addRaw(`| Ignored Versions | ${filters.ignoredVersions.length > 0 ? filters.ignoredVersions.join(', ') : 'None'} |\n`);
    core.summary.addRaw(`| Ignored Dependencies | ${filters.ignoredDependencies.length > 0 ? filters.ignoredDependencies.join(', ') : 'None'} |\n`);
    core.summary.addRaw(`| Semver Filter | ${filters.semverFilter.join(', ')} |\n\n`);

    /*
    * Pull Request Summary
    */
    core.summary.addRaw(createSectionTitle('Pull Request Summary') + '\n\n');
    
    if (allPRs.length === 0 && prsToMerge.length === 0) {
      // Check if it's a blackout period
      const blackoutPeriods = core.getInput('blackout-periods');
      const isInBlackoutPeriod = blackoutPeriods && !shouldRunAtCurrentTime(blackoutPeriods);
      
      let message;
      if (isInBlackoutPeriod) {        message = 'Action is currently in a blackout period. No PRs will be merged during this time.';
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
      const mergedCount = mergedPRNumbers ? mergedPRNumbers.size : prsToMerge.length;
      summaryMessage += `, ${mergedCount} merged.`;
      core.summary.addRaw(summaryMessage + '\n\n');
    }
    
    /*
    * PRs to be Merged — split into merged vs skipped during merge
    */
    if (prsToMerge.length > 0) {
      const hasLabelFiltering = filters.alwaysAllowLabels && filters.alwaysAllowLabels.length > 0;

      const mergedPRs = prsToMerge.filter(pr => mergedPRNumbers && mergedPRNumbers.has(pr.number));
      const skippedDuringMerge = prsToMerge.filter(pr => !mergedPRNumbers || !mergedPRNumbers.has(pr.number));

      const renderPRTable = (prs, title) => {
        if (prs.length === 0) return;
        core.summary.addRaw(createSectionTitle(title) + '\n\n');

        if (hasLabelFiltering) {
          core.summary.addRaw(createTableHeader(['PR', 'Dependency', 'Version', 'Reason']) + '\n');
        } else {
          core.summary.addRaw(createTableHeader(['PR', 'Dependency', 'Version']) + '\n');
        }

        for (const pr of prs) {
          const allowedByLabel = hasLabelFiltering && shouldAlwaysAllowByLabel(pr.labels, filters.alwaysAllowLabels);
          let reason = '';
          if (allowedByLabel && pr.labels) {
            const matchingLabels = pr.labels
              .filter(label => filters.alwaysAllowLabels.some(allowed => allowed.toLowerCase() === label.name.toLowerCase()))
              .map(label => label.name);
            reason = `Allowed by label: ${matchingLabels.join(', ')}`;
          } else if (hasLabelFiltering) {
            reason = 'Passed filters';
          }

          const deps = pr.dependencyInfoList && pr.dependencyInfoList.length > 0
            ? pr.dependencyInfoList.filter(d => d.name)
            : pr.dependencyInfo && pr.dependencyInfo.name ? [pr.dependencyInfo] : null;

          if (deps) {
            for (const depInfo of deps) {
              const tableRow = hasLabelFiltering
                ? `| [#${pr.number}](${pr.html_url}) | ${depInfo.name} | ${depInfo.toVersion} | ${reason} |`
                : `| [#${pr.number}](${pr.html_url}) | ${depInfo.name} | ${depInfo.toVersion} |`;
              core.summary.addRaw(tableRow + '\n');
            }
          } else {
            const tableRow = hasLabelFiltering
              ? `| [#${pr.number}](${pr.html_url}) | Unknown | Unknown | ${reason} |`
              : `| [#${pr.number}](${pr.html_url}) | Unknown | Unknown |`;
            core.summary.addRaw(tableRow + '\n');
          }
        }

        core.summary.addRaw('\n');
      };

      renderPRTable(mergedPRs, 'Merged Pull Requests');

      if (skippedDuringMerge.length > 0) {
        core.summary.addRaw(createSectionTitle('Pull Requests Skipped During Merge') + '\n\n');
        core.summary.addRaw(createTableHeader(['PR', 'Dependency', 'Version', 'Reason']) + '\n');

        for (const pr of skippedDuringMerge) {
          const mergeReasons = getFilterReasons(pr.number);
          const mergeReason = mergeReasons
            ? mergeReasons.filter(r => r.dependency === 'merge').map(r => r.reason).join('; ')
            : 'Unknown reason';

          const deps = pr.dependencyInfoList && pr.dependencyInfoList.length > 0
            ? pr.dependencyInfoList.filter(d => d.name)
            : pr.dependencyInfo && pr.dependencyInfo.name ? [pr.dependencyInfo] : null;

          if (deps) {
            for (const depInfo of deps) {
              core.summary.addRaw(`| [#${pr.number}](${pr.html_url}) | ${depInfo.name} | ${depInfo.toVersion} | ${mergeReason} |\n`);
            }
          } else {
            core.summary.addRaw(`| [#${pr.number}](${pr.html_url}) | Unknown | Unknown | ${mergeReason} |\n`);
          }
        }

        core.summary.addRaw('\n');
      }
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

export {
  addWorkflowSummary
};
