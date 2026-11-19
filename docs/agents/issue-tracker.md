# Issue tracker: Linear

Issues and specs for this repo live in the Linear project named **Tempo**. GitHub Issues are disabled. Use the Linear MCP tools for every operation; they accept issue identifiers, project names and "me" directly.

## Conventions

- **Team**: new issues go to the team that owns the Tempo project. Look it up with `list_projects` (query "Tempo", field `teams`) rather than hard-coding it.
- **Create an issue**: `save_issue` with `team`, `project: "Tempo"`, `title`, a Markdown `description`, a `priority` and one triage label. Priority: 1 Urgent when production is broken or data is at risk; 2 High when it blocks merges or a main flow; 3 Medium for a real defect with a workaround; 4 Low for polish or a known exception. The label is `needs-triage` unless the issue is specified enough for `ready-for-agent` or `ready-for-human`. Report the chosen priority and the reason with the issue link.
- **Read an issue**: `get_issue`, then `list_comments` for the discussion.
- **List issues**: `list_issues` with `project: "Tempo"` and `label` / `state` filters.
- **Sub-issue**: `save_issue` with `parentId` set to the parent's identifier.
- **Blocking**: `save_issue` with `blockedBy: [<identifier>, ...]`. An issue is unblocked when every blocker is Done or Canceled (`get_issue` with `includeRelations: true`).
- **Comment**: `save_comment` on the issue.
- **Apply / remove labels**: `save_issue` with `addLabels` / `removeLabels`.
- **Close**: comment with the explanation, then set `state` to `Done`, or `Canceled` for won't-fix.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create a Linear issue in the Tempo project.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.

## Wayfinding operations

Used by `/wayfinder`. The **map** is one parent issue; its sub-issues are the tickets.

- **Map**: an issue labelled `wayfinder:map` holding the Notes / Decisions-so-far / Fog body. Create the `wayfinder:*` labels with `save_issue_label` on first use.
- **Child ticket**: a sub-issue of the map, labelled `wayfinder:<type>` (`research` / `prototype` / `grilling` / `task`).
- **Frontier query**: `list_issues` with `parentId` set to the map, open states only; drop issues with an open blocker or an assignee; first in map order wins.
- **Claim**: `save_issue` with `assignee: "me"`, the session's first write.
- **Resolve**: comment the answer, set `state` to `Done`, then append a pointer (gist and identifier) to the map's Decisions-so-far with a `patch` edit.
