# Contributing to Markdone

Thanks for your interest! Markdone is an npm workspaces monorepo; see the
[README](README.md) for an overview of the packages.

## Setup

- Node: the version in [`.nvmrc`](.nvmrc).
- Rust (stable) is only needed for the Tauri desktop app.

```bash
npm install
npm test            # every package's test suite
npm run typecheck   # every package
```

Build and run commands for each package are in the README's
[Packages](README.md#packages) table.

## Making changes

- Keep a pull request focused on one change, and add or update tests with it.
- `npm test` and `npm run typecheck` must pass.
- File format changes go through [`spec/TODO_FORMAT.md`](spec/TODO_FORMAT.md)
  and the conformance corpus in [`spec/corpus/`](spec/corpus/README.md).
- Add a [CHANGELOG](CHANGELOG.md) entry for user-visible changes.
- Coding-agent contributors should also follow [CLAUDE.md](CLAUDE.md).

## Security issues

Don't open a public issue; follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
