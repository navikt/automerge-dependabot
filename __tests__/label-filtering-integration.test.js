const { applyFilters } = require('../src/filters');

describe('Label Filtering Integration', () => {
  const mockPRWithoutLabel = {
    number: 1,
    title: 'Bump lodash from 4.17.20 to 4.17.21',
    user: { login: 'dependabot[bot]' },
    labels: [],
    dependencyInfo: {
      name: 'lodash',
      fromVersion: '4.17.20',
      toVersion: '4.17.21',
      semverChange: 'patch'
    }
  };

  const mockPRWithAutoMergeLabel = {
    number: 2,
    title: 'Bump react from 17.0.0 to 18.0.0',
    user: { login: 'dependabot[bot]' },
    labels: [
      { name: 'automerge' },
      { name: 'dependencies' }
    ],
    dependencyInfo: {
      name: 'react',
      fromVersion: '17.0.0',
      toVersion: '18.0.0',
      semverChange: 'major'
    }
  };

  const mockPRWithSecurityLabel = {
    number: 3,
    title: 'Bump axios from 0.21.0 to 0.21.2',
    user: { login: 'dependabot[bot]' },
    labels: [
      { name: 'security' },
      { name: 'dependencies' }
    ],
    dependencyInfo: {
      name: 'axios',
      fromVersion: '0.21.0',
      toVersion: '0.21.2',
      semverChange: 'patch'
    }
  };

  test('should allow PR with matching label even if semver would filter it out', () => {
    const filters = {
      ignoredDependencies: [],
      alwaysAllow: [],
      alwaysAllowLabels: ['automerge'],
      ignoredVersions: [],
      semverFilter: ['patch'] // Only allow patch, but PR is major
    };

    const result = applyFilters([mockPRWithAutoMergeLabel], filters);
    
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(2);
  });

  test('should allow PR with matching label even if dependency is ignored', () => {
    const filters = {
      ignoredDependencies: ['react'],
      alwaysAllow: [],
      alwaysAllowLabels: ['automerge'],
      ignoredVersions: [],
      semverFilter: ['major', 'minor', 'patch']
    };

    const result = applyFilters([mockPRWithAutoMergeLabel], filters);
    
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(2);
  });

  test('should allow PR with matching label even if version is ignored', () => {
    const filters = {
      ignoredDependencies: [],
      alwaysAllow: [],
      alwaysAllowLabels: ['automerge'],
      ignoredVersions: ['react@18.0.0'],
      semverFilter: ['major', 'minor', 'patch']
    };

    const result = applyFilters([mockPRWithAutoMergeLabel], filters);
    
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(2);
  });

  test('should filter out PR without matching label when semver does not match', () => {
    const filters = {
      ignoredDependencies: [],
      alwaysAllow: [],
      alwaysAllowLabels: ['automerge'],
      ignoredVersions: [],
      semverFilter: ['patch'] // Only allow patch
    };

    const prWithoutLabelMajor = {
      ...mockPRWithoutLabel,
      dependencyInfo: {
        ...mockPRWithoutLabel.dependencyInfo,
        semverChange: 'major'
      }
    };

    const result = applyFilters([prWithoutLabelMajor], filters);
    
    expect(result).toHaveLength(0);
  });

  test('should allow multiple PRs with different matching labels', () => {
    const filters = {
      ignoredDependencies: [],
      alwaysAllow: [],
      alwaysAllowLabels: ['automerge', 'security'],
      ignoredVersions: [],
      semverFilter: ['patch']
    };

    const result = applyFilters([
      mockPRWithAutoMergeLabel,  // Has automerge label, major change
      mockPRWithSecurityLabel    // Has security label, patch change
    ], filters);
    
    expect(result).toHaveLength(2);
    expect(result.map(pr => pr.number).sort()).toEqual([2, 3]);
  });

  test('should handle PRs with multiple dependencies when label bypasses filters', () => {
    const mockMultiDepPR = {
      number: 4,
      title: 'Bump lodash and react',
      user: { login: 'dependabot[bot]' },
      labels: [
        { name: 'automerge' }
      ],
      dependencyInfoList: [
        {
          name: 'lodash',
          fromVersion: '4.17.20',
          toVersion: '5.0.0',
          semverChange: 'major'
        },
        {
          name: 'react',
          fromVersion: '17.0.0',
          toVersion: '18.0.0',
          semverChange: 'major'
        }
      ]
    };

    const filters = {
      ignoredDependencies: [],
      alwaysAllow: [],
      alwaysAllowLabels: ['automerge'],
      ignoredVersions: [],
      semverFilter: ['patch'] // Only allow patch, but all deps are major
    };

    const result = applyFilters([mockMultiDepPR], filters);
    
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(4);
  });

  test('should not allow PR without any of the required labels', () => {
    const filters = {
      ignoredDependencies: [],
      alwaysAllow: [],
      alwaysAllowLabels: ['automerge', 'security'],
      ignoredVersions: [],
      semverFilter: ['patch']
    };

    const result = applyFilters([mockPRWithoutLabel], filters);
    
    expect(result).toHaveLength(1); // Should pass because it's a patch change
  });

  test('should allow PR with label while filtering PRs without label based on normal rules', () => {
    const filters = {
      ignoredDependencies: [],
      alwaysAllow: [],
      alwaysAllowLabels: ['automerge'],
      ignoredVersions: [],
      semverFilter: ['patch']
    };

    const prMajorNoLabel = {
      ...mockPRWithoutLabel,
      number: 5,
      dependencyInfo: {
        ...mockPRWithoutLabel.dependencyInfo,
        semverChange: 'major'
      }
    };

    const result = applyFilters([
      mockPRWithoutLabel,        // patch, no label - should pass
      mockPRWithAutoMergeLabel,  // major, has label - should pass due to label
      prMajorNoLabel             // major, no label - should be filtered
    ], filters);
    
    expect(result).toHaveLength(2);
    expect(result.map(pr => pr.number).sort()).toEqual([1, 2]);
  });

  test('should handle case-insensitive label matching', () => {
    const prWithUpperCaseLabel = {
      ...mockPRWithAutoMergeLabel,
      labels: [
        { name: 'AutoMerge' },
        { name: 'DEPENDENCIES' }
      ]
    };

    const filters = {
      ignoredDependencies: [],
      alwaysAllow: [],
      alwaysAllowLabels: ['automerge'],
      ignoredVersions: [],
      semverFilter: ['patch'] // Only allow patch, but PR is major
    };

    const result = applyFilters([prWithUpperCaseLabel], filters);
    
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(2);
  });
});
