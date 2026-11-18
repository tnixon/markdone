// @markdone/core/testing — test-only fixture helpers, for any Node consumer's
// test suite (CLI, MCP server). Kept off the main barrel and off ./node: it
// touches node:fs directly (via __dirname, reaching into spec/corpus at the
// repo root) rather than going through the FileSystem abstraction, which is
// fine for test setup but wrong for anything shipped.
export { stripLeadingComment, loadCorpusFile, seedFileModeFixture, seedDirectoryModeFixture, readDirectoryModeFixture } from './testing/corpusFixtures';
