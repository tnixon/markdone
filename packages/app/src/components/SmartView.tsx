import type { TodoOperations } from '../hooks/useTodoOperations';
import type { TaskWithLocation } from '@markdone/core';
import TaskItem from './TaskItem';

interface SmartViewProps {
  title: string;
  tasks: TaskWithLocation[];
  ops: TodoOperations;
  workspaceColorOf: (workspaceId: string) => string;
  onOpenDetail: (location: import('@markdone/core').TaskLocation) => void;
}

export default function SmartView({ title, tasks, ops, workspaceColorOf, onOpenDetail }: SmartViewProps) {
  if (tasks.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-gray-400 dark:text-gray-500">
          No tasks in {title.toLowerCase()}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {tasks.map(({ task, location }) => (
        <div key={task.id} className="flex items-stretch">
          <div
            className="w-1 rounded-full flex-shrink-0 mr-2 self-stretch"
            style={{ backgroundColor: workspaceColorOf(location.workspaceId) }}
          />
          <div className="flex-1 min-w-0">
            <TaskItem
              task={task}
              location={location}
              onComplete={ops.completeTask}
              onUncomplete={ops.uncompleteTask}
              onUpdate={ops.updateTask}
              onDelete={ops.deleteTask}
              onAddSubtask={ops.addSubtask}
              onUpdateSubtask={ops.updateSubtask}
              onOpenDetail={onOpenDetail}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
