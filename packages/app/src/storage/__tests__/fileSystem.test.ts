import { describe, test, expect, vi, beforeEach } from 'vitest';
import { TauriFileSystem } from '../fileSystem';
import { ExternalChangeError } from '@markdone/core';

// ---------------------------------------------------------------------------
// Hoisted mock objects — vi.mock factories are hoisted before imports, so any
// variables they reference must also be hoisted via vi.hoisted().
// ---------------------------------------------------------------------------

const { mockFns, mockPathFns } = vi.hoisted(() => ({
  mockFns: {
    readTextFile: vi.fn(),
    writeTextFile: vi.fn(),
    stat: vi.fn(),
    readDir: vi.fn(),
    mkdir: vi.fn(),
    remove: vi.fn(),
    watch: vi.fn(),
  },
  mockPathFns: {
    homeDir: vi.fn(),
    documentDir: vi.fn(),
    dirname: vi.fn(),
  },
}));

vi.mock('@tauri-apps/plugin-fs', () => mockFns);
vi.mock('@tauri-apps/api/path', () => mockPathFns);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TauriFileSystem', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockPathFns.homeDir.mockResolvedValue('/home/user');
    mockPathFns.documentDir.mockResolvedValue('/home/user/Documents');
    mockPathFns.dirname.mockImplementation(async (p: string) => p.split('/').slice(0, -1).join('/'));
    mockFns.mkdir.mockResolvedValue(undefined);
  });

  // -------------------------------------------------------------------------
  // read
  // -------------------------------------------------------------------------

  describe('read', () => {
    test('returns file content and reads from the correct resolved path', async () => {
      mockFns.readTextFile.mockResolvedValue('# Tasks\n');
      mockFns.stat.mockResolvedValue({ mtime: new Date(1_700_000_000_000) });

      const fs = new TauriFileSystem();
      const content = await fs.read('~/Documents/tasks.md');
      expect(content).toBe('# Tasks\n');
      expect(mockFns.readTextFile).toHaveBeenCalledWith('/home/user/Documents/tasks.md');
    });

    test('rejects when the underlying read fails', async () => {
      mockFns.readTextFile.mockRejectedValue(new Error('File not found'));

      const fs = new TauriFileSystem();
      await expect(fs.read('~/Documents/tasks.md')).rejects.toThrow('File not found');
    });
  });

  // -------------------------------------------------------------------------
  // write — conflict detection
  // -------------------------------------------------------------------------

  describe('write', () => {
    test('writes file content when no conflict', async () => {
      const mtime = new Date(1_700_000_000_000);
      mockFns.readTextFile.mockResolvedValue('# Tasks\n');
      mockFns.stat.mockResolvedValue({ mtime });
      mockFns.writeTextFile.mockResolvedValue(undefined);

      const fs = new TauriFileSystem();
      await fs.read('~/Documents/tasks.md');
      await fs.write('~/Documents/tasks.md', '# Tasks\n\n- [ ] New task\n');
      expect(mockFns.writeTextFile).toHaveBeenCalledWith(
        '/home/user/Documents/tasks.md',
        '# Tasks\n\n- [ ] New task\n',
      );
    });

    test('creates the parent directory before writing', async () => {
      mockFns.stat.mockResolvedValue({ mtime: new Date() });
      mockFns.writeTextFile.mockResolvedValue(undefined);

      const fs = new TauriFileSystem();
      await fs.write('/tmp/newdir/tasks.md', '# Tasks\n');
      expect(mockFns.mkdir).toHaveBeenCalledWith('/tmp/newdir', { recursive: true });
    });

    test('throws ExternalChangeError when file mtime changed since last read', async () => {
      const originalMtime = new Date(1_700_000_000_000);
      const externalMtime = new Date(1_700_000_001_000);

      mockFns.readTextFile.mockResolvedValue('# Tasks\n');
      mockFns.stat.mockResolvedValueOnce({ mtime: originalMtime });

      const fs = new TauriFileSystem();
      await fs.read('~/Documents/tasks.md');

      mockFns.stat.mockResolvedValueOnce({ mtime: externalMtime });
      await expect(fs.write('~/Documents/tasks.md', '# Updated\n')).rejects.toThrow(ExternalChangeError);
      expect(mockFns.writeTextFile).not.toHaveBeenCalled();
    });

    test('writes without conflict check when no mtime is known yet', async () => {
      mockFns.stat.mockResolvedValue({ mtime: new Date() });
      mockFns.writeTextFile.mockResolvedValue(undefined);

      const fs = new TauriFileSystem();
      await fs.write('~/Documents/tasks.md', '# Tasks\n');
      expect(mockFns.writeTextFile).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // list / stat / delete
  // -------------------------------------------------------------------------

  describe('list', () => {
    test('returns directory entry names', async () => {
      mockFns.readDir.mockResolvedValue([
        { name: 'a.md', isDirectory: false, isFile: true, isSymlink: false },
        { name: 'sub', isDirectory: true, isFile: false, isSymlink: false },
      ]);

      const fs = new TauriFileSystem();
      const entries = await fs.list('~/Documents/vault');
      expect(entries).toEqual(['a.md', 'sub']);
      expect(mockFns.readDir).toHaveBeenCalledWith('/home/user/Documents/vault');
    });

    test('returns an empty array when the directory cannot be read', async () => {
      mockFns.readDir.mockRejectedValue(new Error('not found'));
      const fs = new TauriFileSystem();
      expect(await fs.list('~/Documents/missing')).toEqual([]);
    });
  });

  describe('stat', () => {
    test('reports mtimeMs and isDirectory', async () => {
      mockFns.stat.mockResolvedValue({ mtime: new Date(1_700_000_000_000), isDirectory: true, isSymlink: true });
      const fs = new TauriFileSystem();
      const info = await fs.stat('~/Documents/vault');
      expect(info).toEqual({ mtimeMs: 1_700_000_000_000, isDirectory: true, isSymlink: true });
    });
  });

  describe('delete', () => {
    test('removes the file at the resolved path', async () => {
      mockFns.remove.mockResolvedValue(undefined);
      const fs = new TauriFileSystem();
      await fs.delete('~/Documents/tasks.md');
      expect(mockFns.remove).toHaveBeenCalledWith('/home/user/Documents/tasks.md');
    });
  });

  // -------------------------------------------------------------------------
  // path resolution — branches and traversal guard
  // -------------------------------------------------------------------------

  describe('path resolution (via read)', () => {
    test('expands ~/path correctly without double-slash when homeDir has trailing slash', async () => {
      mockPathFns.homeDir.mockResolvedValue('/home/user/');
      mockFns.readTextFile.mockResolvedValue('');
      mockFns.stat.mockResolvedValue({});

      const fs = new TauriFileSystem();
      await fs.read('~/Documents/tasks.md');
      expect(mockFns.readTextFile).toHaveBeenCalledWith('/home/user/Documents/tasks.md');
    });

    test('passes absolute paths through unchanged', async () => {
      mockFns.readTextFile.mockResolvedValue('');
      mockFns.stat.mockResolvedValue({});

      const fs = new TauriFileSystem();
      await fs.read('/tmp/tasks.md');
      expect(mockFns.readTextFile).toHaveBeenCalledWith('/tmp/tasks.md');
    });

    test('anchors relative paths to documentDir', async () => {
      mockFns.readTextFile.mockResolvedValue('');
      mockFns.stat.mockResolvedValue({});

      const fs = new TauriFileSystem();
      await fs.read('tasks.md');
      expect(mockFns.readTextFile).toHaveBeenCalledWith('/home/user/Documents/tasks.md');
    });

    test('rejects path traversal from ~/… prefix', async () => {
      const fs = new TauriFileSystem();
      await expect(fs.read('~/Documents/../../.ssh/keys')).rejects.toThrow('Path traversal detected');
    });

    test('rejects path traversal from relative path', async () => {
      const fs = new TauriFileSystem();
      await expect(fs.read('../../.ssh/keys')).rejects.toThrow('Path traversal detected');
    });
  });

  // -------------------------------------------------------------------------
  // watch
  // -------------------------------------------------------------------------

  describe('watch', () => {
    test('returns an unsubscribe function that stops the underlying watcher', async () => {
      const stopWatcher = vi.fn();
      mockFns.watch.mockResolvedValue(stopWatcher);
      mockFns.stat.mockResolvedValue({ mtime: new Date() });

      const fs = new TauriFileSystem();
      const unwatch = fs.watch('~/Documents/tasks.md', vi.fn());

      // Give the async setup a tick to complete.
      await new Promise(resolve => setTimeout(resolve, 0));

      unwatch();
      expect(stopWatcher).toHaveBeenCalled();
    });

    test('fires the callback with the watched path when mtime changes', async () => {
      let watchCallback: (() => void) | undefined;
      mockFns.watch.mockImplementation(async (_path: string, cb: () => void) => {
        watchCallback = cb;
        return vi.fn();
      });

      const fs = new TauriFileSystem();
      mockFns.stat.mockResolvedValueOnce({ mtime: new Date(1_700_000_000_000) });
      await fs.read('~/Documents/tasks.md');

      const onChange = vi.fn();
      fs.watch('~/Documents/tasks.md', onChange);
      await new Promise(resolve => setTimeout(resolve, 0));

      mockFns.stat.mockResolvedValueOnce({ mtime: new Date(1_700_000_001_000) });
      await watchCallback?.();

      expect(onChange).toHaveBeenCalledWith('~/Documents/tasks.md');
    });

    describe('a directory (directory-mode workspace)', () => {
      async function watchDir(onChange: () => void) {
        let watchCallback: ((event: unknown) => Promise<void>) | undefined;
        let watchOptions: { recursive?: boolean } | undefined;
        mockFns.watch.mockImplementation(async (_path: string, cb: (e: unknown) => Promise<void>, options: { recursive?: boolean }) => {
          watchCallback = cb;
          watchOptions = options;
          return vi.fn();
        });
        const fs = new TauriFileSystem();
        fs.watch('~/Documents/ws', onChange);
        await new Promise(resolve => setTimeout(resolve, 0));
        return { fs, fire: (event: unknown) => watchCallback!(event), options: () => watchOptions };
      }

      test('watches recursively, so a change in a project subfolder is seen', async () => {
        const { options } = await watchDir(vi.fn());
        expect(options()?.recursive).toBe(true);
      });

      test('fires for a .md file this instance has not written', async () => {
        const onChange = vi.fn();
        const { fire } = await watchDir(onChange);
        mockFns.stat.mockResolvedValue({ isDirectory: true, mtime: new Date(1) });
        await fire({ paths: ['/home/user/Documents/ws/home-network/todo.md'] });
        expect(onChange).toHaveBeenCalledWith('~/Documents/ws');
      });

      test('ignores a non-markdown file', async () => {
        const onChange = vi.fn();
        const { fire } = await watchDir(onChange);
        mockFns.stat.mockResolvedValue({ isDirectory: true, mtime: new Date(1) });
        await fire({ paths: ['/home/user/Documents/ws/attachments/photo.png'] });
        expect(onChange).not.toHaveBeenCalled();
      });

      test('ignores its own write once the remembered mtime matches', async () => {
        const onChange = vi.fn();
        const { fs, fire } = await watchDir(onChange);
        mockFns.stat.mockResolvedValue({ isDirectory: false, mtime: new Date(5) });
        await fs.read('~/Documents/ws/a.md');
        mockFns.stat.mockResolvedValue({ isDirectory: true, mtime: new Date(5) });
        await fire({ paths: ['/home/user/Documents/ws/a.md'] });
        expect(onChange).not.toHaveBeenCalled();
      });
    });
  });
});
