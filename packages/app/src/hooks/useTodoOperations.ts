import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  AppState,
  WorkspaceConfig,
  TodoFile,
  Effort,
  ActionRecord,
  TaskLocation,
  SubtaskLocation,
  NewTaskInput,
  TaskFields,
  Result,
} from '@markdone/core';
import {
  addTask,
  updateTask,
  deleteTask,
  completeTask,
  uncompleteTask,
  moveTask,
  reorderTask,
  addSubtask,
  updateSubtask as updateSubtaskOp,
  addProject,
  updateProject,
  deleteProject,
  reorderProject,
  addColumn,
  renameColumn,
  reorderColumn,
  parse,
  serialize,
  ExternalChangeError,
} from '@markdone/core';
import { useStorage } from '../storage/context';
import { DEFAULT_WORKSPACE_CONFIG } from '../storage/appStorage';

export type SaveStatus = 'saved' | 'saving' | 'error';

const DEFAULT_CONTENT = '# Inbox\n';

const WORKSPACE_COLORS = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444',
  '#3b82f6', '#8b5cf6', '#f97316', '#14b8a6',
];

export function useTodoOperations() {
  const storage = useStorage();
  const [appState, setAppState] = useState<AppState>({ workspaces: [], activeScope: 'all' });
  const [saveStatus, setSaveStatus] = useState<Record<string, SaveStatus>>({});
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState<string | null>(null);

  const appStateRef = useRef<AppState>({ workspaces: [], activeScope: 'all' });
  const undoStackRef = useRef<ActionRecord[]>([]);
  const undoRef = useRef<() => void>(() => {});
  const [canUndo, setCanUndo] = useState(false);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const unwatchersRef = useRef<Map<string, () => void>>(new Map());

  // Keep ref in sync
  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

  function filePathFor(workspaceId: string): string | undefined {
    return appStateRef.current.workspaces.find(w => w.config.id === workspaceId)?.config.filePath;
  }

  /**
   * Reload a single workspace from storage and update app state.
   * Used when an external change is detected (file watcher or conflict).
   */
  const reloadWorkspace = useCallback(
    async (workspaceId: string, filePath: string) => {
      let content: string;
      try {
        content = await storage.fs.read(filePath);
      } catch {
        content = DEFAULT_CONTENT;
      }
      const todoFile = parse(content).file;
      const prev = appStateRef.current;
      const next: AppState = {
        ...prev,
        workspaces: prev.workspaces.map(ws =>
          ws.config.id === workspaceId ? { ...ws, todoFile } : ws,
        ),
      };
      appStateRef.current = next;
      setAppState(next);
    },
    [storage],
  );

  const scheduleSave = useCallback(
    (workspaceId: string, todoFile: TodoFile) => {
      setSaveStatus(prev => ({ ...prev, [workspaceId]: 'saving' }));

      if (saveTimers.current[workspaceId]) {
        clearTimeout(saveTimers.current[workspaceId]);
      }

      saveTimers.current[workspaceId] = setTimeout(async () => {
        const filePath = filePathFor(workspaceId);
        if (!filePath) return;
        try {
          await storage.fs.write(filePath, serialize(todoFile));
          setSaveStatus(prev => ({ ...prev, [workspaceId]: 'saved' }));
        } catch (err) {
          if (err instanceof ExternalChangeError) {
            // The file was changed externally while we were editing.
            // Reload to pick up the external state and notify the user.
            await reloadWorkspace(workspaceId, filePath);
            const ws = appStateRef.current.workspaces.find(w => w.config.id === workspaceId);
            const name = ws?.config.name ?? workspaceId;
            setNotification(`"${name}" was updated externally. Reloaded.`);
            setSaveStatus(prev => ({ ...prev, [workspaceId]: 'saved' }));
          } else {
            setSaveStatus(prev => ({ ...prev, [workspaceId]: 'error' }));
          }
        }
      }, 500);
    },
    [storage, reloadWorkspace],
  );

  function unwatchWorkspace(workspaceId: string) {
    const unwatch = unwatchersRef.current.get(workspaceId);
    if (unwatch) {
      unwatch();
      unwatchersRef.current.delete(workspaceId);
    }
  }

  function watchWorkspace(config: WorkspaceConfig) {
    unwatchWorkspace(config.id);
    const unwatch = storage.fs.watch?.(config.filePath, async () => {
      await reloadWorkspace(config.id, config.filePath);
      setNotification(`"${config.name}" was updated externally. Reloaded.`);
    });
    if (unwatch) unwatchersRef.current.set(config.id, unwatch);
  }

  // Load initial state from storage and register file-watcher callbacks
  useEffect(() => {
    let cancelled = false;

    async function loadState() {
      let configs = await storage.getWorkspaceConfigs();

      if (configs.length === 0) {
        configs = [DEFAULT_WORKSPACE_CONFIG];
        await storage.saveWorkspaceConfigs(configs);
        await storage.fs.write(DEFAULT_WORKSPACE_CONFIG.filePath, DEFAULT_CONTENT);
      }

      const workspaces = await Promise.all(
        configs.map(async config => {
          let content: string;
          try {
            content = await storage.fs.read(config.filePath);
          } catch {
            content = DEFAULT_CONTENT;
          }
          return { config, todoFile: parse(content).file };
        }),
      );

      if (!cancelled) {
        const state: AppState = { workspaces, activeScope: 'all' };
        appStateRef.current = state;
        setAppState(state);
        setLoading(false);

        // Register external-change watchers if the FileSystem supports them.
        configs.forEach(config => watchWorkspace(config));
      }
    }

    loadState();
    return () => {
      cancelled = true;
      unwatchersRef.current.forEach(unwatch => unwatch());
      unwatchersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage, reloadWorkspace]);

  function applyOperation(
    description: string,
    operationFn: (s: AppState) => Result<AppState>,
    primaryWorkspaceId?: string,
  ) {
    const prev = appStateRef.current;
    const result = operationFn(prev);
    if (!result.ok) return;

    const next = result.value;
    appStateRef.current = next;
    setAppState(next);

    // Identify changed workspaces (compare by ID, not by array position)
    const changedIds = next.workspaces
      .filter(ws => ws.todoFile !== prev.workspaces.find(w => w.config.id === ws.config.id)?.todoFile)
      .map(ws => ws.config.id);

    const saveIds = primaryWorkspaceId ? [primaryWorkspaceId] : changedIds;
    saveIds.forEach(id => {
      const ws = next.workspaces.find(w => w.config.id === id);
      if (ws) scheduleSave(id, ws.todoFile);
    });

    // Undo record (first changed workspace only)
    const undoWorkspaceId = primaryWorkspaceId ?? changedIds[0];
    if (undoWorkspaceId) {
      const before = prev.workspaces.find(w => w.config.id === undoWorkspaceId)?.todoFile;
      const after = next.workspaces.find(w => w.config.id === undoWorkspaceId)?.todoFile;
      if (before && after && before !== after) {
        undoStackRef.current = [
          ...undoStackRef.current.slice(-49),
          { description, before, after, workspaceId: undoWorkspaceId, timestamp: Date.now() },
        ];
        setCanUndo(true);
      }
    }
  }

  function undo() {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;

    const record = stack[stack.length - 1];
    undoStackRef.current = stack.slice(0, -1);
    setCanUndo(undoStackRef.current.length > 0);

    const prev = appStateRef.current;
    const next: AppState = {
      ...prev,
      workspaces: prev.workspaces.map(ws =>
        ws.config.id === record.workspaceId ? { ...ws, todoFile: record.before } : ws,
      ),
    };
    appStateRef.current = next;
    setAppState(next);
    scheduleSave(record.workspaceId, record.before);
  }

  // Keep undoRef current so the keyboard handler always calls the latest undo
  useEffect(() => {
    undoRef.current = undo;
  });

  // Keyboard shortcut for undo — registered once via stable ref
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoRef.current();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return {
    appState,
    saveStatus,
    canUndo,
    loading,
    undo,
    notification,
    dismissNotification: () => setNotification(null),

    // Task operations
    addTask: (
      workspaceId: string,
      projectIndex: number,
      columnIndex: number | undefined,
      task: NewTaskInput,
    ) =>
      applyOperation(
        'Add task',
        s => addTask(s, workspaceId, projectIndex, columnIndex, task),
        workspaceId,
      ),

    updateTask: (location: TaskLocation, changes: Partial<TaskFields>) =>
      applyOperation('Update task', s => updateTask(s, location, changes), location.workspaceId),

    deleteTask: (location: TaskLocation) =>
      applyOperation('Delete task', s => deleteTask(s, location), location.workspaceId),

    completeTask: (location: TaskLocation, actual?: { duration?: Effort }) =>
      applyOperation(
        'Complete task',
        s => completeTask(s, location, actual),
        location.workspaceId,
      ),

    uncompleteTask: (location: TaskLocation) =>
      applyOperation(
        'Uncomplete task',
        s => uncompleteTask(s, location),
        location.workspaceId,
      ),

    moveTask: (from: TaskLocation, to: TaskLocation) =>
      applyOperation('Move task', s => moveTask(s, from, to), from.workspaceId),

    reorderTask: (location: TaskLocation, newIndex: number) =>
      applyOperation('Reorder task', s => reorderTask(s, location, newIndex), location.workspaceId),

    addSubtask: (parentLocation: TaskLocation, subtask: NewTaskInput) =>
      applyOperation(
        'Add subtask',
        s => addSubtask(s, parentLocation, subtask),
        parentLocation.workspaceId,
      ),

    updateSubtask: (location: SubtaskLocation, changes: Partial<TaskFields>) =>
      applyOperation(
        'Update subtask',
        s => updateSubtaskOp(s, location, changes),
        location.workspaceId,
      ),

    // Project operations
    addProject: (workspaceId: string, name: string, layout: 'checklist' | 'kanban') =>
      applyOperation(
        'Add project',
        s => addProject(s, workspaceId, name, layout),
        workspaceId,
      ),

    updateProject: (
      workspaceId: string,
      projectIndex: number,
      changes: { name?: string; description?: string },
    ) =>
      applyOperation(
        'Update project',
        s => updateProject(s, workspaceId, projectIndex, changes),
        workspaceId,
      ),

    deleteProject: (workspaceId: string, projectIndex: number) =>
      applyOperation(
        'Delete project',
        s => deleteProject(s, workspaceId, projectIndex),
        workspaceId,
      ),

    reorderProject: (workspaceId: string, projectIndex: number, newIndex: number) =>
      applyOperation(
        'Reorder project',
        s => reorderProject(s, workspaceId, projectIndex, newIndex),
        workspaceId,
      ),

    addColumn: (workspaceId: string, projectIndex: number, name: string) =>
      applyOperation(
        'Add column',
        s => addColumn(s, workspaceId, projectIndex, name),
        workspaceId,
      ),

    renameColumn: (
      workspaceId: string,
      projectIndex: number,
      columnIndex: number,
      name: string,
    ) =>
      applyOperation(
        'Rename column',
        s => renameColumn(s, workspaceId, projectIndex, columnIndex, name),
        workspaceId,
      ),

    reorderColumn: (workspaceId: string, projectIndex: number, columnIndex: number, newIndex: number) =>
      applyOperation(
        'Reorder column',
        s => reorderColumn(s, workspaceId, projectIndex, columnIndex, newIndex),
        workspaceId,
      ),

    // Workspace management
    addWorkspace: async (name: string, color?: string, filePath?: string) => {
      const id = `ws-${Date.now()}`;
      const usedColors = appStateRef.current.workspaces.map(w => w.config.color);
      const autoColor = color ?? WORKSPACE_COLORS.find(c => !usedColors.includes(c)) ?? WORKSPACE_COLORS[0];
      const config: WorkspaceConfig = {
        id,
        name,
        filePath: filePath ?? `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}.md`,
        color: autoColor,
      };
      const newConfigs = appStateRef.current.workspaces.map(w => w.config).concat(config);
      await storage.saveWorkspaceConfigs(newConfigs);
      await storage.fs.write(config.filePath, DEFAULT_CONTENT);
      const todoFile = parse(DEFAULT_CONTENT).file;
      const next: AppState = {
        ...appStateRef.current,
        workspaces: [...appStateRef.current.workspaces, { config, todoFile }],
      };
      appStateRef.current = next;
      setAppState(next);

      // Register a file watcher for the new workspace so external changes
      // (cloud sync, text editor) are detected without requiring a restart.
      watchWorkspace(config);
    },

    updateWorkspaceConfig: async (
      id: string,
      changes: Partial<Pick<WorkspaceConfig, 'name' | 'color' | 'filePath'>>,
    ) => {
      const newConfigs = appStateRef.current.workspaces.map(w =>
        w.config.id === id ? { ...w.config, ...changes } : w.config,
      );
      await storage.saveWorkspaceConfigs(newConfigs);
      const next: AppState = {
        ...appStateRef.current,
        workspaces: appStateRef.current.workspaces.map(ws =>
          ws.config.id === id ? { ...ws, config: { ...ws.config, ...changes } } : ws,
        ),
      };
      appStateRef.current = next;
      setAppState(next);
      if (changes.filePath) {
        await reloadWorkspace(id, changes.filePath);
        // Re-point the watcher at the new path — the old one still watches
        // the stale path and would otherwise leak for the rest of the session.
        const config = next.workspaces.find(ws => ws.config.id === id)?.config;
        if (config) watchWorkspace(config);
      }
    },

    removeWorkspace: async (id: string) => {
      const newConfigs = appStateRef.current.workspaces
        .filter(w => w.config.id !== id)
        .map(w => w.config);
      await storage.saveWorkspaceConfigs(newConfigs);
      const next: AppState = {
        ...appStateRef.current,
        workspaces: appStateRef.current.workspaces.filter(ws => ws.config.id !== id),
        activeScope: appStateRef.current.activeScope === id ? 'all' : appStateRef.current.activeScope,
      };
      appStateRef.current = next;
      setAppState(next);
      unwatchWorkspace(id);
    },

    setActiveScope: (scope: string) => {
      const next: AppState = { ...appStateRef.current, activeScope: scope };
      appStateRef.current = next;
      setAppState(next);
    },

    /**
     * Directly replace a workspace's TodoFile (used by the AI assistant after
     * the user confirms a mutation preview). Schedules a save and records undo.
     */
    applyRawWorkspace: (workspaceId: string, todoFile: TodoFile, description = 'AI change') => {
      applyOperation(
        description,
        s => {
          const ws = s.workspaces.find(w => w.config.id === workspaceId);
          if (!ws) return { ok: false, error: { code: 'NOT_FOUND', message: 'Workspace not found' } };
          return {
            ok: true,
            value: {
              ...s,
              workspaces: s.workspaces.map(w =>
                w.config.id === workspaceId ? { ...w, todoFile } : w,
              ),
            },
          };
        },
        workspaceId,
      );
    },
  };
}

export type TodoOperations = ReturnType<typeof useTodoOperations>;
