// The app's tsconfig has no Node types (it is browser code), but its tests run
// under Node, where assigning process.env.TZ switches the timezone `Date` uses.
declare const process: { env: Record<string, string | undefined> };

// Runs the enclosing test file in `timezone`, restoring the previous one after.
export function useTimezone(timezone: string): void {
  const previous = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = timezone;
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  });
}
