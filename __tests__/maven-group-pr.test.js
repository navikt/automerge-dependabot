const fs = require('fs');
const path = require('path');
const { extractMultipleDependencyInfo } = require('../src/pullRequests');

describe('Maven Group PR Dependency Extraction', () => {
  let pr13Title;
  let pr13Body;

  beforeAll(() => {
    // Read PR #13 (Maven group PR) test data
    const pr13Path = path.resolve(__dirname, 'data/pr13.md');
    pr13Body = fs.readFileSync(pr13Path, 'utf8');
    pr13Title = "Bumps the maven group in /app with 3 updates";
  });

  test('should extract all dependencies from Maven group PR', () => {
    const dependencies = extractMultipleDependencyInfo(pr13Title, pr13Body);
    
    // Verify we found 3 dependencies
    expect(dependencies).toHaveLength(3);
    
    // Check first dependency
    expect(dependencies[0]).toEqual({
      name: 'org.springframework.boot:spring-boot-starter-web',
      fromVersion: '2.8.0',
      toVersion: '3.4.5',
      semverChange: 'major'
    });
    
    // Check second dependency
    expect(dependencies[1]).toEqual({
      name: 'org.springframework.boot:spring-boot-starter-test',
      fromVersion: '3.4.0',
      toVersion: '3.4.5',
      semverChange: 'patch'
    });
    
    // Check third dependency
    expect(dependencies[2]).toEqual({
      name: 'org.cyclonedx.bom',
      fromVersion: '1.8.2',
      toVersion: '2.3.0',
      semverChange: 'major'
    });
  });

  test('should handle "Bumps" vs "Bump" in PR title', () => {
    // Test with "Bump" (no s)
    const alternateTitleNoBumps = "Bump the maven group in /app with 3 updates";
    const dependenciesNoBumps = extractMultipleDependencyInfo(alternateTitleNoBumps, pr13Body);
    expect(dependenciesNoBumps).toHaveLength(3);
    
    // Test with "Bumps" (with s)
    const alternateTitleWithBumps = "Bumps the maven group in /app with 3 updates";
    const dependenciesWithBumps = extractMultipleDependencyInfo(alternateTitleWithBumps, pr13Body);
    expect(dependenciesWithBumps).toHaveLength(3);
  });
});
