<!--
Covers: the defaults note of a workspace with nested projects. Needs no
marker and is never a project. `projects:` entries are workspace-relative
paths without the .md extension: `home-network/todo` is the nested project,
`reading-list` a root one. `on-complete` here is a workspace default.
Expect: byte-for-byte round-trip.
-->
---
owner: alice
on-complete: Done
projects: [home-network/todo, reading-list]
---

Workspace with a project folder and ordinary notes alongside the projects.
