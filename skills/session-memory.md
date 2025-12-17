# Session Memory Skill

When this skill is active, you have access to the user's Claude Code session history through claude-sesh MCP tools.

## Available MCP Tools

- `search_sessions` - Search across all Claude Code sessions by query text
- `get_session` - Get detailed information about a specific session
- `get_project_context` - Get rich context for a project including decisions, todos, and knowledge
- `get_pending_todos` - Get all incomplete todos across sessions
- `search_decisions` - Find past decisions by topic (useful for "why did we...?" questions)
- `search_knowledge` - Search accumulated learnings from past sessions
- `get_file_history` - See history of changes to a specific file
- `get_recent_activity` - Get summary of recent coding activity

## When to Use These Tools

**Decision Archaeology**
- User asks "why did we choose X?" or "what did we decide about Y?"
- Use `search_decisions` to find the reasoning from when the choice was made

**Problem-Solution Matching**
- User is facing a bug or issue that seems familiar
- Use `search_knowledge` or `search_sessions` to find how similar problems were solved

**Project Context**
- Starting work in a project after a break
- Use `get_project_context` to understand recent work, pending todos, and accumulated knowledge

**File Understanding**
- User asks about changes to a specific file
- Use `get_file_history` to see when and why the file was modified

**Continuing Work**
- User wants to resume previous work
- Use `get_pending_todos` to find incomplete tasks

## Example Usage Patterns

### "Why did we use Express instead of Fastify?"
```
1. Call search_decisions with query "Express" or "Fastify"
2. Present the decision and its context to the user
```

### "How did I solve the caching issue before?"
```
1. Call search_knowledge with query "caching" or "cache"
2. Also try search_sessions with "caching"
3. Present relevant solutions found
```

### "What was I working on in this project?"
```
1. Call get_project_context with the current project path
2. Summarize recent sessions, pending todos, and key decisions
```

### "What changes have been made to parser.ts?"
```
1. Call get_file_history with "parser.ts"
2. Present the history of modifications with context
```

## Best Practices

1. **Be proactive** - When starting in a project, consider calling `get_project_context` to understand recent work
2. **Cross-reference** - If one search returns few results, try related terms
3. **Provide context** - When presenting findings, include when the decision/knowledge was recorded
4. **Respect privacy** - Session data is local to the user's machine, but still summarize rather than dump raw data
