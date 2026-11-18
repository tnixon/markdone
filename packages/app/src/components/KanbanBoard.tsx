import React, { useState, useEffect } from 'react';
import type { Project, Effort, TaskLocation, SubtaskLocation, NewTaskInput, TaskFields } from '@markdone/core';
import { getColumns, getColumnTasks } from '@markdone/core';
import TaskItem from './TaskItem';

interface KanbanBoardProps {
  project: Extract<Project, { layout: 'kanban' }>;
  workspaceId: string;
  projectIndex: number;
  onAddTask: (workspaceId: string, projectIndex: number, columnIndex: number, task: NewTaskInput) => void;
  onUpdateTask: (location: TaskLocation, changes: Partial<TaskFields>) => void;
  onDeleteTask: (location: TaskLocation) => void;
  onCompleteTask: (location: TaskLocation, actual?: { duration?: Effort }) => void;
  onUncompleteTask: (location: TaskLocation) => void;
  onAddSubtask: (parentLocation: TaskLocation, subtask: NewTaskInput) => void;
  onUpdateSubtask: (location: SubtaskLocation, changes: Partial<TaskFields>) => void;
  onMoveTask: (from: TaskLocation, to: TaskLocation) => void;
  onAddColumn: (workspaceId: string, projectIndex: number, name: string) => void;
  onRenameColumn: (workspaceId: string, projectIndex: number, columnIndex: number, name: string) => void;
  onReorderColumn: (workspaceId: string, projectIndex: number, columnIndex: number, newIndex: number) => void;
  onOpenDetail: (location: TaskLocation) => void;
}

export default function KanbanBoard({
  project,
  workspaceId,
  projectIndex,
  onAddTask,
  onUpdateTask,
  onDeleteTask,
  onCompleteTask,
  onUncompleteTask,
  onAddSubtask,
  onUpdateSubtask,
  onMoveTask,
  onAddColumn,
  onRenameColumn,
  onReorderColumn,
  onOpenDetail,
}: KanbanBoardProps) {
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [dragging, setDragging] = useState<TaskLocation | null>(null);
  const [dragOver, setDragOver] = useState<{ colIndex: number; taskIndex: number } | null>(null);
  const [draggingCol, setDraggingCol] = useState<number | null>(null);
  const [dragOverCol, setDragOverCol] = useState<number | null>(null);

  function handleDragStart(e: React.DragEvent, location: TaskLocation) {
    setDragging(location);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e: React.DragEvent, colIndex: number, taskIndex: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver({ colIndex, taskIndex });
  }

  function handleDrop(e: React.DragEvent, colIndex: number, taskIndex: number) {
    e.preventDefault();
    if (!dragging) return;

    const to: TaskLocation = {
      workspaceId,
      projectIndex,
      columnIndex: colIndex,
      taskIndex,
    };

    if (
      dragging.columnIndex !== colIndex ||
      dragging.taskIndex !== taskIndex
    ) {
      onMoveTask(dragging, to);
    }

    setDragging(null);
    setDragOver(null);
  }

  function handleDragEnd() {
    setDragging(null);
    setDragOver(null);
  }

  function handleColDragStart(e: React.DragEvent, colIndex: number) {
    setDraggingCol(colIndex);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleColDragOver(e: React.DragEvent, colIndex: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggingCol !== null && draggingCol !== colIndex) {
      setDragOverCol(colIndex);
    }
  }

  function handleColDrop(e: React.DragEvent, colIndex: number) {
    e.preventDefault();
    if (draggingCol !== null && draggingCol !== colIndex) {
      onReorderColumn(workspaceId, projectIndex, draggingCol, colIndex);
    }
    setDraggingCol(null);
    setDragOverCol(null);
  }

  function handleColDragEnd() {
    setDraggingCol(null);
    setDragOverCol(null);
  }

  function handleAddColumn() {
    const trimmed = newColumnName.trim();
    if (trimmed) {
      onAddColumn(workspaceId, projectIndex, trimmed);
    }
    setNewColumnName('');
    setAddingColumn(false);
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {getColumns(project).map((section, colIndex) => (
        <KanbanColumn
          key={section.name}
          column={{ name: section.name, tasks: getColumnTasks(section) }}
          colIndex={colIndex}
          workspaceId={workspaceId}
          projectIndex={projectIndex}
          dragging={dragging}
          dragOver={dragOver}
          draggingCol={draggingCol}
          dragOverCol={dragOverCol}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
          onColDragStart={handleColDragStart}
          onColDragOver={handleColDragOver}
          onColDrop={handleColDrop}
          onColDragEnd={handleColDragEnd}
          onAddTask={(_colIdx, task) => onAddTask(workspaceId, projectIndex, colIndex, task)}
          onUpdateTask={onUpdateTask}
          onDeleteTask={onDeleteTask}
          onCompleteTask={onCompleteTask}
          onUncompleteTask={onUncompleteTask}
          onAddSubtask={onAddSubtask}
          onUpdateSubtask={onUpdateSubtask}
          onRenameColumn={name => onRenameColumn(workspaceId, projectIndex, colIndex, name)}
          onOpenDetail={onOpenDetail}
        />
      ))}

      {/* Add column */}
      <div className="flex-shrink-0 w-64">
        {addingColumn ? (
          <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3">
            <input
              autoFocus
              value={newColumnName}
              onChange={e => setNewColumnName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAddColumn();
                if (e.key === 'Escape') setAddingColumn(false);
              }}
              onBlur={handleAddColumn}
              placeholder="Column name..."
              className="w-full text-sm bg-transparent outline-none border-b border-gray-300 dark:border-gray-600"
            />
          </div>
        ) : (
          <button
            onClick={() => setAddingColumn(true)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M8 3v10M3 8h10" strokeLinecap="round" />
            </svg>
            Add column
          </button>
        )}
      </div>
    </div>
  );
}

interface KanbanColumnProps {
  column: { name: string; tasks: import('@markdone/core').Task[] };
  colIndex: number;
  workspaceId: string;
  projectIndex: number;
  dragging: TaskLocation | null;
  dragOver: { colIndex: number; taskIndex: number } | null;
  draggingCol: number | null;
  dragOverCol: number | null;
  onDragStart: (e: React.DragEvent, location: TaskLocation) => void;
  onDragOver: (e: React.DragEvent, colIndex: number, taskIndex: number) => void;
  onDrop: (e: React.DragEvent, colIndex: number, taskIndex: number) => void;
  onDragEnd: () => void;
  onColDragStart: (e: React.DragEvent, colIndex: number) => void;
  onColDragOver: (e: React.DragEvent, colIndex: number) => void;
  onColDrop: (e: React.DragEvent, colIndex: number) => void;
  onColDragEnd: () => void;
  onAddTask: (colIndex: number, task: NewTaskInput) => void;
  onUpdateTask: (location: TaskLocation, changes: Partial<TaskFields>) => void;
  onDeleteTask: (location: TaskLocation) => void;
  onCompleteTask: (location: TaskLocation, actual?: { duration?: Effort }) => void;
  onUncompleteTask: (location: TaskLocation) => void;
  onAddSubtask: (parentLocation: TaskLocation, subtask: NewTaskInput) => void;
  onUpdateSubtask: (location: SubtaskLocation, changes: Partial<TaskFields>) => void;
  onRenameColumn: (name: string) => void;
  onOpenDetail: (location: TaskLocation) => void;
}

function KanbanColumn({
  column,
  colIndex,
  workspaceId,
  projectIndex,
  dragging,
  dragOver,
  draggingCol,
  dragOverCol,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onColDragStart,
  onColDragOver,
  onColDrop,
  onColDragEnd,
  onAddTask,
  onUpdateTask,
  onDeleteTask,
  onCompleteTask,
  onUncompleteTask,
  onAddSubtask,
  onUpdateSubtask,
  onRenameColumn,
  onOpenDetail,
}: KanbanColumnProps) {
  const [newTaskText, setNewTaskText] = useState('');
  const [isEditingHeader, setIsEditingHeader] = useState(false);
  const [headerText, setHeaderText] = useState(column.name);

  // Sync headerText when column name changes externally (while not editing)
  useEffect(() => {
    if (!isEditingHeader) {
      setHeaderText(column.name);
    }
  }, [column.name, isEditingHeader]);

  function handleAddTask() {
    const trimmed = newTaskText.trim();
    if (!trimmed) return;
    onAddTask(colIndex, { text: trimmed });
    setNewTaskText('');
  }

  function handleRenameColumn() {
    const trimmed = headerText.trim();
    if (trimmed && trimmed !== column.name) {
      onRenameColumn(trimmed);
    } else {
      setHeaderText(column.name);
    }
    setIsEditingHeader(false);
  }

  const incompleteTasks = column.tasks
    .map((task, taskIndex) => ({ task, taskIndex }))
    .filter(({ task }) => !task.completed);
  const completedTasks = column.tasks
    .map((task, taskIndex) => ({ task, taskIndex }))
    .filter(({ task }) => task.completed);

  const isColDragging = draggingCol === colIndex;
  const isColDropTarget = dragOverCol === colIndex && draggingCol !== null && draggingCol !== colIndex;

  return (
    <div
      className={`flex-shrink-0 w-64 bg-gray-50 dark:bg-gray-800/50 rounded-lg flex flex-col transition-opacity ${
        isColDragging ? 'opacity-40' : 'opacity-100'
      } ${isColDropTarget ? 'ring-2 ring-indigo-400 dark:ring-indigo-500' : ''}`}
      onDragOver={e => {
        if (draggingCol !== null) onColDragOver(e, colIndex);
        else onDragOver(e, colIndex, column.tasks.length);
      }}
      onDrop={e => {
        if (draggingCol !== null) onColDrop(e, colIndex);
        else onDrop(e, colIndex, column.tasks.length);
      }}
    >
      {/* Column header */}
      <div
        className="px-3 py-2 border-b border-gray-200 dark:border-gray-700"
        draggable={!isEditingHeader}
        onDragStart={e => { if (!isEditingHeader) onColDragStart(e, colIndex); }}
        onDragEnd={onColDragEnd}
      >
        {isEditingHeader ? (
          <input
            autoFocus
            value={headerText}
            onChange={e => setHeaderText(e.target.value)}
            onBlur={handleRenameColumn}
            onKeyDown={e => {
              if (e.key === 'Enter') handleRenameColumn();
              if (e.key === 'Escape') { setHeaderText(column.name); setIsEditingHeader(false); }
            }}
            className="w-full text-sm font-medium bg-transparent outline-none border-b border-indigo-500"
          />
        ) : (
          <div className="flex items-center justify-between cursor-grab">
            <button
              onClick={() => setIsEditingHeader(true)}
              onMouseDown={e => e.stopPropagation()}
              className="text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
            >
              {column.name}
            </button>
            <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">
              {incompleteTasks.length}
            </span>
          </div>
        )}
      </div>

      {/* Tasks */}
      <div className="flex-1 p-2 flex flex-col gap-1 min-h-16">
        {incompleteTasks.map(({ task, taskIndex }) => {
          const location: TaskLocation = { workspaceId, projectIndex, columnIndex: colIndex, taskIndex };
          const isDraggingThis = dragging?.columnIndex === colIndex && dragging?.taskIndex === taskIndex;
          const isDropTarget = dragOver?.colIndex === colIndex && dragOver?.taskIndex === taskIndex;

          return (
            <div
              key={task.id}
              draggable
              onDragStart={e => onDragStart(e, location)}
              onDragEnd={onDragEnd}
              onDragOver={e => onDragOver(e, colIndex, taskIndex)}
              onDrop={e => onDrop(e, colIndex, taskIndex)}
              className={`bg-white dark:bg-gray-800 rounded-md shadow-sm border border-gray-200 dark:border-gray-700 cursor-grab transition-opacity ${
                isDraggingThis ? 'opacity-40' : 'opacity-100'
              } ${isDropTarget ? 'border-indigo-400 dark:border-indigo-500' : ''}`}
            >
              <TaskItem
                task={task}
                location={location}
                onComplete={onCompleteTask}
                onUncomplete={onUncompleteTask}
                onUpdate={onUpdateTask}
                onDelete={onDeleteTask}
                onAddSubtask={onAddSubtask}
                onUpdateSubtask={onUpdateSubtask}
                onOpenDetail={onOpenDetail}
              />
            </div>
          );
        })}

        {/* Completed tasks (collapsed) */}
        {completedTasks.length > 0 && (
          <div className="mt-1">
            {completedTasks.map(({ task, taskIndex }) => {
              const location: TaskLocation = { workspaceId, projectIndex, columnIndex: colIndex, taskIndex };
              return (
                <div key={task.id} className="opacity-50">
                  <TaskItem
                    task={task}
                    location={location}
                    onComplete={onCompleteTask}
                    onUncomplete={onUncompleteTask}
                    onUpdate={onUpdateTask}
                    onDelete={onDeleteTask}
                    onAddSubtask={onAddSubtask}
                    onUpdateSubtask={onUpdateSubtask}
                    onOpenDetail={onOpenDetail}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add task input */}
      <div className="p-2 border-t border-gray-200 dark:border-gray-700">
        <input
          value={newTaskText}
          onChange={e => setNewTaskText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') handleAddTask();
          }}
          placeholder="Add task..."
          className="w-full text-sm bg-transparent outline-none placeholder-gray-400 dark:placeholder-gray-600 text-gray-700 dark:text-gray-300"
        />
      </div>
    </div>
  );
}
