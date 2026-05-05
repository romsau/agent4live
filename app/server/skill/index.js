'use strict';

// Single source of truth for the agent-facing usage guide. Loaded as text in
// dev (require.extensions['.md'] hook) and inlined at build time by esbuild's
// text loader, so the guide ships verbatim inside the bundle — no filesystem
// I/O at runtime.
//
// Two consumption surfaces :
//   - tool `get_usage_guide` (app/server/tools/meta.js) — universal, every
//     MCP-compatible agent can call it.
//   - resource `agent4live://guide` (handled in app/server/mcp/sse.js) — for
//     agents that prefer reading resources over tool calls.

const GUIDE = require('./agent4live-guide.md');

const GUIDE_URI = 'agent4live://guide';
const GUIDE_NAME = 'agent4live Usage Guide';
const GUIDE_DESCRIPTION =
  'Conventions, common pitfalls, and recipe patterns for using agent4live tools effectively. Read once at the start of every agent4live session.';
const GUIDE_MIME = 'text/markdown';

// YAML frontmatter for the Claude Code skill file. The `description` field is
// the trigger Claude Code uses to decide when to activate the skill — kept
// short and signal-rich (mentions Ableton + agent4live + the value proposition).
const SKILL_FRONTMATTER =
  '---\n' +
  'name: agent4live\n' +
  'description: Use this skill whenever the user is producing music in Ableton Live and the agent4live MCP device is connected. Provides the conventions, common pitfalls, and recipe patterns you need to use the 230 LOM tools effectively without wasting calls.\n' +
  '---\n\n';

// Body written to ~/.claude/skills/agent4live/SKILL.md when Claude Code is
// the consented agent. Concatenation kept here so callers don't have to know
// the file format.
const SKILL_FILE_BODY = SKILL_FRONTMATTER + GUIDE;

module.exports = {
  GUIDE,
  GUIDE_URI,
  GUIDE_NAME,
  GUIDE_DESCRIPTION,
  GUIDE_MIME,
  SKILL_FRONTMATTER,
  SKILL_FILE_BODY,
};
