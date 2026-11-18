import type { Project, Workspace } from '../model/types';
import type { OperationContext, OperationDefinition, Result } from '../operations/types';
import type { OperationPreview } from './changes';
import type { WorkspaceWarning } from './warnings';
import type { DiscoveryReport } from './discovery';
import type { MarkerStatus } from '../parser/frontmatter';

// A single workspace (one file, or one directory), backed by a `FileSystem`.
// `FileWorkspaceHandle` and `DirectoryWorkspaceHandle` are the two concrete
// implementations — both live in this package and depend only on the
// `FileSystem` interface, not on any concrete implementation.
export interface WorkspaceHandle {
  readonly id: string;
  listProjects(): Project[];
  getProject(projectId: string): Project | undefined;
  // Returns the exact changes it wrote (description + FileChange[], the same
  // shape previewOperation returns) — computed from the same plan this call
  // itself executed, not a second independent one. This matters because a
  // plan is not pure when it involves id assignment (addTask/addSubtask/
  // assignTaskIds mint a fresh random ^id per call by design): a caller that
  // reports a *separate* previewOperation's changes as what got applied
  // would report an id that was never written.
  applyOperation(op: OperationDefinition, input: Record<string, unknown>, ctx?: OperationContext): Promise<Result<OperationPreview>>;
  // Computes what applyOperation would write, without writing it. Shares its
  // planning logic with applyOperation, so a preview always matches the
  // eventual write.
  previewOperation(op: OperationDefinition, input: Record<string, unknown>, ctx?: OperationContext): Promise<Result<OperationPreview>>;
  // Warnings from the last reload() — parse() and parseProject() report
  // warnings but throw nothing (spec: graceful degradation); this is how a
  // consumer that wants them (e.g. a lint command) gets at them, since
  // applyOperation/previewOperation intentionally don't surface them again.
  warnings(): WorkspaceWarning[];
  // Assembles this handle's current state as a `Workspace`, for a caller
  // building a multi-workspace `AppState` to run read-only queries against
  // (`runOperation` from the registry). Mutations must go through
  // applyOperation/previewOperation, never through state built this way.
  toWorkspace(): Workspace;
  reload(): Promise<void>;
  // Directory mode only: what the last reload() found on disk — marked
  // projects, skipped files, unmarked notes. Lint and the CLI's
  // empty-workspace hint read this instead of re-walking the folder.
  discoveryReport?(): DiscoveryReport;
  // File mode only: the workspace file's own marker status.
  markerStatus?(): MarkerStatus;
}
