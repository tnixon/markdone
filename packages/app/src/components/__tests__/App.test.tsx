import { useEffect, useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { StorageProvider } from '../../storage/context';
import type { AppStorage } from '../../storage/appStorage';
import { InMemoryFileSystem, type WorkspaceConfig } from '@markdone/core';
import { useTodoOperations } from '../../hooks/useTodoOperations';

class InMemoryAppStorage implements AppStorage {
  readonly fs = new InMemoryFileSystem();
  private configs: WorkspaceConfig[] = [];

  async getWorkspaceConfigs(): Promise<WorkspaceConfig[]> {
    return [...this.configs];
  }

  async saveWorkspaceConfigs(configs: WorkspaceConfig[]): Promise<void> {
    this.configs = [...configs];
  }
}

// A simple test component that uses the hook
function WorkspaceCounter() {
  const ops = useTodoOperations();
  if (ops.loading) return <span>loading</span>;
  return <span data-testid="count">{ops.appState.workspaces.length}</span>;
}

describe('useTodoOperations with InMemoryAppStorage', () => {
  test('initializes with default workspace when storage is empty', async () => {
    const storage = new InMemoryAppStorage();
    render(
      <StorageProvider storage={storage}>
        <WorkspaceCounter />
      </StorageProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('count')).toBeInTheDocument();
    });

    expect(screen.getByTestId('count').textContent).toBe('1');
  });

  test('loads existing workspaces from storage', async () => {
    const storage = new InMemoryAppStorage();
    await storage.saveWorkspaceConfigs([
      { id: 'ws-1', name: 'Work', filePath: 'work.md' },
      { id: 'ws-2', name: 'Personal', filePath: 'personal.md' },
    ]);
    await storage.fs.write('work.md', '# Project A\n');
    await storage.fs.write('personal.md', '# Project B\n');

    render(
      <StorageProvider storage={storage}>
        <WorkspaceCounter />
      </StorageProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('count')).toBeInTheDocument();
    });

    expect(screen.getByTestId('count').textContent).toBe('2');
  });
});

describe('addWorkspace filePath handling', () => {
  function WorkspaceFilePathDisplay({ name, filePath }: { name: string; filePath?: string }) {
    const ops = useTodoOperations();
    const [added, setAdded] = useState(false);

    useEffect(() => {
      if (ops.loading || added) return;
      ops.addWorkspace(name, undefined, filePath).then(() => setAdded(true));
    }, [ops.loading]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!added) return null;
    const ws = ops.appState.workspaces.find(w => w.config.name === name);
    return <span data-testid="filepath">{ws?.config.filePath ?? ''}</span>;
  }

  test('uses explicit filePath verbatim when provided', async () => {
    const storage = new InMemoryAppStorage();

    render(
      <StorageProvider storage={storage}>
        <WorkspaceFilePathDisplay name="My Workspace" filePath="/custom/path/tasks.md" />
      </StorageProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('filepath').textContent).toBe('/custom/path/tasks.md');
    });
  });

  test('derives filePath from name slug when filePath is omitted', async () => {
    const storage = new InMemoryAppStorage();

    render(
      <StorageProvider storage={storage}>
        <WorkspaceFilePathDisplay name="My Work Tasks!" />
      </StorageProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('filepath').textContent).toBe('my-work-tasks.md');
    });
  });
});
