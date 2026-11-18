import { App } from './fakeObsidian';
import { selectableFolders } from '../folderSuggest';

describe('selectableFolders', () => {
  test('lists existing folders, nested ones included, sorted by path', () => {
    const app = new App({ 'b/x.md': '', 'a/y.md': '', 'a/deep/z.md': '' });

    expect(selectableFolders(app as any, []).map(f => f.path)).toEqual(['a', 'a/deep', 'b']);
  });

  test('excludes folders that are already configured', () => {
    const app = new App({ 'a/x.md': '', 'b/y.md': '' });

    expect(selectableFolders(app as any, ['a']).map(f => f.path)).toEqual(['b']);
  });

  test('excludes folders nested inside or containing a configured one', () => {
    const app = new App({ 'a/x.md': '', 'a/deep/z.md': '', 'b/c/y.md': '', 'ab/q.md': '' });

    expect(selectableFolders(app as any, ['a', 'b/c']).map(f => f.path)).toEqual(['ab']);
    expect(selectableFolders(app as any, ['a/deep']).map(f => f.path)).toEqual(['ab', 'b', 'b/c']);
  });

  test('asks the vault to leave out the root folder', () => {
    const app = new App({ 'a/x.md': '' });
    const getAllFolders = vi.spyOn(app.vault, 'getAllFolders');

    selectableFolders(app as any, []);

    expect(getAllFolders).toHaveBeenCalledWith(false);
  });
});
