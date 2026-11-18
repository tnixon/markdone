import { operationRegistry, getOperation } from '@markdone/core';
import { COMMAND_NAMES, QUERY_COMMANDS, MUTATION_COMMANDS } from '../commands';

describe('command table registry coverage', () => {
  test('every non-batch registry operation has exactly one COMMAND_NAMES entry', () => {
    const nonBatchOps = operationRegistry.filter(op => op.category !== 'batch').map(op => op.name).sort();
    expect(Object.keys(COMMAND_NAMES).sort()).toEqual(nonBatchOps);
  });

  test('every COMMAND_NAMES entry resolves to a command classified the same way the registry classifies its op', () => {
    for (const [opName, cliName] of Object.entries(COMMAND_NAMES)) {
      const op = getOperation(opName);
      expect(op, `COMMAND_NAMES['${opName}'] names an unknown registry operation`).toBeDefined();
      if (op!.mutating) {
        expect(MUTATION_COMMANDS[cliName], `expected a mutation command '${cliName}' for op '${opName}'`).toBeDefined();
        expect(MUTATION_COMMANDS[cliName].opName).toBe(opName);
      } else {
        expect(QUERY_COMMANDS[cliName], `expected a query command '${cliName}' for op '${opName}'`).toBeDefined();
        expect(QUERY_COMMANDS[cliName].opName).toBe(opName);
      }
    }
  });

  test('every command in QUERY_COMMANDS/MUTATION_COMMANDS references a real, correctly-classified registry operation', () => {
    for (const [cliName, cmd] of Object.entries(QUERY_COMMANDS)) {
      const op = getOperation(cmd.opName);
      expect(op, `query command '${cliName}' references unknown op '${cmd.opName}'`).toBeDefined();
      expect(op!.mutating, `query command '${cliName}' references a mutating op`).toBe(false);
    }
    for (const [cliName, cmd] of Object.entries(MUTATION_COMMANDS)) {
      const op = getOperation(cmd.opName);
      expect(op, `mutation command '${cliName}' references unknown op '${cmd.opName}'`).toBeDefined();
      expect(op!.mutating, `mutation command '${cliName}' references a non-mutating op`).toBe(true);
    }
  });

  test('QUERY_COMMANDS and MUTATION_COMMANDS have no overlapping keys', () => {
    const queryKeys = new Set(Object.keys(QUERY_COMMANDS));
    const overlap = Object.keys(MUTATION_COMMANDS).filter(k => queryKeys.has(k));
    expect(overlap).toEqual([]);
  });
});
