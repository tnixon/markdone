import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { InMemoryFileSystem, operationRegistry } from '@markdone/core';
import { seedDirectoryModeFixture, loadCorpusFile } from '@markdone/core/testing';
import { createServer } from '../server';
import { loadNamedWorkspaces } from '../workspaces';

async function connectedClient(
  fs: InMemoryFileSystem,
  specs: { id: string; path: string }[] = [{ id: 'personal', path: 'workspace' }],
  now?: () => Date,
) {
  const workspaces = await loadNamedWorkspaces(specs, fs);
  const server = createServer(workspaces, { now });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-harness', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, workspaces };
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content.map(c => c.text ?? '').join('\n');
}

describe('MCP server', () => {
  let fs: InMemoryFileSystem;

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    await seedDirectoryModeFixture(fs, 'workspace');
  });

  test('tools/list returns exactly one tool per registry operation, including applyBatch', async () => {
    const { client } = await connectedClient(fs);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(operationRegistry.length);
    expect(tools.some(t => t.name === 'markdone_apply_batch')).toBe(true);
  });

  test('a query tool returns data for the named workspace', async () => {
    const { client } = await connectedClient(fs);
    const result = await client.callTool({
      name: 'markdone_get_waiting_for',
      arguments: { workspace: 'personal' },
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(textOf(result));
    expect(Array.isArray(parsed)).toBe(true);
  });

  test('a malformed call (missing a required nested parameter) is a graceful tool error, not an uncaught crash', async () => {
    const { client } = await connectedClient(fs);
    // addTask's own dispatch casts `task` with no runtime validation — a
    // model that omits it reaches `input.text` on `undefined` deep inside
    // core. The call itself must not throw out of the handler.
    await expect(
      client.callTool({
        name: 'markdone_add_task',
        arguments: { workspace: 'personal', workspaceId: 'personal', projectIndex: 0 },
      }),
    ).resolves.toMatchObject({ isError: true });
  });

  test('a query tool with workspace omitted spans every configured workspace', async () => {
    // A second workspace root on the same filesystem, alongside the one
    // beforeEach already seeded at 'workspace'.
    await seedDirectoryModeFixture(fs, 'other-workspace');

    const { client } = await connectedClient(fs, [
      { id: 'personal', path: 'workspace' },
      { id: 'shared', path: 'other-workspace' },
    ]);

    const scoped = await client.callTool({ name: 'markdone_list_tasks', arguments: { workspace: 'personal' } });
    const scopedCount = JSON.parse(textOf(scoped)).length;

    const unscoped = await client.callTool({ name: 'markdone_list_tasks', arguments: {} });
    const unscopedTasks = JSON.parse(textOf(unscoped));
    expect(unscopedTasks.length).toBeGreaterThan(scopedCount);
    const workspaceIds = new Set(unscopedTasks.map((t: { location: { workspaceId: string } }) => t.location.workspaceId));
    expect(workspaceIds).toEqual(new Set(['personal', 'shared']));
  });

  test('a mutation tool still requires workspace even though queries make it optional', async () => {
    const { client } = await connectedClient(fs);
    const result = await client.callTool({
      name: 'markdone_add_task',
      arguments: { workspaceId: 'personal', projectIndex: 0, task: { text: 'x' } },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Missing required 'workspace'");
  });

  test('an unknown workspace name is a clear error, not a crash', async () => {
    const { client } = await connectedClient(fs);
    const result = await client.callTool({
      name: 'markdone_get_waiting_for',
      arguments: { workspace: 'nope' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Unknown workspace 'nope'");
  });

  test('a mutation without confirm writes nothing and returns a preview with a diff and a token', async () => {
    const { client } = await connectedClient(fs);
    const result = await client.callTool({
      name: 'markdone_add_task',
      arguments: { workspace: 'personal', workspaceId: 'personal', projectIndex: 0, task: { text: 'New capture' } },
    });
    expect(result.isError).toBeFalsy();
    const text = textOf(result);
    expect(text).toContain('Preview:');
    expect(text).toMatch(/token: [0-9a-f]{64}/);
    expect(text).toMatch(/\+- \[ \] New capture/);
    // Nothing written yet.
    expect(await fs.read('workspace/inbox.md')).toBe(loadCorpusFile('directory-mode/inbox'));
  });

  test('confirming with the matching token applies the mutation', async () => {
    const { client } = await connectedClient(fs);
    const preview = await client.callTool({
      name: 'markdone_add_task',
      arguments: { workspace: 'personal', workspaceId: 'personal', projectIndex: 0, task: { text: 'New capture' } },
    });
    const token = textOf(preview).match(/token: ([0-9a-f]{64})/)![1];

    const applied = await client.callTool({
      name: 'markdone_add_task',
      arguments: { workspace: 'personal', workspaceId: 'personal', projectIndex: 0, task: { text: 'New capture' }, confirm: true, token },
    });
    expect(applied.isError).toBeFalsy();
    expect(textOf(applied)).toContain('Applied:');
    expect(await fs.read('workspace/inbox.md')).toContain('New capture');
  });

  test('the "Applied" response reports the ^id that was actually written, not a separately-minted one (addTask mints a fresh random id per call)', async () => {
    const { client } = await connectedClient(fs);
    const preview = await client.callTool({
      name: 'markdone_add_task',
      arguments: { workspace: 'personal', workspaceId: 'personal', projectIndex: 0, task: { text: 'New capture' } },
    });
    const token = textOf(preview).match(/token: ([0-9a-f]{64})/)![1];

    const applied = await client.callTool({
      name: 'markdone_add_task',
      arguments: { workspace: 'personal', workspaceId: 'personal', projectIndex: 0, task: { text: 'New capture' }, confirm: true, token },
    });
    const reportedId = textOf(applied).match(/New capture \^(\S+)/)![1];
    const onDisk = await fs.read('workspace/inbox.md');
    expect(onDisk).toContain(`New capture ^${reportedId}`);
  });

  test('confirming without a token is a usage error', async () => {
    const { client } = await connectedClient(fs);
    const result = await client.callTool({
      name: 'markdone_add_task',
      arguments: { workspace: 'personal', workspaceId: 'personal', projectIndex: 0, task: { text: 'New capture' }, confirm: true },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('requires the token');
  });

  test('confirming after an out-of-band edit to the same file fails with a fresh preview and a new token', async () => {
    const { client } = await connectedClient(fs);
    const preview = await client.callTool({
      name: 'markdone_add_task',
      arguments: { workspace: 'personal', workspaceId: 'personal', projectIndex: 0, task: { text: 'New capture' } },
    });
    const staleToken = textOf(preview).match(/token: ([0-9a-f]{64})/)![1];

    // Someone else edits the same file out of band.
    await fs.write('workspace/inbox.md', (await fs.read('workspace/inbox.md')) + '\n- [ ] Someone else added this');

    const confirmed = await client.callTool({
      name: 'markdone_add_task',
      arguments: { workspace: 'personal', workspaceId: 'personal', projectIndex: 0, task: { text: 'New capture' }, confirm: true, token: staleToken },
    });
    expect(confirmed.isError).toBe(true);
    const text = textOf(confirmed);
    expect(text).toContain('changed since this was last previewed');
    const freshToken = text.match(/token: ([0-9a-f]{64})/)![1];
    expect(freshToken).not.toBe(staleToken);
    // The out-of-band edit is intact — nothing was overwritten.
    expect(await fs.read('workspace/inbox.md')).toContain('Someone else added this');

    // The fresh token, from a preview that already includes the out-of-band
    // edit as its new baseline, does apply.
    const retried = await client.callTool({
      name: 'markdone_add_task',
      arguments: { workspace: 'personal', workspaceId: 'personal', projectIndex: 0, task: { text: 'New capture' }, confirm: true, token: freshToken },
    });
    expect(retried.isError).toBeFalsy();
    const finalContent = await fs.read('workspace/inbox.md');
    expect(finalContent).toContain('Someone else added this');
    expect(finalContent).toContain('New capture');
  });

  test('a stale token from before an unrelated file changed still applies (only the touched file matters)', async () => {
    const { client } = await connectedClient(fs);
    const preview = await client.callTool({
      name: 'markdone_add_task',
      arguments: { workspace: 'personal', workspaceId: 'personal', projectIndex: 0, task: { text: 'New capture' } },
    });
    const token = textOf(preview).match(/token: ([0-9a-f]{64})/)![1];

    // An unrelated file changes — this preview never touched reading-list.md.
    await fs.write('workspace/reading-list.md', (await fs.read('workspace/reading-list.md')) + '\n- [ ] Unrelated edit');

    const confirmed = await client.callTool({
      name: 'markdone_add_task',
      arguments: { workspace: 'personal', workspaceId: 'personal', projectIndex: 0, task: { text: 'New capture' }, confirm: true, token },
    });
    expect(confirmed.isError).toBeFalsy();
    expect(await fs.read('workspace/inbox.md')).toContain('New capture');
  });

  test('applyBatch previews every step as one diff and rolls back on a failing step', async () => {
    const { client } = await connectedClient(fs);
    const failing = await client.callTool({
      name: 'markdone_apply_batch',
      arguments: {
        workspace: 'personal',
        operations: [
          { op: 'addTask', params: { workspaceId: 'personal', projectIndex: 0, task: { text: 'Batched capture' } } },
          { op: 'deleteTask', params: { location: { workspaceId: 'personal', projectIndex: 99, taskIndex: 0 } } },
        ],
        confirm: true,
        token: 'irrelevant-since-preview-will-fail-first',
      },
    });
    expect(failing.isError).toBe(true);
    expect(await fs.read('workspace/inbox.md')).toBe(loadCorpusFile('directory-mode/inbox'));

    const preview = await client.callTool({
      name: 'markdone_apply_batch',
      arguments: {
        workspace: 'personal',
        operations: [{ op: 'addTask', params: { workspaceId: 'personal', projectIndex: 0, task: { text: 'Batched capture' } } }],
      },
    });
    expect(preview.isError).toBeFalsy();
    const token = textOf(preview).match(/token: ([0-9a-f]{64})/)![1];

    const applied = await client.callTool({
      name: 'markdone_apply_batch',
      arguments: {
        workspace: 'personal',
        operations: [{ op: 'addTask', params: { workspaceId: 'personal', projectIndex: 0, task: { text: 'Batched capture' } } }],
        confirm: true,
        token,
      },
    });
    expect(applied.isError).toBeFalsy();
    expect(await fs.read('workspace/inbox.md')).toContain('Batched capture');
  });
});

describe('MCP server clock', () => {
  // Vienna is UTC+2 on 2026-10-18, so 22:30Z on the 17th is 00:30 local on the 18th.
  const previousTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'Europe/Vienna';
  });
  afterAll(() => {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  });

  test('completing a task stamps the local date of the injected clock, not its UTC date', async () => {
    const fs = new InMemoryFileSystem();
    await fs.write('ws/inbox.md', '---\nmarkdone: 2\n---\n- [ ] Water plants ^water\n');
    const { client } = await connectedClient(fs, [{ id: 'ws', path: 'ws' }], () => new Date('2026-10-17T22:30:00Z'));
    const args = { workspace: 'ws', location: { workspaceId: 'ws', taskId: 'water' } };

    const preview = await client.callTool({ name: 'markdone_complete_task', arguments: args });
    const token = textOf(preview).match(/token: ([0-9a-f]{64})/)![1];
    const applied = await client.callTool({ name: 'markdone_complete_task', arguments: { ...args, confirm: true, token } });

    expect(applied.isError).toBeFalsy();
    expect(await fs.read('ws/inbox.md')).toContain('&(2026-10-18)');
  });
});

describe('MCP markdone_list_tasks withScores', () => {
  test('returns each row with its score, and the same rows without it when omitted', async () => {
    const fs = new InMemoryFileSystem();
    await fs.write('ws/inbox.md', '---\nmarkdone: 2\n---\n- [ ] Write spec $5 @computer ^spec\n- [ ] Plain ^plain\n');
    const { client } = await connectedClient(fs, [{ id: 'ws', path: 'ws' }]);

    const plain = JSON.parse(textOf(await client.callTool({ name: 'markdone_list_tasks', arguments: { workspace: 'ws' } })));
    const scored = JSON.parse(
      textOf(await client.callTool({ name: 'markdone_list_tasks', arguments: { workspace: 'ws', withScores: true } })),
    );
    expect(plain).toHaveLength(2);
    expect(plain.every((r: object) => !('score' in r))).toBe(true);
    // `task.id` is a per-parse counter, so it differs between the two calls' parses.
    const comparable = ({ score: _score, task, ...row }: { score?: unknown; task: object }) => ({ ...row, task: { ...task, id: undefined } });
    expect(scored.map(comparable)).toEqual(plain.map(comparable));

    const single = JSON.parse(
      textOf(await client.callTool({ name: 'markdone_score', arguments: { workspace: 'ws', location: { workspaceId: 'ws', taskId: 'spec' } } })),
    );
    expect(scored.find((r: { task: { blockId: string } }) => r.task.blockId === 'spec').score).toEqual(single);
    expect(single).toMatchObject({ importance: 5, fit: { contexts: ['computer'] } });
  });
});
