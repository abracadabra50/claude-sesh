# Project Onboarding Skill

Help Claude automatically understand a project's history and context when starting a session.

## Purpose

When you start working in a project, use this skill to quickly gather context about:
- Recent work done in this project
- Pending or incomplete tasks
- Key decisions that have been made
- Accumulated knowledge and insights
- Files that have been frequently modified

## Automatic Context Gathering

When you detect that you're in a project directory, consider gathering context:

### Step 1: Get Project Context
```
Call get_project_context with the current working directory
```

This returns:
- Session count (how many times the project has been worked on)
- Total tokens used (indicator of work depth)
- Recent session summaries
- Key decisions made
- Accumulated knowledge
- Pending todos

### Step 2: Summarize for the User

Present a brief overview:
```
"You've had 47 sessions in this project.
Last time, you were working on [summary].
You have 3 pending tasks: [tasks].
Key decisions include: [decision summaries]."
```

### Step 3: Offer to Continue or Start Fresh

```
"Would you like me to:
1. Continue where you left off (resume the pending tasks)
2. Start something new
3. Review past decisions before proceeding"
```

## When to Use This Skill

1. **First message in a session** - If in a known project, gather context automatically
2. **User asks "what was I doing?"** - Use get_project_context
3. **User seems to be continuing previous work** - Proactively provide relevant context
4. **User is making a decision** - Check if similar decisions were made before

## Contextual Prompts

If recent sessions show:

**Pending Todos**
```
"I notice you have incomplete tasks from your last session:
- [todo 1]
- [todo 2]
Want to continue with these?"
```

**Recent Errors**
```
"Your last session had some errors that might need follow-up.
Would you like me to help resolve them?"
```

**Work in Progress**
```
"It looks like you were in the middle of [summary].
The last files modified were [files].
Should we continue from there?"
```

## Configuration Options

This skill can be configured to be:
- **Automatic** - Always gather context on project entry
- **On-demand** - Only gather context when explicitly requested
- **Minimal** - Just show pending todos without full history

## Privacy Considerations

- All data is local to the user's machine
- Session history is not shared externally
- Summarize rather than showing raw conversation content
- Respect that some sessions may be sensitive work
