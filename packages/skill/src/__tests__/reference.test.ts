import { readFileSync } from 'node:fs';
import path from 'node:path';
import { generateOperationsReference, operationsReferencePath } from '../generateOperationsReference';
import { specSourcePath, specVendoredPath } from '../vendorPaths';

// Guards against the same drift commandCoverage.test.ts catches for the CLI:
// a registry change (new operation, changed parameters) must be reflected in
// the checked-in skill reference before it merges, not discovered later by
// an agent reading a stale table.
describe('skill reference freshness', () => {
  const packageRoot = path.resolve(__dirname, '../..');
  const monorepoRoot = path.resolve(packageRoot, '../..');

  test('markdone/reference/operations.md matches toMarkdownReference() output', () => {
    const checkedIn = readFileSync(operationsReferencePath(packageRoot), 'utf8');
    expect(checkedIn).toBe(generateOperationsReference());
  });

  test('markdone/reference/TODO_FORMAT.md matches the monorepo spec', () => {
    const vendored = readFileSync(specVendoredPath(packageRoot), 'utf8');
    const source = readFileSync(specSourcePath(monorepoRoot), 'utf8');
    expect(vendored).toBe(source);
  });
});
