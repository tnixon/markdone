// Core types
export type {
  TaskLocation,
  SubtaskLocation,
  TaskAddress,
  TaskRef,
  SubtaskRef,
  Result,
  OperationContext,
  OperationError,
  ActionRecord,
  NewTaskInput,
  TaskFields,
  JSONSchema,
  OperationDefinition,
  MutationDefinition,
  QueryDefinition,
  AnthropicTool,
} from './types';

// Task operations
export {
  addTask,
  updateTask,
  deleteTask,
  completeTask,
  uncompleteTask,
  cancelTask,
  moveTask,
  reorderTask,
  addSubtask,
  updateSubtask,
  deleteSubtask,
  assignTaskIds,
  generateBlockId,
} from './taskOps';

// Project operations
export {
  addProject,
  updateProject,
  deleteProject,
  reorderProject,
  addColumn,
  renameColumn,
  deleteColumn,
  reorderColumn,
} from './projectOps';

export { localDateString } from './utils';

// Query operations
export {
  getOverdueTasks,
  getTasksDueInRange,
  getTasksByContext,
  getTasksByTag,
  getNextActions,
  getEstimationAccuracy,
  searchTasks,
  listTasks,
  getWaitingFor,
  score,
  scoreTaskAt,
  withScores,
  slackDays,
} from './queryOps';

export type {
  TaskWithLocation,
  ScoredTaskWithLocation,
  EstimationAccuracyStats,
  EstimationBucket,
  ListTasksFilters,
  TaskScore,
} from './queryOps';

// Batch operations
export { applyBatch } from './batchOps';
export { resolveCompletionColumn, completionColumnIndex } from './workflow';
export type { CompletionColumn } from './workflow';
export { nextOccurrence, isValidRecurrenceRule } from './recurrence';
export type { BatchOperation } from './batchOps';

// Operation registry
export { operationRegistry, operationsByName, getOperation, runOperation, toAnthropicTools, toMarkdownReference } from './registry';
