#!/usr/bin/env node

/**
 * Test script to demonstrate the GitHub summary output for the user's scenario:
 * 7 initial PRs, 1 passes basic criteria, 6 filtered out during basic criteria
 */

// Mock the GitHub Actions core module
const mockSummary = {
  addHeading: (text, level) => {
    console.log(`${'#'.repeat(level)} ${text}`);
    return mockSummary;
  },
  addRaw: (text) => {
    console.log(text);
    return mockSummary;
  },
  write: async () => {
    console.log('\n--- Summary Written to GitHub ---\n');
  }
};

// Mock the core module
jest.doMock('@actions/core', () => ({
  info: console.log,
  debug: () => {}, // Suppress debug messages
  warning: console.warn,
  summary: mockSummary,
  getInput: (name) => name === 'blackout-periods' ? '' : ''
}));

// Mock the filters module with our test data
jest.doMock('./src/filters', () => ({
  getFilterReasons: (prNumber) => {
    const basicCriteriaReasons = {
      11: [{ dependency: 'general', reason: 'Not in mergeable state' }],
      12: [{ dependency: 'general', reason: 'Has failing status checks' }],
      13: [{ dependency: 'general', reason: 'Too recent (created 2 hours ago, needs to be at least 2 days old)' }],
      14: [{ dependency: 'general', reason: 'Has blocking reviews' }],
      15: [{ dependency: 'general', reason: 'Could not determine mergeable state after retries' }],
      16: [{ dependency: 'general', reason: 'Contains commits from authors other than Dependabot (security risk)' }]
    };
    return basicCriteriaReasons[prNumber] || null;
  }
}));

// Mock the timeUtils module
jest.doMock('./src/timeUtils', () => ({
  shouldRunAtCurrentTime: () => true
}));

// Import after mocking
const { addWorkflowSummary } = require('./src/summary');

async function demonstrateScenario() {
  console.log('🔍 Demonstrating User Scenario: 7 initial PRs, 1 passes basic criteria\n');
  
  // 7 initial PRs found
  const initialPRs = [
    { number: 10, html_url: 'https://github.com/owner/repo/pull/10', title: 'Bump lodash from 4.17.20 to 4.17.21' },
    { number: 11, html_url: 'https://github.com/owner/repo/pull/11', title: 'Bump react from 17.0.1 to 18.0.0' },
    { number: 12, html_url: 'https://github.com/owner/repo/pull/12', title: 'Bump axios from 0.21.1 to 0.21.4' },
    { number: 13, html_url: 'https://github.com/owner/repo/pull/13', title: 'Bump express from 4.17.1 to 4.17.2' },
    { number: 14, html_url: 'https://github.com/owner/repo/pull/14', title: 'Bump webpack from 5.0.0 to 5.1.0' },
    { number: 15, html_url: 'https://github.com/owner/repo/pull/15', title: 'Bump jest from 26.0.0 to 27.0.0' },
    { number: 16, html_url: 'https://github.com/owner/repo/pull/16', title: 'Bump eslint from 7.0.0 to 8.0.0' }
  ];

  // Only 1 PR passed basic criteria
  const allPRs = [
    {
      number: 10,
      html_url: 'https://github.com/owner/repo/pull/10',
      dependencyInfo: { 
        name: 'lodash', 
        fromVersion: '4.17.20', 
        toVersion: '4.17.21', 
        semverChange: 'patch' 
      }
    }
  ];

  // And that 1 PR will be merged
  const prsToMerge = [allPRs[0]];

  const filters = {
    ignoredDependencies: [],
    alwaysAllow: [],
    ignoredVersions: [],
    semverFilter: ['patch', 'minor']
  };

  console.log('📊 GitHub Workflow Summary Output:\n');
  console.log('========================================\n');
  
  await addWorkflowSummary(allPRs, prsToMerge, filters, initialPRs);
  
  console.log('========================================\n');
  console.log('✅ This demonstrates that the GitHub summary now shows:');
  console.log('   • The overall PR count (1 out of 7 total)');
  console.log('   • The "Pull Requests Filtered Out (Basic Criteria)" section');
  console.log('   • Specific reasons why each of the 6 PRs were filtered out');
}

if (require.main === module) {
  demonstrateScenario().catch(console.error);
}
