import { useState, useEffect, useRef } from 'react';
import { StorageProvider } from './storage/context';
import { useTodoOperations } from './hooks/useTodoOperations';
import Sidebar from './components/Sidebar';
import TaskList from './components/TaskList';
import KanbanBoard from './components/KanbanBoard';
import SmartView from './components/SmartView';
import KeyboardShortcutsHelp from './components/KeyboardShortcutsHelp';
import AiChat from './components/AiChat';
import TaskDetailPanel from './components/TaskDetailPanel';
import { today, endOfWeek } from './dates';
import type { SaveStatus } from './hooks/useTodoOperations';
import type { SmartViewId } from './components/Sidebar';
import type { AppStorage } from './storage/appStorage';
import type { AppState, Task, TaskLocation } from '@markdone/core';
import {
  getOverdueTasks,
  getTasksDueInRange,
  getNextActions,
  searchTasks,
  getEstimationAccuracy,
  getTasks,
  getColumns,
  getColumnTasks,
} from '@markdone/core';

function resolveTask(state: AppState, loc: TaskLocation): Task | null {
  const workspace = state.workspaces.find(w => w.config.id === loc.workspaceId);
  if (!workspace) return null;
  const project = workspace.todoFile.projects[loc.projectIndex];
  if (!project) return null;
  if (project.layout === 'kanban') {
    if (loc.columnIndex === undefined) return null;
    const col = getColumns(project)[loc.columnIndex];
    return col ? getColumnTasks(col)[loc.taskIndex] ?? null : null;
  }
  return getTasks(project)[loc.taskIndex] ?? null;
}

function isInputFocused(): boolean {
  const tag = document.activeElement?.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

type FilterKey = 'overdue' | 'dueToday' | 'dueThisWeek' | 'incomplete' | 'completed';

type SortKey = 'value' | 'complexity' | 'effort' | 'dueDate' | 'ratio' | null;

function AppShell() {
  const ops = useTodoOperations();
  const [selectedProject, setSelectedProject] = useState<{
    workspaceId: string;
    projectIndex: number;
  } | null>(null);
  const [activeSmartView, setActiveSmartView] = useState<SmartViewId | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState<Set<FilterKey>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>(null);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [focusNewTaskSignal, setFocusNewTaskSignal] = useState(0);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [detailLocation, setDetailLocation] = useState<TaskLocation | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === '?' && !isInputFocused()) {
        setShowShortcutsHelp(v => !v);
        return;
      }
      if (e.key === 'n' && !isInputFocused()) {
        setFocusNewTaskSignal(v => v + 1);
        return;
      }
      if (e.key === '/' && !isInputFocused()) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setAiChatOpen(v => !v);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (ops.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-900">
        <span className="text-gray-400 dark:text-gray-500 text-sm">Loading...</span>
      </div>
    );
  }

  const detailTask = detailLocation ? resolveTask(ops.appState, detailLocation) : null;

  const selectedWorkspace = selectedProject
    ? ops.appState.workspaces.find(w => w.config.id === selectedProject.workspaceId)
    : null;
  const activeProject =
    selectedWorkspace && selectedProject != null
      ? selectedWorkspace.todoFile.projects[selectedProject.projectIndex]
      : null;

  function workspaceColorOf(workspaceId: string): string {
    return ops.appState.workspaces.find(w => w.config.id === workspaceId)?.config.color ?? '#6366f1';
  }

  // Build the smart view task list
  function getSmartViewTasks() {
    if (!activeSmartView) return [];
    const state = ops.appState;
    switch (activeSmartView) {
      case 'overdue':
        return getOverdueTasks(state);
      case 'due-this-week':
        return getTasksDueInRange(state, today(), endOfWeek());
      case 'next-actions': {
        const map = getNextActions(state);
        return Array.from(map.values());
      }
    }
  }

  // Search + filter results
  function getSearchResults() {
    const query = searchQuery.trim();
    let results = query ? searchTasks(ops.appState, query) : [];

    if (activeFilters.size > 0) {
      const todayStr = today();
      const weekEnd = endOfWeek();
      const overdueTasks = activeFilters.has('overdue') ? getOverdueTasks(ops.appState) : [];
      const overdueIds = new Set(overdueTasks.map(t => t.task.id));
      const weekTasks = activeFilters.has('dueThisWeek') ? getTasksDueInRange(ops.appState, todayStr, weekEnd) : [];
      const weekIds = new Set(weekTasks.map(t => t.task.id));

      if (!query) {
        // When no search query but filters are active, start from all tasks
        const allTasks = searchTasks(ops.appState, '');
        results = allTasks;
      }

      results = results.filter(({ task }) => {
        if (activeFilters.has('overdue') && !overdueIds.has(task.id)) return false;
        if (activeFilters.has('dueToday') && task.dueDate !== todayStr) return false;
        if (activeFilters.has('dueThisWeek') && !weekIds.has(task.id)) return false;
        if (activeFilters.has('incomplete') && task.completed) return false;
        if (activeFilters.has('completed') && !task.completed) return false;
        return true;
      });
    }

    // Sort
    if (sortKey) {
      results = [...results].sort((a, b) => {
        const ta = a.task;
        const tb = b.task;
        switch (sortKey) {
          case 'value': return (tb.value ?? 0) - (ta.value ?? 0);
          case 'complexity': return (ta.complexity ?? 0) - (tb.complexity ?? 0);
          case 'effort': return effortToMin(tb) - effortToMin(ta);
          case 'dueDate': {
            if (!ta.dueDate && !tb.dueDate) return 0;
            if (!ta.dueDate) return 1;
            if (!tb.dueDate) return -1;
            return ta.dueDate.localeCompare(tb.dueDate);
          }
          case 'ratio': {
            const ra = (ta.value ?? 1) / (ta.complexity ?? 1);
            const rb = (tb.value ?? 1) / (tb.complexity ?? 1);
            return rb - ra;
          }
          default: return 0;
        }
      });
    }

    return results;
  }

  function toggleFilter(key: FilterKey) {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const isSearching = searchQuery.trim() !== '' || activeFilters.size > 0;
  const searchResults = isSearching ? getSearchResults() : [];
  const smartViewTasks = !isSearching && activeSmartView ? getSmartViewTasks() : [];

  const smartViewLabels: Record<SmartViewId, string> = {
    'next-actions': 'Next Actions',
    'overdue': 'Overdue',
    'due-this-week': 'Due This Week',
  };

  // Estimation accuracy for the current project
  const estimationStats =
    activeProject && selectedProject
      ? getEstimationAccuracy(
          ops.appState,
          selectedProject.workspaceId,
          selectedProject.projectIndex,
        )
      : null;

  // Determine main panel title
  let mainTitle = 'Select a project';
  if (isSearching) mainTitle = 'Search Results';
  else if (activeSmartView) mainTitle = smartViewLabels[activeSmartView];
  else if (activeProject) mainTitle = activeProject.name;

  return (
    <div className="min-h-screen flex bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {ops.notification && (
        <ExternalChangeNotification
          message={ops.notification}
          onDismiss={ops.dismissNotification}
        />
      )}
      {showShortcutsHelp && <KeyboardShortcutsHelp onClose={() => setShowShortcutsHelp(false)} />}

      <Sidebar
        ops={ops}
        selectedProject={selectedProject}
        onSelectProject={proj => {
          setSelectedProject(proj);
          setActiveSmartView(null);
        }}
        activeSmartView={activeSmartView}
        onSelectSmartView={view => {
          setActiveSmartView(view);
          setSelectedProject(null);
        }}
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex flex-col border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center justify-between px-6 py-3 gap-3">
            {/* Search bar */}
            <div className="flex-1 flex items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-1.5 max-w-md">
              <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="6.5" cy="6.5" r="4.5" />
                <path d="M10 10l3.5 3.5" strokeLinecap="round" />
              </svg>
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') { setSearchQuery(''); searchInputRef.current?.blur(); }
                }}
                placeholder="Search tasks… (press /)"
                className="flex-1 text-sm bg-transparent outline-none text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs">
                  ✕
                </button>
              )}
            </div>

            <div className="flex items-center gap-3">
              {/* Keyboard shortcut help */}
              <button
                onClick={() => setShowShortcutsHelp(true)}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1"
                title="Keyboard shortcuts (?)"
              >
                <kbd className="px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 font-mono text-xs">?</kbd>
              </button>

              {ops.canUndo && (
                <button
                  onClick={ops.undo}
                  className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1"
                  title="Undo (Ctrl+Z)"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M3 7L1 5l2-2M1 5h8a5 5 0 010 10H5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Undo
                </button>
              )}
              <SaveStatusIndicator saveStatus={ops.saveStatus} workspaces={ops.appState.workspaces} />
            </div>
          </div>

          {/* Filter bar */}
          {isSearching && (
            <div className="flex items-center gap-2 px-6 pb-2 flex-wrap">
              <span className="text-xs text-gray-400 dark:text-gray-500">Filter:</span>
              {(
                [
                  { key: 'overdue', label: 'Overdue' },
                  { key: 'dueToday', label: 'Due Today' },
                  { key: 'dueThisWeek', label: 'Due This Week' },
                  { key: 'incomplete', label: 'Incomplete' },
                  { key: 'completed', label: 'Completed' },
                ] as { key: FilterKey; label: string }[]
              ).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => toggleFilter(key)}
                  className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                    activeFilters.has(key)
                      ? 'bg-indigo-100 dark:bg-indigo-900/50 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300'
                      : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  {label}
                </button>
              ))}
              <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">Sort:</span>
              {(
                [
                  { key: 'value', label: 'Value' },
                  { key: 'complexity', label: 'Complexity' },
                  { key: 'dueDate', label: 'Due Date' },
                  { key: 'ratio', label: 'Value/Complexity' },
                ] as { key: SortKey; label: string }[]
              ).map(({ key, label }) => (
                <button
                  key={key as string}
                  onClick={() => setSortKey(sortKey === key ? null : key)}
                  className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                    sortKey === key
                      ? 'bg-purple-100 dark:bg-purple-900/50 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300'
                      : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Project title + estimation accuracy */}
          {!isSearching && (
            <div className="flex items-center gap-3 px-6 pb-3">
              <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
                {mainTitle}
              </h1>
              {estimationStats && estimationStats.count > 0 && (
                <ProjectEstimationBadge meanRatio={estimationStats.meanRatio} count={estimationStats.count} />
              )}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto px-6 py-4" style={{ minHeight: 0 }}>
          {isSearching ? (
            <div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
                {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
                {searchQuery && ` for "${searchQuery}"`}
              </p>
              <SmartView
                title="Search Results"
                tasks={searchResults}
                ops={ops}
                workspaceColorOf={workspaceColorOf}
                onOpenDetail={setDetailLocation}
              />
            </div>
          ) : activeSmartView ? (
            <SmartView
              title={smartViewLabels[activeSmartView]}
              tasks={smartViewTasks}
              ops={ops}
              workspaceColorOf={workspaceColorOf}
              onOpenDetail={setDetailLocation}
            />
          ) : activeProject && selectedProject ? (
            activeProject.layout === 'checklist' ? (
              <TaskList
                project={activeProject}
                workspaceId={selectedProject.workspaceId}
                projectIndex={selectedProject.projectIndex}
                onAddTask={ops.addTask}
                onUpdateTask={ops.updateTask}
                onDeleteTask={ops.deleteTask}
                onCompleteTask={ops.completeTask}
                onUncompleteTask={ops.uncompleteTask}
                onAddSubtask={ops.addSubtask}
                onUpdateSubtask={ops.updateSubtask}
                onReorderTask={ops.reorderTask}
                onOpenDetail={setDetailLocation}
                focusNewTaskSignal={focusNewTaskSignal}
              />
            ) : (
              <KanbanBoard
                project={activeProject}
                workspaceId={selectedProject.workspaceId}
                projectIndex={selectedProject.projectIndex}
                onAddTask={ops.addTask}
                onUpdateTask={ops.updateTask}
                onDeleteTask={ops.deleteTask}
                onCompleteTask={ops.completeTask}
                onUncompleteTask={ops.uncompleteTask}
                onAddSubtask={ops.addSubtask}
                onUpdateSubtask={ops.updateSubtask}
                onMoveTask={ops.moveTask}
                onAddColumn={ops.addColumn}
                onRenameColumn={ops.renameColumn}
                onReorderColumn={ops.reorderColumn}
                onOpenDetail={setDetailLocation}
              />
            )
          ) : (
            <EmptyState hasWorkspaces={ops.appState.workspaces.length > 0} />
          )}
        </div>

        {/* AI Chat Panel */}
        <AiChat
          appState={ops.appState}
          ops={ops}
          selectedWorkspaceId={selectedProject?.workspaceId}
          isOpen={aiChatOpen}
          onToggle={() => setAiChatOpen(v => !v)}
        />
      </main>

      {/* Task Detail Panel */}
      {detailTask && detailLocation && (
        <TaskDetailPanel
          task={detailTask}
          location={detailLocation}
          onUpdate={ops.updateTask}
          onClose={() => setDetailLocation(null)}
        />
      )}
    </div>
  );
}

function effortToMin(task: { effort?: { amount: number; unit: string } }): number {
  const e = task.effort;
  if (!e) return 0;
  if (e.unit === 'min') return e.amount;
  if (e.unit === 'hrs') return e.amount * 60;
  if (e.unit === 'days') return e.amount * 60 * 8;
  if (e.unit === 'wks') return e.amount * 60 * 8 * 5;
  return e.amount;
}

function ProjectEstimationBadge({ meanRatio, count }: { meanRatio: number; count: number }) {
  const pct = Math.round((meanRatio - 1) * 100);
  const label = pct === 0 ? 'On track' : pct > 0 ? `+${pct}% over` : `${Math.abs(pct)}% under`;
  const className =
    meanRatio <= 1.1
      ? 'text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-900/20 border-green-200 dark:border-green-800'
      : meanRatio <= 1.5
      ? 'text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
      : 'text-red-500 bg-red-50 dark:text-red-400 dark:bg-red-900/20 border-red-200 dark:border-red-800';
  return (
    <span
      className={`text-xs px-1.5 py-0.5 rounded border ${className}`}
      title={`Estimation accuracy from ${count} completed task${count !== 1 ? 's' : ''} (mean ratio: ${meanRatio.toFixed(2)})`}
    >
      {label}
    </span>
  );
}

function SaveStatusIndicator({
  saveStatus,
  workspaces,
}: {
  saveStatus: Record<string, SaveStatus>;
  workspaces: { config: { id: string } }[];
}) {
  const statuses = workspaces.map(w => saveStatus[w.config.id]).filter(Boolean);
  if (statuses.length === 0) return null;

  if (statuses.some(s => s === 'error')) {
    return <span className="text-xs text-red-500">Save error</span>;
  }
  if (statuses.some(s => s === 'saving')) {
    return <span className="text-xs text-gray-400 dark:text-gray-500">Saving...</span>;
  }
  return <span className="text-xs text-green-500 dark:text-green-400">Saved</span>;
}

function EmptyState({ hasWorkspaces }: { hasWorkspaces: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-16">
      <svg
        className="w-12 h-12 text-gray-200 dark:text-gray-700 mb-4"
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="8" y="8" width="32" height="32" rx="4" />
        <path d="M16 18h16M16 24h10M16 30h12" strokeLinecap="round" />
      </svg>
      <p className="text-gray-400 dark:text-gray-500 text-sm">
        {hasWorkspaces ? 'Select a project from the sidebar' : 'Create a workspace to get started'}
      </p>
    </div>
  );
}

function ExternalChangeNotification({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-blue-50 dark:bg-blue-900 border border-blue-200 dark:border-blue-700 text-blue-800 dark:text-blue-100 text-sm px-4 py-2 rounded-lg shadow-lg">
      <span>{message}</span>
      <button
        onClick={onDismiss}
        className="text-blue-500 dark:text-blue-300 hover:text-blue-700 dark:hover:text-blue-100 leading-none"
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  );
}

export default function App({ storage }: { storage?: AppStorage }) {
  return (
    <StorageProvider storage={storage}>
      <AppShell />
    </StorageProvider>
  );
}
