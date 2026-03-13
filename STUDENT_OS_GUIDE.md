# Student OS Guide

Student OS is the daily planning and accountability layer inside Gravity Claw. It is built for a single student workflow on Telegram and combines:

- a local daily plan
- Todoist sync
- a daily work Excel tracker
- morning and evening accountability
- EXP and level tracking

This guide documents what it can do right now.

## Core Idea

Student OS is meant to run a simple loop:

1. Create a clear plan for the day
2. Execute that plan
3. Track completion
4. Review the day honestly at night

The local daily plan is the source of truth. Todoist is used as the execution and reminder layer.

## What It Can Do

### 1. Create a Daily Plan

The system can create or replace a plan for a specific day.

Each plan item can include:

- `title`
- `category`
- `priority`
- `status`
- `time block`
- linked Todoist task
- reflection text

Supported categories:

- `class`
- `assignment`
- `revision`
- `coding`
- `health`
- `admin`
- `other`

Supported priorities:

- `must`
- `should`
- `could`

Supported statuses:

- `planned`
- `in_progress`
- `done`
- `skipped`

Constraint:

- a daily plan can have at most 3 `must` items

### 2. Save the Plan Locally

Plans are stored in SQLite, not only in chat history.

That means the bot can:

- remember today’s plan across restarts
- load the plan into the agent context
- use the plan during morning and evening check-ins
- track progress item by item

### 3. Sync the Plan to Todoist

The system can create Todoist tasks from the local daily plan.

Current behavior:

- creates Todoist tasks for daily plan items not already linked
- marks priority in the task title using labels like `[Must]`
- sets the due date to `today` for today’s plan
- stores the Todoist task ID and URL back into the local plan

Todoist is useful here for:

- reminders
- mobile visibility
- checking tasks off during the day

### 4. Reconcile Todoist Back Into the Plan

The system can compare today’s open Todoist tasks with the local daily plan.

If a linked Todoist task is no longer open, Student OS treats the local plan item as done.

This keeps the local plan and Todoist reasonably aligned even if you complete a task outside the bot.

### 5. Mark Plan Items Complete

Student OS can mark a local plan item complete directly.

If the item is linked to Todoist, it also tries to close the Todoist task.

When a plan item is completed through the Student OS tool flow:

- local status becomes `done`
- linked Todoist task is completed if present
- you earn `+10 EXP`

### 6. Morning Planning Prompt

The morning heartbeat is no longer a Todoist summary.

Current morning behavior:

- if no plan exists, it pushes you to create one
- asks for:
  - top 3 must-do tasks
  - fixed commitments
  - deadlines, energy limits, or time constraints
- if a plan already exists, it sends a commitment-style reminder

This is meant to force planning before drifting into random work.

### 7. Evening Reality Check

The evening heartbeat runs a strict daily review.

It looks at:

- total planned items
- completed items
- must-dos completed
- skipped items
- open must-do items

If must-do items remain unfinished, it calls that out directly.

### 8. Telegram Commands

Student OS currently adds these commands:

- `/plan`
  - asks the agent to help create or rebuild today’s plan
  - if enough context is provided, it should create the plan and sync it to Todoist
- `/today`
  - shows the current saved daily plan
- `/review`
  - runs the evening review immediately
- `/morning`
  - triggers the morning planning prompt immediately

### 9. Natural Language Planning Through the Agent

You can also use normal messages, not only commands.

Examples:

- `Plan my day around DBMS revision, one LeetCode problem, and my OS assignment`
- `Make today’s must-dos: finish CN notes, solve 2 graph questions, and submit the lab`
- `Update plan item 4 to in progress`
- `Mark plan item 3 done`
- `Sync today’s plan to Todoist`

The agent now has dedicated planning tools and is instructed to prefer them over raw Todoist actions for planning and review.

### 10. EXP and Accountability

Student OS is connected to your gamification system.

Right now:

- completing a daily plan item gives `+10 EXP`
- completing a Todoist task through the Todoist tool also gives `+10 EXP`
- logging a productive work session can add EXP
- logging entertainment time can deduct EXP
- neutral categories like `admin`, `health`, and `other` log without changing EXP
- level and total EXP are included in morning and evening accountability messages

### 11. Daily Work Excel Tracker

Student OS now includes a second Google Sheets tracker for general work sessions.

This is separate from the LeetCode sheet.

It is meant for logging things like:

- studying DBMS for 60 minutes
- building a project feature for 90 minutes
- reading research material for 40 minutes
- watching a movie for 120 minutes
- gaming for 45 minutes

Each log entry stores:

- date
- time
- work title
- category
- tag
- duration
- output
- notes
- EXP

Fixed work categories:

- productive:
  - `studying`
  - `development`
  - `project`
  - `reading`
  - `research`
- negative:
  - `fun`
  - `movies`
  - `gaming`
  - `scrolling`
- neutral:
  - `admin`
  - `health`
  - `other`

The idea is to track where your time goes, not only what you completed.

### 12. Work Session EXP Rules

Work-session EXP is category-based.

Productive categories give positive EXP.
Entertainment categories give negative EXP.
Neutral categories give `0 EXP`.

Current duration-based scale:

- under 20 mins = `0`
- 20 to 44 mins = `5`
- 45 to 74 mins = `10`
- 75 to 104 mins = `15`
- 105+ mins = `20`

Examples:

- `studying` for 60 mins = `+10 EXP`
- `development` for 110 mins = `+20 EXP`
- `movies` for 90 mins = `-15 EXP`
- `gaming` for 30 mins = `-5 EXP`
- `admin` for 45 mins = `0 EXP`

### 13. Work Log Tools

Student OS can now work with the daily-work sheet using these tools:

- `log_work_session_to_sheet`
- `get_work_logs`
- `update_work_log`
- `delete_work_log`
- `summarize_work_logs`

Use cases:

- log today’s study or project session
- fetch recent work logs
- update notes or output for a session
- delete a wrong row
- summarize how much time went into each category or tag

### 14. Plan-Aware Memory

Today’s plan is loaded into the agent context.

That means the assistant can respond with awareness of:

- your current must-do items
- what is planned vs done
- how the day is structured

This makes it more useful for study guidance during the day.

## Current Tool-Level Capabilities

Student OS currently exposes these internal planning tools to the agent:

- `create_daily_plan`
- `get_daily_plan`
- `update_daily_plan_item`
- `complete_daily_plan_item`
- `sync_daily_plan_to_todoist`
- `run_evening_review`

Related existing productivity tools still available:

- `fetch_today_tasks`
- `add_todoist_task`
- `complete_todoist_task`
- `log_work_session_to_sheet`
- `get_work_logs`
- `update_work_log`
- `delete_work_log`
- `summarize_work_logs`
- `check_level`
- `log_habit`
- LeetCode Google Sheets tools

## Good Student Use Cases

Student OS works well for:

- planning a realistic study day
- limiting the day to 3 serious must-do items
- splitting work into must/should/could
- syncing study tasks to Todoist
- tracking broader daily work beyond Todoist tasks
- seeing how much time went into studying vs project work vs distractions
- checking off progress during the day
- end-of-day accountability
- balancing study, coding, assignments, and health

Example day structure:

- Must:
  - revise DBMS unit 3
  - solve 2 DP problems
  - finish OS assignment draft
- Should:
  - review CN notes
  - gym
- Could:
  - clean downloads folder

## What It Does Not Fully Do Yet

These are not fully built out yet:

- automatic plan generation from timetable/calendar
- recurring academic routines as structured plan templates
- subject-wise workload balancing
- streak tracking for daily planning itself
- penalty EXP for missed must-do items
- rich reflection logging from evening review into the database
- project/section/label-aware Todoist planning
- weekly review and weekly planning
- exam-mode planning
- automatic work session timers
- work log dashboards or charts

## Best Way to Use It

Recommended daily flow:

1. In the morning, run `/plan` or answer the morning prompt
2. Keep the day to 3 must-do items max
3. Let the bot sync the plan to Todoist
4. Update or complete items during the day
5. Log work sessions when you finish studying, building, reading, or wasting time
6. Run `/today` whenever you need to re-center
7. Run `/review` at night if you want the reality check before the scheduled heartbeat

## Example Prompts

Use prompts like:

- `Plan my day. I have college from 10 to 4, low energy, and one urgent OS assignment.`
- `Build a strict study plan for today with 2 must-do revision tasks and 1 coding task.`
- `Make my plan lighter today. I slept badly and only have 4 focused hours.`
- `Update item 2 to done.`
- `Mark item 5 skipped because I ran out of time.`
- `Sync today’s plan to Todoist.`
- `Review my day honestly.`

## Implementation Notes

Student OS currently lives across these main files:

- `src/daily-plan.ts`
- `src/tools/daily-plan-tools.ts`
- `src/heartbeat.ts`
- `src/bot.ts`

If behavior changes, this guide should be updated with the actual shipped functionality.
