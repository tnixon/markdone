import type { AppState, Task, Project, TodoFile, Effort, Actual } from '../model/types';
import type { TaskLocation, TaskRef, SubtaskRef, Result, NewTaskInput, TaskFields } from './types';
import { ok, err, localToday, resolveWorkspace, resolveProject, updateWorkspace, resolveTaskRef, resolveSubtaskRef } from './utils';
import { getTasks, setTasks, getColumns, getColumnTasks, setColumnTasks, getRecurrence } from '../model/accessors';
import { completionColumnIndex } from './workflow';
import { nextOccurrence } from './recurrence';

// ---- Helpers ----

function generateId(): string {
  return `task-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

// Charset per spec (Block IDs): letters, digits, hyphens, 1-64 chars.
export function generateBlockId(existing: ReadonlySet<string>): string {
  let id: string;
  do {
    id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  } while (existing.has(id));
  return id;
}

// Every `^id` currently in use in this workspace, top-level tasks and
// subtasks alike, across every project (including kanban auxiliary
// sections — a task doesn't stop needing a unique id just because it isn't
// addressable via `columnIndex` today). Used to avoid handing out a
// colliding id when auto-assigning one.
function collectBlockIds(todoFile: TodoFile): Set<string> {
  const ids = new Set<string>();
  function visit(task: Task): void {
    if (task.blockId) ids.add(task.blockId);
    task.subtasks.forEach(visit);
  }
  function visitProject(project: Project): void {
    if (project.layout === 'checklist') {
      getTasks(project).forEach(visit);
      return;
    }
    for (const section of project.sections) {
      if (section.kind !== 'opaque') getColumnTasks(section).forEach(visit);
    }
  }
  todoFile.projects.forEach(visitProject);
  return ids;
}

function newTaskFromInput(input: NewTaskInput, blockId?: string): Task {
  return {
    id: generateId(),
    text: input.text,
    checkbox: { state: 'open', marker: ' ' },
    completed: false,
    contexts: input.contexts ?? [],
    tags: input.tags ?? [],
    subtasks: [],
    ...(blockId !== undefined && { blockId }),
    ...(input.dueDate !== undefined && { dueDate: input.dueDate }),
    ...(input.value !== undefined && { value: input.value }),
    ...(input.complexity !== undefined && { complexity: input.complexity }),
    ...(input.effort !== undefined && { effort: input.effort }),
  };
}

function resolveTaskList(project: Project, columnIndex?: number): Result<Task[]> {
  if (project.layout === 'checklist') {
    if (columnIndex !== undefined) {
      return err('NOT_KANBAN_PROJECT', 'Cannot specify columnIndex on a checklist project');
    }
    return ok(getTasks(project));
  }
  const columns = getColumns(project);
  const ci = columnIndex ?? 0;
  if (ci < 0 || ci >= columns.length) {
    return err('COLUMN_NOT_FOUND', `Column at index ${ci} not found`);
  }
  return ok(getColumnTasks(columns[ci]));
}

function setTasksAt(
  todoFile: TodoFile,
  projectIndex: number,
  columnIndex: number | undefined,
  newTasks: Task[],
): TodoFile {
  const project = todoFile.projects[projectIndex];
  let newProject: Project;

  if (project.layout === 'checklist') {
    newProject = setTasks(project, newTasks);
  } else {
    const columns = getColumns(project);
    const ci = columnIndex ?? 0;
    const targetName = columns[ci].name;
    const exists = project.sections.some(s => s.kind === 'column' && s.name === targetName);
    const sections = exists
      ? project.sections.map(s =>
          s.kind === 'column' && s.name === targetName ? { ...s, blocks: setColumnTasks(s, newTasks).blocks } : s,
        )
      : [...project.sections, { kind: 'column' as const, name: targetName, blocks: newTasks.map(t => ({ type: 'task' as const, task: t })) }];
    newProject = { ...project, sections };
  }

  return {
    ...todoFile,
    projects: todoFile.projects.map((p, i) => (i === projectIndex ? newProject : p)),
  };
}

// ---- Task Operations ----

export function addTask(
  state: AppState,
  workspaceId: string,
  projectIndex: number,
  columnIndex: number | undefined,
  task: NewTaskInput,
  assignId = true,
): Result<AppState> {
  const wsResult = resolveWorkspace(state, workspaceId);
  if (!wsResult.ok) return wsResult;

  const projResult = resolveProject(wsResult.value.workspace, projectIndex);
  if (!projResult.ok) return projResult;

  const listResult = resolveTaskList(projResult.value, columnIndex);
  if (!listResult.ok) return listResult;

  const blockId = assignId ? generateBlockId(collectBlockIds(wsResult.value.workspace.todoFile)) : undefined;
  const newTask = newTaskFromInput(task, blockId);
  const newTasks = [...listResult.value, newTask];
  const effectiveColumnIndex =
    projResult.value.layout === 'kanban' ? (columnIndex ?? 0) : undefined;
  const newTodoFile = setTasksAt(
    wsResult.value.workspace.todoFile,
    projectIndex,
    effectiveColumnIndex,
    newTasks,
  );

  return ok(updateWorkspace(state, workspaceId, newTodoFile));
}

const BLOCK_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

// A `blockId` change must keep the spec's charset and workspace-wide
// uniqueness. `current` is the task's own id, which may be re-set unchanged.
function validateBlockIdChange(todoFile: TodoFile, changes: Partial<TaskFields>, current: string | undefined): Result<null> {
  if (changes.blockId === undefined || changes.blockId === current) return ok(null);
  if (!BLOCK_ID_RE.test(changes.blockId)) {
    return err('INVALID_BLOCK_ID', `Block id '${changes.blockId}' must be 1-64 letters, digits, or hyphens`);
  }
  if (collectBlockIds(todoFile).has(changes.blockId)) {
    return err('DUPLICATE_TASK_ID', `Block id '${changes.blockId}' is already used in this workspace`);
  }
  return ok(null);
}

export function updateTask(
  state: AppState,
  locationRef: TaskRef,
  changes: Partial<TaskFields>,
): Result<AppState> {
  const locResult = resolveTaskRef(state, locationRef);
  if (!locResult.ok) return locResult;
  const location = locResult.value;

  const wsResult = resolveWorkspace(state, location.workspaceId);
  if (!wsResult.ok) return wsResult;

  const projResult = resolveProject(wsResult.value.workspace, location.projectIndex);
  if (!projResult.ok) return projResult;

  const listResult = resolveTaskList(projResult.value, location.columnIndex);
  if (!listResult.ok) return listResult;

  if (location.taskIndex < 0 || location.taskIndex >= listResult.value.length) {
    return err('TASK_NOT_FOUND', `Task at index ${location.taskIndex} not found`);
  }

  const oldTask = listResult.value[location.taskIndex];
  const idCheck = validateBlockIdChange(wsResult.value.workspace.todoFile, changes, oldTask.blockId);
  if (!idCheck.ok) return idCheck;
  const updatedTask: Task = { ...oldTask, ...changes };

  const newTasks = listResult.value.map((t, i) => (i === location.taskIndex ? updatedTask : t));
  const newTodoFile = setTasksAt(
    wsResult.value.workspace.todoFile,
    location.projectIndex,
    location.columnIndex,
    newTasks,
  );

  return ok(updateWorkspace(state, location.workspaceId, newTodoFile));
}

export function deleteTask(state: AppState, locationRef: TaskRef): Result<AppState> {
  const locResult = resolveTaskRef(state, locationRef);
  if (!locResult.ok) return locResult;
  const location = locResult.value;

  const wsResult = resolveWorkspace(state, location.workspaceId);
  if (!wsResult.ok) return wsResult;

  const projResult = resolveProject(wsResult.value.workspace, location.projectIndex);
  if (!projResult.ok) return projResult;

  const listResult = resolveTaskList(projResult.value, location.columnIndex);
  if (!listResult.ok) return listResult;

  if (location.taskIndex < 0 || location.taskIndex >= listResult.value.length) {
    return err('TASK_NOT_FOUND', `Task at index ${location.taskIndex} not found`);
  }

  const newTasks = listResult.value.filter((_, i) => i !== location.taskIndex);
  const newTodoFile = setTasksAt(
    wsResult.value.workspace.todoFile,
    location.projectIndex,
    location.columnIndex,
    newTasks,
  );

  return ok(updateWorkspace(state, location.workspaceId, newTodoFile));
}

// ---- Checkbox transitions (complete / uncomplete / cancel) ----
//
// One implementation for all three so the workflow rule (spec: "Workflow:
// on-complete") can't drift between them. Rules fire here, in operations,
// never from parsing or file watching.

type Transition = 'complete' | 'uncomplete' | 'cancel';

function applyTransition(task: Task, transition: Transition, today: string, actual?: { duration?: Effort }): Task {
  if (transition === 'uncomplete') {
    // Calling this on an already-open task is a no-op for completion; any
    // existing `&` is preserved.
    return { ...task, completed: false, checkbox: { state: 'open', marker: ' ' } };
  }
  if (transition === 'cancel') {
    return { ...task, completed: false, checkbox: { state: 'cancelled', marker: '-' } };
  }
  // A start date recorded by moveTask (an `&` with only a completion date) is
  // promoted to the start of the finished range. Completing an already-done
  // task is allowed and overwrites its `&`.
  const completionDate = today;
  const completedActual: Actual = task.actual
    ? { startDate: task.actual.completionDate, completionDate }
    : { completionDate };
  if (actual?.duration) completedActual.duration = actual.duration;
  return { ...task, completed: true, checkbox: { state: 'done', marker: 'x' }, actual: completedActual };
}

// The next open instance of a recurring task (spec: "#every/<rule>"): same
// description and tokens, next date, fresh `^id`, no `&`, subtasks reopened.
function spawnNextInstance(task: Task, todoFile: TodoFile, today: string): Task | undefined {
  const rule = getRecurrence(task);
  if (!rule) return undefined;
  const base = task.dueDate ?? task.deferDate ?? today;
  const next = nextOccurrence(rule, base);
  if (!next) return undefined;

  const reopen = (t: Task): Task => {
    const { blockId: _blockId, actual: _actual, ...rest } = t;
    return { ...rest, id: generateId(), completed: false, checkbox: { state: 'open', marker: ' ' }, subtasks: t.subtasks.map(reopen) };
  };
  const instance = reopen(task);
  // The due date carries the schedule when there is one; otherwise the defer
  // date does. Both advance by the same step. A task with neither gets a due
  // date of `next` (from today), so the recurrence is visible rather than
  // producing an identical, undated copy.
  if (task.dueDate || !task.deferDate) instance.dueDate = next;
  if (task.deferDate) instance.deferDate = task.dueDate ? (nextOccurrence(rule, task.deferDate) ?? task.deferDate) : next;
  instance.blockId = generateBlockId(collectBlockIds(todoFile));
  return instance;
}

function transitionSubtask(state: AppState, ref: SubtaskRef, transition: Transition, today: string, actual?: { duration?: Effort }): Result<AppState> {
  const locResult = resolveSubtaskRef(state, ref);
  if (!locResult.ok) return locResult;
  const location = locResult.value;

  const wsResult = resolveWorkspace(state, location.workspaceId);
  if (!wsResult.ok) return wsResult;
  const projResult = resolveProject(wsResult.value.workspace, location.projectIndex);
  if (!projResult.ok) return projResult;
  const listResult = resolveTaskList(projResult.value, location.columnIndex);
  if (!listResult.ok) return listResult;

  const parent = listResult.value[location.taskIndex];
  const subtask = parent?.subtasks[location.subtaskIndex];
  if (!parent || !subtask) return err('SUBTASK_NOT_FOUND', `Subtask at index ${location.subtaskIndex} not found`);

  // A subtask never moves between columns — it travels with its parent.
  const updatedParent: Task = {
    ...parent,
    subtasks: parent.subtasks.map((st, i) => (i === location.subtaskIndex ? applyTransition(st, transition, today, actual) : st)),
  };
  const newTasks = listResult.value.map((t, i) => (i === location.taskIndex ? updatedParent : t));
  const newTodoFile = setTasksAt(wsResult.value.workspace.todoFile, location.projectIndex, location.columnIndex, newTasks);
  return ok(updateWorkspace(state, location.workspaceId, newTodoFile));
}

function transitionTask(
  state: AppState,
  locationRef: TaskRef,
  transition: Transition,
  actual?: { duration?: Effort },
  today: string = localToday(),
): Result<AppState> {
  const locResult = resolveTaskRef(state, locationRef);
  if (!locResult.ok) {
    // A `^id` that names a subtask rather than a top-level task.
    if ('taskId' in locationRef && locResult.error.code === 'TASK_NOT_FOUND') {
      const sub = transitionSubtask(state, locationRef, transition, today, actual);
      if (sub.ok) return sub;
    }
    return locResult;
  }
  const location = locResult.value;

  const wsResult = resolveWorkspace(state, location.workspaceId);
  if (!wsResult.ok) return wsResult;

  const projResult = resolveProject(wsResult.value.workspace, location.projectIndex);
  if (!projResult.ok) return projResult;

  const listResult = resolveTaskList(projResult.value, location.columnIndex);
  if (!listResult.ok) return listResult;

  if (location.taskIndex < 0 || location.taskIndex >= listResult.value.length) {
    return err('TASK_NOT_FOUND', `Task at index ${location.taskIndex} not found`);
  }

  const todoFile = wsResult.value.workspace.todoFile;
  const task = listResult.value[location.taskIndex];
  const updated = applyTransition(task, transition, today, actual);
  const spawned = transition === 'complete' && task.checkbox.state === 'open' ? spawnNextInstance(task, todoFile, today) : undefined;

  // Where the finished/reopened task goes (spec: "Workflow: on-complete").
  const completionIndex = completionColumnIndex(projResult.value);
  const currentColumn = location.columnIndex ?? 0;
  let destination: number | undefined;
  if (completionIndex !== undefined) {
    if (transition !== 'uncomplete' && currentColumn !== completionIndex) destination = completionIndex;
    if (transition === 'uncomplete' && currentColumn === completionIndex && completionIndex !== 0) destination = 0;
  }

  if (destination === undefined) {
    const tasks = listResult.value.map((t, i) => (i === location.taskIndex ? updated : t));
    // The new instance follows the completed one (spec's recommended behavior).
    if (spawned) tasks.splice(location.taskIndex + 1, 0, spawned);
    const newTodoFile = setTasksAt(todoFile, location.projectIndex, location.columnIndex, tasks);
    return ok(updateWorkspace(state, location.workspaceId, newTodoFile));
  }

  const sourceTasks = listResult.value.filter((_, i) => i !== location.taskIndex);
  // The new instance takes the completed one's old position.
  if (spawned) sourceTasks.splice(location.taskIndex, 0, spawned);
  const afterRemove = setTasksAt(todoFile, location.projectIndex, location.columnIndex, sourceTasks);

  const destList = resolveTaskList(afterRemove.projects[location.projectIndex], destination);
  if (!destList.ok) return destList;
  const finalFile = setTasksAt(afterRemove, location.projectIndex, destination, [updated, ...destList.value]);
  return ok(updateWorkspace(state, location.workspaceId, finalFile));
}

export function completeTask(
  state: AppState,
  locationRef: TaskRef,
  actual?: { duration?: Effort },
  today?: string,
): Result<AppState> {
  return transitionTask(state, locationRef, 'complete', actual, today);
}

export function uncompleteTask(state: AppState, locationRef: TaskRef): Result<AppState> {
  return transitionTask(state, locationRef, 'uncomplete');
}

export function cancelTask(state: AppState, locationRef: TaskRef): Result<AppState> {
  return transitionTask(state, locationRef, 'cancel');
}

export function moveTask(
  state: AppState,
  fromRef: TaskRef,
  to: TaskLocation,
  today: string = localToday(),
): Result<AppState> {
  // Resolve source
  const fromResult = resolveTaskRef(state, fromRef);
  if (!fromResult.ok) return fromResult;
  const from = fromResult.value;

  const fromWsResult = resolveWorkspace(state, from.workspaceId);
  if (!fromWsResult.ok) return fromWsResult;

  const fromProjResult = resolveProject(fromWsResult.value.workspace, from.projectIndex);
  if (!fromProjResult.ok) return fromProjResult;

  const fromListResult = resolveTaskList(fromProjResult.value, from.columnIndex);
  if (!fromListResult.ok) return fromListResult;

  if (from.taskIndex < 0 || from.taskIndex >= fromListResult.value.length) {
    return err('TASK_NOT_FOUND', `Task at index ${from.taskIndex} not found`);
  }

  // Resolve destination (validate it exists)
  const toWsResult = resolveWorkspace(state, to.workspaceId);
  if (!toWsResult.ok) return toWsResult;

  const toProjResult = resolveProject(toWsResult.value.workspace, to.projectIndex);
  if (!toProjResult.ok) return toProjResult;

  const toListResult = resolveTaskList(toProjResult.value, to.columnIndex);
  if (!toListResult.ok) return toListResult;

  let task = { ...fromListResult.value[from.taskIndex] };

  // Kanban: apply start date when leaving first column
  if (fromProjResult.value.layout === 'kanban') {
    const leavingFirstColumn = (from.columnIndex ?? 0) === 0 && (to.columnIndex ?? 0) !== 0;
    if (leavingFirstColumn && !task.actual) {
      task = { ...task, actual: { completionDate: today } };
    }
  }

  // Kanban: an open task entering the completion column (spec: `on-complete`,
  // by default the last column) is completed. A cancelled or foreign-marker
  // task keeps its state.
  if (toProjResult.value.layout === 'kanban') {
    const isCompletionColumn = (to.columnIndex ?? 0) === completionColumnIndex(toProjResult.value);
    if (isCompletionColumn && task.checkbox.state === 'open') {
      const newActual: Actual = task.actual
        ? { startDate: task.actual.completionDate, completionDate: today }
        : { completionDate: today };
      task = { ...task, completed: true, checkbox: { state: 'done', marker: 'x' }, actual: newActual };
    }
  }

  const isSameList =
    from.workspaceId === to.workspaceId &&
    from.projectIndex === to.projectIndex &&
    from.columnIndex === to.columnIndex;

  if (isSameList) {
    // Reorder within same list
    const tasks = fromListResult.value.filter((_, i) => i !== from.taskIndex);
    const insertAt = Math.min(to.taskIndex, tasks.length);
    tasks.splice(insertAt, 0, task);
    const newTodoFile = setTasksAt(
      fromWsResult.value.workspace.todoFile,
      from.projectIndex,
      from.columnIndex,
      tasks,
    );
    return ok(updateWorkspace(state, from.workspaceId, newTodoFile));
  }

  if (from.workspaceId === to.workspaceId) {
    // Same workspace, different project or column
    const tf = fromWsResult.value.workspace.todoFile;
    const sourceTasks = fromListResult.value.filter((_, i) => i !== from.taskIndex);
    const tfAfterRemove = setTasksAt(tf, from.projectIndex, from.columnIndex, sourceTasks);

    // Re-resolve the destination list from the updated file
    const destProject = tfAfterRemove.projects[to.projectIndex];
    const destListResult = resolveTaskList(destProject, to.columnIndex);
    if (!destListResult.ok) return destListResult;

    const destTasks = [...destListResult.value];
    const insertAt = Math.min(to.taskIndex, destTasks.length);
    destTasks.splice(insertAt, 0, task);
    const tfFinal = setTasksAt(tfAfterRemove, to.projectIndex, to.columnIndex, destTasks);

    return ok(updateWorkspace(state, from.workspaceId, tfFinal));
  }

  // Different workspaces
  const sourceTasks = fromListResult.value.filter((_, i) => i !== from.taskIndex);
  const sourceTf = setTasksAt(
    fromWsResult.value.workspace.todoFile,
    from.projectIndex,
    from.columnIndex,
    sourceTasks,
  );
  const state1 = updateWorkspace(state, from.workspaceId, sourceTf);

  const destWsResult = resolveWorkspace(state1, to.workspaceId);
  if (!destWsResult.ok) return destWsResult;

  const updatedDestProj = destWsResult.value.workspace.todoFile.projects[to.projectIndex];
  const updatedDestListResult = resolveTaskList(updatedDestProj, to.columnIndex);
  if (!updatedDestListResult.ok) return updatedDestListResult;

  const destTasks = [...updatedDestListResult.value];
  const insertAt = Math.min(to.taskIndex, destTasks.length);
  destTasks.splice(insertAt, 0, task);
  const destTf = setTasksAt(
    destWsResult.value.workspace.todoFile,
    to.projectIndex,
    to.columnIndex,
    destTasks,
  );

  return ok(updateWorkspace(state1, to.workspaceId, destTf));
}

export function reorderTask(
  state: AppState,
  locationRef: TaskRef,
  newIndex: number,
): Result<AppState> {
  const locResult = resolveTaskRef(state, locationRef);
  if (!locResult.ok) return locResult;
  const location = locResult.value;

  const wsResult = resolveWorkspace(state, location.workspaceId);
  if (!wsResult.ok) return wsResult;

  const projResult = resolveProject(wsResult.value.workspace, location.projectIndex);
  if (!projResult.ok) return projResult;

  const listResult = resolveTaskList(projResult.value, location.columnIndex);
  if (!listResult.ok) return listResult;

  if (location.taskIndex < 0 || location.taskIndex >= listResult.value.length) {
    return err('TASK_NOT_FOUND', `Task at index ${location.taskIndex} not found`);
  }

  if (newIndex < 0 || newIndex >= listResult.value.length) {
    return err('INDEX_OUT_OF_BOUNDS', `New index ${newIndex} is out of bounds`);
  }

  const tasks = [...listResult.value];
  const [task] = tasks.splice(location.taskIndex, 1);
  tasks.splice(newIndex, 0, task);

  const newTodoFile = setTasksAt(
    wsResult.value.workspace.todoFile,
    location.projectIndex,
    location.columnIndex,
    tasks,
  );

  return ok(updateWorkspace(state, location.workspaceId, newTodoFile));
}

export function addSubtask(
  state: AppState,
  parentLocationRef: TaskRef,
  subtask: NewTaskInput,
): Result<AppState> {
  const parentLocResult = resolveTaskRef(state, parentLocationRef);
  if (!parentLocResult.ok) return parentLocResult;
  const parentLocation = parentLocResult.value;

  const wsResult = resolveWorkspace(state, parentLocation.workspaceId);
  if (!wsResult.ok) return wsResult;

  const projResult = resolveProject(wsResult.value.workspace, parentLocation.projectIndex);
  if (!projResult.ok) return projResult;

  const listResult = resolveTaskList(projResult.value, parentLocation.columnIndex);
  if (!listResult.ok) return listResult;

  if (parentLocation.taskIndex < 0 || parentLocation.taskIndex >= listResult.value.length) {
    return err('TASK_NOT_FOUND', `Task at index ${parentLocation.taskIndex} not found`);
  }

  const parent = listResult.value[parentLocation.taskIndex];
  const newSubtask = newTaskFromInput(subtask);
  const updatedParent: Task = { ...parent, subtasks: [...parent.subtasks, newSubtask] };

  const newTasks = listResult.value.map((t, i) =>
    i === parentLocation.taskIndex ? updatedParent : t,
  );
  const newTodoFile = setTasksAt(
    wsResult.value.workspace.todoFile,
    parentLocation.projectIndex,
    parentLocation.columnIndex,
    newTasks,
  );

  return ok(updateWorkspace(state, parentLocation.workspaceId, newTodoFile));
}

export function updateSubtask(
  state: AppState,
  locationRef: SubtaskRef,
  changes: Partial<TaskFields>,
): Result<AppState> {
  const locResult = resolveSubtaskRef(state, locationRef);
  if (!locResult.ok) return locResult;
  const location = locResult.value;

  const wsResult = resolveWorkspace(state, location.workspaceId);
  if (!wsResult.ok) return wsResult;

  const projResult = resolveProject(wsResult.value.workspace, location.projectIndex);
  if (!projResult.ok) return projResult;

  const listResult = resolveTaskList(projResult.value, location.columnIndex);
  if (!listResult.ok) return listResult;

  if (location.taskIndex < 0 || location.taskIndex >= listResult.value.length) {
    return err('TASK_NOT_FOUND', `Task at index ${location.taskIndex} not found`);
  }

  const parent = listResult.value[location.taskIndex];

  if (location.subtaskIndex < 0 || location.subtaskIndex >= parent.subtasks.length) {
    return err('SUBTASK_NOT_FOUND', `Subtask at index ${location.subtaskIndex} not found`);
  }

  const oldSubtask = parent.subtasks[location.subtaskIndex];
  const idCheck = validateBlockIdChange(wsResult.value.workspace.todoFile, changes, oldSubtask.blockId);
  if (!idCheck.ok) return idCheck;
  const updatedSubtask: Task = { ...oldSubtask, ...changes };
  const updatedParent: Task = {
    ...parent,
    subtasks: parent.subtasks.map((st, i) => (i === location.subtaskIndex ? updatedSubtask : st)),
  };

  const newTasks = listResult.value.map((t, i) =>
    i === location.taskIndex ? updatedParent : t,
  );
  const newTodoFile = setTasksAt(
    wsResult.value.workspace.todoFile,
    location.projectIndex,
    location.columnIndex,
    newTasks,
  );

  return ok(updateWorkspace(state, location.workspaceId, newTodoFile));
}

export function deleteSubtask(state: AppState, locationRef: SubtaskRef): Result<AppState> {
  const locResult = resolveSubtaskRef(state, locationRef);
  if (!locResult.ok) return locResult;
  const location = locResult.value;

  const wsResult = resolveWorkspace(state, location.workspaceId);
  if (!wsResult.ok) return wsResult;

  const projResult = resolveProject(wsResult.value.workspace, location.projectIndex);
  if (!projResult.ok) return projResult;

  const listResult = resolveTaskList(projResult.value, location.columnIndex);
  if (!listResult.ok) return listResult;

  if (location.taskIndex < 0 || location.taskIndex >= listResult.value.length) {
    return err('TASK_NOT_FOUND', `Task at index ${location.taskIndex} not found`);
  }

  const parent = listResult.value[location.taskIndex];

  if (location.subtaskIndex < 0 || location.subtaskIndex >= parent.subtasks.length) {
    return err('SUBTASK_NOT_FOUND', `Subtask at index ${location.subtaskIndex} not found`);
  }

  const updatedParent: Task = {
    ...parent,
    subtasks: parent.subtasks.filter((_, i) => i !== location.subtaskIndex),
  };

  const newTasks = listResult.value.map((t, i) =>
    i === location.taskIndex ? updatedParent : t,
  );
  const newTodoFile = setTasksAt(
    wsResult.value.workspace.todoFile,
    location.projectIndex,
    location.columnIndex,
    newTasks,
  );

  return ok(updateWorkspace(state, location.workspaceId, newTodoFile));
}

// Walks every task in the workspace — top-level and subtasks, every project,
// including kanban auxiliary sections — and assigns a fresh `^id` to any
// that doesn't already have one. `addTask` does this for a single new task
// as it's created (see its `assignId` option); this is the bulk pass for
// content that predates stable addressing (e.g. a file parsed from disk).
export function assignTaskIds(state: AppState, workspaceId: string): Result<AppState> {
  const wsResult = resolveWorkspace(state, workspaceId);
  if (!wsResult.ok) return wsResult;

  const existing = collectBlockIds(wsResult.value.workspace.todoFile);

  function assignDeep(task: Task): Task {
    const blockId = task.blockId ?? generateBlockId(existing);
    existing.add(blockId);
    return { ...task, blockId, subtasks: task.subtasks.map(assignDeep) };
  }

  const newProjects = wsResult.value.workspace.todoFile.projects.map((project): Project => {
    if (project.layout === 'checklist') {
      return setTasks(project, getTasks(project).map(assignDeep));
    }
    const sections = project.sections.map(section => {
      if (section.kind === 'opaque') return section;
      const newTasks = getColumnTasks(section).map(assignDeep);
      return { ...section, blocks: setColumnTasks(section, newTasks).blocks };
    });
    return { ...project, sections };
  });

  const newTodoFile: TodoFile = { ...wsResult.value.workspace.todoFile, projects: newProjects };
  return ok(updateWorkspace(state, workspaceId, newTodoFile));
}
