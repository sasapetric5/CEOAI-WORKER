---
name: content-calendar
description: Plan and track content across channels (blog, social, newsletter) with publish dates
version: 0.1.0
execution-mode: side_effecting
argument-hint: "[--action plan|status|next] [--weeks N]"
category: sales-marketing
status: candidate
---
# Content Calendar

Plan, schedule, and track content publication across multiple channels -- blog, social media, newsletter, and video. Provides a calendar view with publish dates, status, and channel assignments.

## When to Use
- You need to plan content for the next N weeks across channels
- You want to see what content is scheduled, drafted, or overdue
- You need to identify gaps in your content pipeline
- You want to coordinate publishing across blog, social, and newsletter

## Execution
### 0. Emit SKILL_INVOKE
Post SKILL_INVOKE to the bus before any stateful action.
```
Type: SKILL_INVOKE
To: all
Message: [skill=content-calendar] [mode=side_effecting] [args_hash=<sha256>] [session=<session_id>]
```
(The skill invocation runtime injects the caller's canonical identity as `from_id`.)

1. Parse `$ARGUMENTS` for action (plan/status/next) and week range (default 4 weeks)
2. If `plan`: generate a content calendar with topic slots for each channel per week
3. If `status`: read existing calendar state and report drafted/scheduled/published/overdue
4. If `next`: show the next piece of content due and its status
5. Cross-reference with existing blog drafts, social posts, and newsletter submissions
6. Identify gaps (weeks with no content) and suggest topics
7. Present calendar view

## Output Format
```
Content Calendar | <action> (<N> weeks)

## Calendar
| Week | Date | Channel | Topic | Status | Owner |
|------|------|---------|-------|--------|-------|
| W14  | Apr 1 | Blog | <topic> | DRAFT | <name> |
| W14  | Apr 2 | LinkedIn | <topic> | SCHEDULED | <name> |
| W14  | Apr 4 | Newsletter | <topic> | IDEA | <name> |
| W15  | Apr 7 | Blog | <topic> | IDEA | - |

## Pipeline Health
- Scheduled: <N> pieces
- In draft: <N> pieces
- Ideas only: <N> pieces
- Gaps: <list of weeks with no content>

## Suggestions
- <topic suggestion based on gaps>

Next action: <recommendation>
```

## Skill Chains

### Mandatory

None — planning; generates schedule docs and does not modify production systems.

### Advisory

- Need social content → `[social-post]` to draft platform posts
- Need newsletter → `[newsletter-submit]` to prepare submission
- Need blog content → `[blog-draft]` to write the post

## Authority

- **T1 (TRUSTED)**: May run freely
- **T2 (Active/High)**: May run freely
- **T3 (Medium)**: May run freely
- **T4 (Probationary)**: May run (file generation only — no production state modified)
- **Operator**: Override any restriction
