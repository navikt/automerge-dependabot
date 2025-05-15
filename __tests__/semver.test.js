const { extractDependencyInfo } = require('../src/pullRequests');

describe('Semver Handling', () => {
  test('should handle simple version formats correctly', () => {
    const title = 'Bump lodash from 4.17.20 to 4.17.21';
    const result = extractDependencyInfo(title);
    
    expect(result.name).toBe('lodash');
    expect(result.fromVersion).toBe('4.17.20');
    expect(result.toVersion).toBe('4.17.21');
    expect(result.semverChange).toBe('patch');
  });
  
  test('should handle complex version formats correctly', () => {
    const title = 'Bump express from 4.17.1-beta.0 to 4.18.0-rc.1';
    const result = extractDependencyInfo(title);
    
    expect(result.name).toBe('express');
    expect(result.fromVersion).toBe('4.17.1-beta.0');
    expect(result.toVersion).toBe('4.18.0-rc.1');
    expect(result.semverChange).toBe('minor');
  });
  
  test('should handle versions with build metadata', () => {
    const title = 'Bump webpack from 5.70.0+20220324 to 5.71.0+20220330';
    const result = extractDependencyInfo(title);
    
    expect(result.name).toBe('webpack');
    expect(result.fromVersion).toBe('5.70.0+20220324');
    expect(result.toVersion).toBe('5.71.0+20220330');
    expect(result.semverChange).toBe('minor');
  });
  
  test('should handle major version changes correctly', () => {
    const title = 'Bump react from 17.0.2 to 18.0.0';
    const result = extractDependencyInfo(title);
    
    expect(result.name).toBe('react');
    expect(result.fromVersion).toBe('17.0.2');
    expect(result.toVersion).toBe('18.0.0');
    expect(result.semverChange).toBe('major');
  });
  
  test('should fallback to unknown for unparseable versions', () => {
    const title = 'Bump custom-pkg from unknown to latest';
    const result = extractDependencyInfo(title);
    
    expect(result.name).toBe('custom-pkg');
    expect(result.fromVersion).toBe('unknown');
    expect(result.toVersion).toBe('latest');
    expect(result.semverChange).toBe('unknown');
  });
});
