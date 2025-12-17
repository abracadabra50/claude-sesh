# claude-sesh

#### Session Explorer for Claude Code | Find, Search & Resume Past Sessions

[![npm version](https://img.shields.io/npm/v/claude-sesh.svg)](https://www.npmjs.com/package/claude-sesh)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](package.json)
[![MCP](https://img.shields.io/badge/MCP-enabled-D4A574.svg)](https://modelcontextprotocol.io)

[Quick Start](#quick-start) •
[Web Dashboard](#web-dashboard) •
[CLI Commands](#cli-commands) •
[MCP Integration](#mcp-integration) •
[Configuration](#configuration)

---

**Claude Code buries your sessions in `~/.claude/projects/`. Good luck finding that conversation from last week.**

claude-sesh makes it easy to find, search, and resume all your Claude Code sessions. Browse your full history in a beautiful dashboard, search across every conversation, and pick up exactly where you left off.

**Key Features:**

- 🔍 **Session Explorer** - Browse and find any past session instantly
- 🔎 **Full-Text Search** - Search across all your conversations and projects
- 📋 **Easy Resume** - Get rich context to continue any session
- 🌐 **Web Dashboard** - Beautiful UI with timelines, search, and session details
- 📊 **Usage Analytics** - Track tokens, costs, and time across all sessions
- 🏷️ **AI Enrichment** - Auto-generate summaries and tags for better search
- 🧠 **MCP Integration** - Let Claude search your session history
- 🏆 **Global Leaderboard** - Compare stats with other Claude Code users *(coming soon)*

---

## Quick Start

### Install

```bash
npm install -g claude-sesh
```

Or use directly with npx:

```bash
npx claude-sesh web
```

### Launch Dashboard

```bash
sesh web
# Opens at http://localhost:3847
```

---

## Web Dashboard

```bash
sesh web
```

Beautiful warm beige aesthetic featuring:

- **Stats Overview** - Total tokens, cost, hours coded at a glance
- **Activity Heatmap** - GitHub-style contribution graph for your coding
- **Session Timeline** - Visual history of all your work
- **Leaderboards** - Top projects, most-used tools, model breakdown
- **Session Details** - Deep dive into any session with full context
- **Search** - Find sessions by content, project, or date

---

## CLI Commands

```bash
# List recent sessions
sesh list
sesh ls -n 50

# Show session details
sesh show <session-id>

# Search sessions
sesh search "authentication"

# Find sessions to resume
sesh continue

# Resume with Claude's native resume
sesh resume <session-id> --native

# Get resume context (copies to clipboard)
sesh resume <session-id> --copy

# Show overall statistics
sesh stats

# List all projects
sesh projects

# Start web dashboard
sesh web

# Enrich sessions with AI summaries
sesh enrich --limit 20
sesh enrich --stats
```

---

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  Claude Code writes sessions to ~/.claude/projects/        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  claude-sesh parses & aggregates session data               │
│  • Token counts, costs, duration                            │
│  • Tool usage breakdown                                     │
│  • File changes tracked                                     │
│  • Errors captured                                          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Web Dashboard & CLI for exploration                        │
│  • Search all sessions                                      │
│  • View analytics & trends                                  │
│  • Resume past work                                         │
└─────────────────────────────────────────────────────────────┘
```

**No extra storage** - claude-sesh reads Claude's existing session files. Your data stays local.

---

## MCP Integration (Optional)

Want Claude to be able to search your past sessions? Add the MCP server:

```bash
claude mcp add claude-sesh --scope user -- npx claude-sesh mcp
```

Restart Claude Code. Now Claude can answer questions like:
- "What was I working on in this project?"
- "How did I solve the caching issue before?"
- "What files have changed recently?"

**Available MCP Tools:**

| Tool | Description |
|------|-------------|
| `search_sessions` | Full-text search across all sessions |
| `get_session` | Get detailed info about a specific session |
| `get_project_context` | Recent sessions, decisions, todos for a project |
| `get_pending_todos` | Find incomplete tasks across sessions |
| `search_decisions` | Find past architectural decisions |
| `search_knowledge` | Search learnings and solutions |
| `get_file_history` | Track changes to specific files |
| `get_recent_activity` | Summary of recent coding activity |

---

## AI Enrichment

Generate summaries and tags for sessions:

```bash
# Requires ANTHROPIC_API_KEY
export ANTHROPIC_API_KEY=your-key

# Enrich 10 sessions
sesh enrich

# Check enrichment progress
sesh enrich --stats
```

Enrichment extracts:
- **Summary** - What was accomplished
- **Decisions** - Key choices made
- **Problems** - Issues encountered and solutions
- **Tags** - Auto-categorization

---

## Configuration

### Web Dashboard

Default port is 3847. Change with:
```bash
sesh web --port 8080
```

### Data Location

Claude Code stores sessions at:
```
~/.claude/projects/[project-path]/[session-id].jsonl
```

claude-sesh stores enriched data at:
```
~/.claude-sesh/enriched/[session-id].json
```

---

## Development

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/claude-sesh.git
cd claude-sesh

# Install dependencies
npm install

# Build
npm run build

# Run locally
node dist/cli.js list

# Watch mode
npm run dev
```

---

## Troubleshooting

**Web dashboard not loading?**
- Check if port 3847 is in use: `lsof -i :3847`
- Try a different port: `sesh web --port 8080`

**Search returning no results?**
- Try broader search terms
- Run `sesh enrich` to add AI-generated metadata for better search

**MCP tools not available?**
- Restart Claude Code after adding the MCP server
- Check `claude mcp list` shows "Connected"

---

## Privacy & Security

- **All data stays local** - Nothing is sent to external servers (except AI enrichment which uses your own API key)
- **Read-only** - claude-sesh only reads Claude's session files, never modifies them
- **No telemetry** - No usage data collected

---

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Related Projects

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) - Anthropic's agentic coding tool
- [Model Context Protocol](https://modelcontextprotocol.io) - Open protocol for AI context sharing

---

**Built for the Claude Code community** ❤️
