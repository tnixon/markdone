import React, { useState } from 'react';
import type { TodoOperations } from '../hooks/useTodoOperations';
import { getTasks, getColumns, getColumnTasks } from '@markdone/core';

export type SmartViewId = 'overdue' | 'due-this-week' | 'next-actions';

interface SidebarProps {
  ops: TodoOperations;
  selectedProject: { workspaceId: string; projectIndex: number } | null;
  onSelectProject: (selection: { workspaceId: string; projectIndex: number } | null) => void;
  activeSmartView: SmartViewId | null;
  onSelectSmartView: (view: SmartViewId | null) => void;
}

const SMART_VIEWS: { id: SmartViewId; label: string; icon: React.ReactNode }[] = [
  {
    id: 'next-actions',
    label: 'Next Actions',
    icon: (
      <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M2 7h10M7 2l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'overdue',
    label: 'Overdue',
    icon: (
      <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="7" cy="7" r="5.5" />
        <path d="M7 4v3.5l2 1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'due-this-week',
    label: 'Due This Week',
    icon: (
      <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="3" width="10" height="9" rx="1" />
        <path d="M5 1.5v2M9 1.5v2M2 6h10" strokeLinecap="round" />
      </svg>
    ),
  },
];

export default function Sidebar({
  ops,
  selectedProject,
  onSelectProject,
  activeSmartView,
  onSelectSmartView,
}: SidebarProps) {
  const { appState } = ops;
  const [showAddProject, setShowAddProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectLayout, setNewProjectLayout] = useState<'checklist' | 'kanban'>('checklist');
  const [newProjectWorkspace, setNewProjectWorkspace] = useState<string>('');
  const [showWorkspaceSettings, setShowWorkspaceSettings] = useState(false);
  const [draggingProject, setDraggingProject] = useState<{ workspaceId: string; projectIndex: number } | null>(null);
  const [dragOverProject, setDragOverProject] = useState<{ workspaceId: string; projectIndex: number } | null>(null);

  const isAllScope = appState.activeScope === 'all';
  const isReservedProjectName = newProjectName.trim().toLowerCase() === 'inbox';

  function countIncompleteTasks(workspaceId: string, projectIndex: number): number {
    const workspace = appState.workspaces.find(w => w.config.id === workspaceId);
    if (!workspace) return 0;
    const project = workspace.todoFile.projects[projectIndex];
    if (!project) return 0;

    if (project.layout === 'checklist') {
      return getTasks(project).filter(t => !t.completed).length;
    }
    return getColumns(project).reduce(
      (sum, col) => sum + getColumnTasks(col).filter(t => !t.completed).length,
      0,
    );
  }

  function handleAddProject() {
    const trimmed = newProjectName.trim();
    if (!trimmed || trimmed.toLowerCase() === 'inbox') return;

    const targetWorkspaceId = isAllScope
      ? (newProjectWorkspace || appState.workspaces[0]?.config.id)
      : appState.activeScope;

    if (!targetWorkspaceId) return;

    ops.addProject(targetWorkspaceId, trimmed, newProjectLayout);
    setNewProjectName('');
    setNewProjectLayout('checklist');
    setNewProjectWorkspace('');
    setShowAddProject(false);
  }

  function handleProjectDragStart(e: React.DragEvent, workspaceId: string, projectIndex: number) {
    setDraggingProject({ workspaceId, projectIndex });
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleProjectDragOver(e: React.DragEvent, workspaceId: string, projectIndex: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverProject({ workspaceId, projectIndex });
  }

  function handleProjectDrop(e: React.DragEvent, workspaceId: string, projectIndex: number) {
    e.preventDefault();
    if (
      !draggingProject ||
      draggingProject.workspaceId !== workspaceId ||
      draggingProject.projectIndex === projectIndex
    ) {
      setDraggingProject(null);
      setDragOverProject(null);
      return;
    }
    ops.reorderProject(workspaceId, draggingProject.projectIndex, projectIndex);
    setDraggingProject(null);
    setDragOverProject(null);
  }

  function handleProjectDragEnd() {
    setDraggingProject(null);
    setDragOverProject(null);
  }

  const visibleWorkspaces = isAllScope
    ? appState.workspaces
    : appState.workspaces.filter(w => w.config.id === appState.activeScope);

  return (
    <aside className="w-56 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 flex flex-col h-screen overflow-y-auto bg-gray-50 dark:bg-gray-900">
      {/* App title */}
      <div className="px-4 pt-4 pb-2">
        <span className="text-base font-bold text-gray-800 dark:text-gray-100 tracking-tight">
          markdone
        </span>
      </div>

      {/* Workspace scope selector */}
      <div className="px-2 py-2 flex flex-wrap gap-1">
        <button
          onClick={() => ops.setActiveScope('all')}
          className={`px-2 py-1 text-xs rounded-full transition-colors ${
            isAllScope
              ? 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-medium'
              : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
        >
          All
        </button>
        {appState.workspaces.map(ws => (
          <button
            key={ws.config.id}
            onClick={() => ops.setActiveScope(ws.config.id)}
            className={`px-2 py-1 text-xs rounded-full transition-colors ${
              appState.activeScope === ws.config.id
                ? 'text-white font-medium'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
            style={
              appState.activeScope === ws.config.id
                ? { backgroundColor: ws.config.color ?? '#6366f1' }
                : {}
            }
          >
            {ws.config.name}
          </button>
        ))}
      </div>

      {/* Inbox */}
      {(() => {
        const inboxWorkspace = visibleWorkspaces[0];
        if (!inboxWorkspace) return null;
        const inboxCount = countIncompleteTasks(inboxWorkspace.config.id, 0);
        const isInboxSelected =
          selectedProject?.projectIndex === 0 &&
          selectedProject?.workspaceId === inboxWorkspace.config.id;
        return (
          <div className="px-2 py-1 border-b border-gray-200 dark:border-gray-700 mb-1">
            <button
              onClick={() => {
                onSelectSmartView(null);
                onSelectProject({ workspaceId: inboxWorkspace.config.id, projectIndex: 0 });
              }}
              className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-left text-sm transition-colors ${
                isInboxSelected
                  ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="opacity-60">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M1.5 9h2.8l1 2h5.4l1-2h2.8V4.5a1 1 0 00-1-1h-11a1 1 0 00-1 1V9z" strokeLinejoin="round" />
                  </svg>
                </span>
                <span>Inbox</span>
              </div>
              {inboxCount > 0 && (
                <span className="text-xs text-gray-400 dark:text-gray-500">{inboxCount}</span>
              )}
            </button>
          </div>
        );
      })()}

      {/* Smart Views */}
      <div className="px-2 py-1 border-b border-gray-200 dark:border-gray-700 mb-1">
        <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          Smart Views
        </div>
        {SMART_VIEWS.map(({ id, label, icon }) => (
          <button
            key={id}
            onClick={() => {
              onSelectProject(null);
              onSelectSmartView(activeSmartView === id ? null : id);
            }}
            className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-left text-sm transition-colors ${
              activeSmartView === id
                ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-800 dark:hover:text-gray-200'
            }`}
          >
            <span className="opacity-60">{icon}</span>
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>

      {/* Project list */}
      <div className="flex-1 px-2 py-1">
        {visibleWorkspaces.map(workspace => (
          <div key={workspace.config.id} className="mb-3">
            {isAllScope && (
              <div
                className="px-2 py-1 text-xs font-semibold uppercase tracking-wider"
                style={{ color: workspace.config.color ?? '#6366f1' }}
              >
                {workspace.config.name}
              </div>
            )}
            {workspace.todoFile.projects.map((project, projectIndex) => {
              if (project.name === 'Inbox') return null;
              const isSelected =
                selectedProject?.workspaceId === workspace.config.id &&
                selectedProject?.projectIndex === projectIndex;
              const incompleteCount = countIncompleteTasks(workspace.config.id, projectIndex);
              const isDragging =
                draggingProject?.workspaceId === workspace.config.id &&
                draggingProject?.projectIndex === projectIndex;
              const isDropTarget =
                dragOverProject?.workspaceId === workspace.config.id &&
                dragOverProject?.projectIndex === projectIndex;

              return (
                <div
                  key={projectIndex}
                  draggable
                  onDragStart={e => handleProjectDragStart(e, workspace.config.id, projectIndex)}
                  onDragOver={e => handleProjectDragOver(e, workspace.config.id, projectIndex)}
                  onDrop={e => handleProjectDrop(e, workspace.config.id, projectIndex)}
                  onDragEnd={handleProjectDragEnd}
                  className={`transition-opacity ${isDragging ? 'opacity-40' : 'opacity-100'} ${
                    isDropTarget ? 'ring-1 ring-indigo-400 rounded-md' : ''
                  }`}
                >
                  <button
                    onClick={() => {
                      onSelectSmartView(null);
                      onSelectProject({ workspaceId: workspace.config.id, projectIndex });
                    }}
                    className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-left text-sm transition-colors ${
                      isSelected
                        ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-800 dark:hover:text-gray-200'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {project.layout === 'kanban' ? (
                        <KanbanIcon className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
                      ) : (
                        <ChecklistIcon className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
                      )}
                      <span className="truncate">{project.name}</span>
                    </div>
                    {incompleteCount > 0 && (
                      <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 ml-1">
                        {incompleteCount}
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Add Project */}
      <div className="px-2 py-2 border-t border-gray-200 dark:border-gray-700">
        {showAddProject ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg p-3 shadow-sm border border-gray-200 dark:border-gray-700">
            <input
              autoFocus
              value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAddProject();
                if (e.key === 'Escape') setShowAddProject(false);
              }}
              placeholder="Project name..."
              className="w-full text-sm bg-transparent outline-none border-b border-gray-200 dark:border-gray-700 pb-1 mb-2"
            />
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => setNewProjectLayout('checklist')}
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded ${
                  newProjectLayout === 'checklist'
                    ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300'
                    : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <ChecklistIcon className="w-3 h-3" />
                List
              </button>
              <button
                onClick={() => setNewProjectLayout('kanban')}
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded ${
                  newProjectLayout === 'kanban'
                    ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300'
                    : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <KanbanIcon className="w-3 h-3" />
                Board
              </button>
            </div>
            {isAllScope && appState.workspaces.length > 1 && (
              <select
                value={newProjectWorkspace}
                onChange={e => setNewProjectWorkspace(e.target.value)}
                className="w-full text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-1 py-0.5 mb-2 outline-none"
              >
                <option value="">Select workspace...</option>
                {appState.workspaces.map(ws => (
                  <option key={ws.config.id} value={ws.config.id}>
                    {ws.config.name}
                  </option>
                ))}
              </select>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleAddProject}
                disabled={isReservedProjectName}
                className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add
              </button>
              <button
                onClick={() => setShowAddProject(false)}
                className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAddProject(true)}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M7 2v10M2 7h10" strokeLinecap="round" />
            </svg>
            Add project
          </button>
        )}
      </div>

      {/* Workspace settings */}
      <div className="px-2 pb-3">
        <button
          onClick={() => setShowWorkspaceSettings(true)}
          className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="2.5" />
            <path d="M8 2v1M8 13v1M2 8h1M13 8h1M3.5 3.5l.7.7M11.8 11.8l.7.7M3.5 12.5l.7-.7M11.8 4.2l.7-.7" strokeLinecap="round" />
          </svg>
          Workspace settings
        </button>
      </div>

      {/* Workspace settings modal */}
      {showWorkspaceSettings && (
        <WorkspaceSettingsModal ops={ops} onClose={() => setShowWorkspaceSettings(false)} />
      )}
    </aside>
  );
}

async function browseMdFile(setter: (path: string) => void) {
  try {
    const { save } = await import(/* @vite-ignore */ '@tauri-apps/plugin-dialog');
    const selected = await save({
      filters: [{ name: 'Markdown', extensions: ['md', 'txt'] }],
      defaultPath: 'todo.md',
    });
    if (typeof selected === 'string') setter(selected);
  } catch (e) {
    console.error('File picker failed:', e);
  }
}

function WorkspaceSettingsModal({ ops, onClose }: { ops: TodoOperations; onClose: () => void }) {
  const { appState } = ops;
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspaceFilePath, setNewWorkspaceFilePath] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editFilePath, setEditFilePath] = useState('');

  const isTauri = Boolean((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__);

  const COLORS = [
    '#6366f1', '#f59e0b', '#10b981', '#ef4444',
    '#3b82f6', '#8b5cf6', '#f97316', '#14b8a6',
  ];

  async function handleAddWorkspace() {
    const trimmed = newWorkspaceName.trim();
    if (!trimmed) return;
    await ops.addWorkspace(trimmed, undefined, newWorkspaceFilePath.trim() || undefined);
    setNewWorkspaceName('');
    setNewWorkspaceFilePath('');
  }

  function startEdit(ws: { config: { id: string; name: string; color?: string; filePath: string } }) {
    setEditingId(ws.config.id);
    setEditName(ws.config.name);
    setEditColor(ws.config.color ?? '#6366f1');
    setEditFilePath(ws.config.filePath);
  }

  async function saveEdit() {
    if (!editingId) return;
    await ops.updateWorkspaceConfig(editingId, {
      name: editName.trim() || undefined,
      color: editColor,
      ...(isTauri ? { filePath: editFilePath.trim() || undefined } : {}),
    });
    setEditingId(null);
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 dark:bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-5">
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-4">
          Workspace Settings
        </h2>

        {appState.workspaces.map(ws => (
          <div key={ws.config.id} className="mb-3">
            {editingId === ws.config.id ? (
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                <input
                  autoFocus
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(); }}
                  className="w-full text-sm bg-transparent outline-none border-b border-gray-200 dark:border-gray-700 pb-1 mb-2"
                />
                {isTauri && (
                  <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-700 pb-1 mb-2">
                    <input
                      value={editFilePath}
                      onChange={e => setEditFilePath(e.target.value)}
                      placeholder="~/Documents/tasks.md"
                      className="flex-1 text-xs font-mono bg-transparent outline-none text-gray-500 dark:text-gray-400"
                    />
                    <button
                      onClick={() => browseMdFile(setEditFilePath)}
                      className="text-xs px-1.5 py-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 border border-gray-200 dark:border-gray-600 rounded"
                    >
                      Browse…
                    </button>
                  </div>
                )}
                <div className="flex gap-1.5 flex-wrap mb-2">
                  {COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setEditColor(c)}
                      className={`w-5 h-5 rounded-full transition-transform ${editColor === c ? 'scale-125 ring-2 ring-offset-1 ring-gray-400' : ''}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={saveEdit} className="text-xs px-2 py-1 bg-indigo-600 text-white rounded">Save</button>
                  <button onClick={() => setEditingId(null)} className="text-xs text-gray-500">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: ws.config.color ?? '#6366f1' }} />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{ws.config.name}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => startEdit(ws)} className="p-1 text-gray-400 hover:text-gray-600">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M11 2l3 3-8 8H3v-3l8-8z" strokeLinejoin="round" />
                    </svg>
                  </button>
                  {appState.workspaces.length > 1 && (
                    <button
                      onClick={() => ops.removeWorkspace(ws.config.id)}
                      className="p-1 text-gray-400 hover:text-red-500"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M3 4h10M6 4V2h4v2M5 4v9h6V4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Add workspace */}
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
          <div className="flex gap-2">
            <input
              value={newWorkspaceName}
              onChange={e => setNewWorkspaceName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddWorkspace(); }}
              placeholder="New workspace name..."
              className="flex-1 text-sm bg-transparent outline-none border-b border-gray-200 dark:border-gray-700 pb-1"
            />
            <button
              onClick={handleAddWorkspace}
              className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700"
            >
              Add
            </button>
          </div>
          {isTauri && (
            <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-700 pb-1 mt-1.5">
              <input
                value={newWorkspaceFilePath}
                onChange={e => setNewWorkspaceFilePath(e.target.value)}
                placeholder="File path (optional)..."
                className="flex-1 text-xs font-mono bg-transparent outline-none text-gray-500 dark:text-gray-400"
              />
              <button
                onClick={() => browseMdFile(setNewWorkspaceFilePath)}
                className="text-xs px-1.5 py-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 border border-gray-200 dark:border-gray-600 rounded"
              >
                Browse…
              </button>
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="mt-4 w-full text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function ChecklistIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 4h10M2 7h6M2 10h4" strokeLinecap="round" />
    </svg>
  );
}

function KanbanIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="2" width="3" height="10" rx="0.5" />
      <rect x="5.5" y="2" width="3" height="7" rx="0.5" />
      <rect x="10" y="2" width="3" height="5" rx="0.5" />
    </svg>
  );
}
