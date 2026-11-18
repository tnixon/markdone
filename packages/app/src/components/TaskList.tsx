import React, { useState, useRef, useEffect } from 'react';
import type { Project, Effort, TaskLocation, SubtaskLocation, NewTaskInput, TaskFields } from '@markdone/core';
import { getTasks } from '@markdone/core';
import TaskItem from './TaskItem';

function isInputFocused(): boolean {
  const tag = document.activeElement?.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

interface TaskListProps {
  project: Extract<Project, { layout: 'checklist' }>;
  workspaceId: string;
  projectIndex: number;
  onAddTask: (workspaceId: string, projectIndex: number, columnIndex: undefined, task: NewTaskInput) => void;
  onUpdateTask: (location: TaskLocation, changes: Partial<TaskFields>) => void;
  onDeleteTask: (location: TaskLocation) => void;
  onCompleteTask: (location: TaskLocation, actual?: { duration?: Effort }) => void;
  onUncompleteTask: (location: TaskLocation) => void;
  onAddSubtask: (parentLocation: TaskLocation, subtask: NewTaskInput) => void;
  onUpdateSubtask: (location: SubtaskLocation, changes: Partial<TaskFields>) => void;
  onReorderTask: (location: TaskLocation, newIndex: number) => void;
  onOpenDetail: (location: TaskLocation) => void;
  focusNewTaskSignal?: number;
}

export default function TaskList({
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
  onReorderTask,
  onOpenDetail,
  focusNewTaskSignal = 0,
}: TaskListProps) {
  const [newTaskText, setNewTaskText] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const newTaskInputRef = useRef<HTMLInputElement>(null);

  // Focus new task input when signal fires
  useEffect(() => {
    if (focusNewTaskSignal > 0) {
      newTaskInputRef.current?.focus();
    }
  }, [focusNewTaskSignal]);

  const projectTasks = getTasks(project);
  const incomplete = projectTasks
    .map((task, taskIndex) => ({ task, taskIndex }))
    .filter(({ task }) => !task.completed);
  const completed = projectTasks
    .map((task, taskIndex) => ({ task, taskIndex }))
    .filter(({ task }) => task.completed);

  function handleAddTask() {
    const trimmed = newTaskText.trim();
    if (!trimmed) return;
    onAddTask(workspaceId, projectIndex, undefined, { text: trimmed });
    setNewTaskText('');
  }

  // Drag-and-drop handlers for task reorder
  function handleDragStart(e: React.DragEvent, visualIndex: number) {
    setDraggingIndex(visualIndex);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e: React.DragEvent, visualIndex: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(visualIndex);
  }

  function handleDrop(e: React.DragEvent, visualIndex: number) {
    e.preventDefault();
    if (draggingIndex === null || draggingIndex === visualIndex) {
      setDraggingIndex(null);
      setDragOverIndex(null);
      return;
    }

    const fromTaskIndex = incomplete[draggingIndex].taskIndex;
    const toTaskIndex = incomplete[visualIndex].taskIndex;
    const location: TaskLocation = { workspaceId, projectIndex, taskIndex: fromTaskIndex };
    onReorderTask(location, toTaskIndex);

    setDraggingIndex(null);
    setDragOverIndex(null);
  }

  function handleDragEnd() {
    setDraggingIndex(null);
    setDragOverIndex(null);
  }

  // Keyboard reorder: Cmd/Ctrl+↑/↓ on selected task
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isInputFocused()) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (!selectedTaskId) return;

      const selectedVisualIndex = incomplete.findIndex(({ task }) => task.id === selectedTaskId);
      if (selectedVisualIndex === -1) return;

      e.preventDefault();

      if (e.key === 'ArrowUp' && selectedVisualIndex > 0) {
        const fromTaskIndex = incomplete[selectedVisualIndex].taskIndex;
        const toTaskIndex = incomplete[selectedVisualIndex - 1].taskIndex;
        const location: TaskLocation = { workspaceId, projectIndex, taskIndex: fromTaskIndex };
        onReorderTask(location, toTaskIndex);
      } else if (e.key === 'ArrowDown' && selectedVisualIndex < incomplete.length - 1) {
        const fromTaskIndex = incomplete[selectedVisualIndex].taskIndex;
        const toTaskIndex = incomplete[selectedVisualIndex + 1].taskIndex;
        const location: TaskLocation = { workspaceId, projectIndex, taskIndex: fromTaskIndex };
        onReorderTask(location, toTaskIndex);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedTaskId, incomplete, workspaceId, projectIndex, onReorderTask]);

  return (
    <div className="flex flex-col gap-1">
      {/* Incomplete tasks */}
      {incomplete.map(({ task, taskIndex }, visualIndex) => {
        const location: TaskLocation = { workspaceId, projectIndex, taskIndex };
        const isDragging = draggingIndex === visualIndex;
        const isDropTarget = dragOverIndex === visualIndex;
        const isSelected = selectedTaskId === task.id;

        return (
          <div
            key={task.id}
            draggable
            onDragStart={e => handleDragStart(e, visualIndex)}
            onDragOver={e => handleDragOver(e, visualIndex)}
            onDrop={e => handleDrop(e, visualIndex)}
            onDragEnd={handleDragEnd}
            onClick={() => setSelectedTaskId(isSelected ? null : task.id)}
            className={`rounded transition-opacity ${isDragging ? 'opacity-40' : 'opacity-100'} ${
              isDropTarget ? 'ring-2 ring-indigo-400 dark:ring-indigo-500' : ''
            } ${isSelected ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''}`}
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

      {/* Add task input */}
      <div className="flex items-center gap-2 px-2 py-1.5 mt-1">
        <div className="w-4 h-4 flex-shrink-0 rounded border border-dashed border-gray-300 dark:border-gray-600" />
        <input
          ref={newTaskInputRef}
          value={newTaskText}
          onChange={e => setNewTaskText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') handleAddTask();
            if (e.key === 'Escape') { setNewTaskText(''); newTaskInputRef.current?.blur(); }
          }}
          placeholder="Add a task..."
          className="flex-1 text-sm bg-transparent outline-none text-gray-500 dark:text-gray-400 placeholder-gray-400 dark:placeholder-gray-600"
        />
      </div>

      {/* Completed tasks toggle */}
      {completed.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowCompleted(v => !v)}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg
              className={`w-3 h-3 transition-transform ${showCompleted ? 'rotate-90' : ''}`}
              viewBox="0 0 12 12"
              fill="currentColor"
            >
              <path d="M4 2l4 4-4 4" />
            </svg>
            {completed.length} completed
          </button>

          {showCompleted && completed.map(({ task, taskIndex }) => (
            <TaskItem
              key={task.id}
              task={task}
              location={{ workspaceId, projectIndex, taskIndex }}
              onComplete={onCompleteTask}
              onUncomplete={onUncompleteTask}
              onUpdate={onUpdateTask}
              onDelete={onDeleteTask}
              onAddSubtask={onAddSubtask}
              onUpdateSubtask={onUpdateSubtask}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </div>
      )}
    </div>
  );
}
