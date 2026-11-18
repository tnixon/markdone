import { useEffect } from 'react';

const SHORTCUTS: { keys: string[]; description: string }[] = [
  { keys: ['n'], description: 'New task (when task list is focused)' },
  { keys: ['/'], description: 'Focus search bar' },
  { keys: ['Enter'], description: 'Submit task / confirm edit' },
  { keys: ['Escape'], description: 'Cancel edit' },
  { keys: ['⌘/Ctrl', '↑ / ↓'], description: 'Reorder selected task' },
  { keys: ['⌘/Ctrl', 'Z'], description: 'Undo last action' },
  { keys: ['?'], description: 'Show this help' },
];

export default function KeyboardShortcutsHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/40 dark:bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-5">
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-4">
          Keyboard Shortcuts
        </h2>
        <div className="space-y-3">
          {SHORTCUTS.map(({ keys, description }) => (
            <div key={description} className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-600 dark:text-gray-400">{description}</span>
              <div className="flex items-center gap-1 flex-shrink-0">
                {keys.map(k => (
                  <kbd
                    key={k}
                    className="px-1.5 py-0.5 text-xs font-mono rounded bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 whitespace-nowrap"
                  >
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-5 w-full text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
        >
          Close
        </button>
      </div>
    </div>
  );
}
