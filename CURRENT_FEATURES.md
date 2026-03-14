# Current Features

This file is a short overview of the main things your current Gravity Claw / Student OS bot can do right now.

For deeper details, use:

- `STUDENT_OS_GUIDE.md`
- `DAILY_WORK_LOG_USER_GUIDE.md`
- `LIFE_LOG_USER_GUIDE.md`

## Core Idea

The bot is now a personal student operating system on Telegram.

It helps with:

- planning the day
- tracking work
- tracking life events
- reminders
- hourly accountability
- EXP and level tracking
- long-term daily memory

## Main Features

### 1. Daily Plan System

The bot can create and manage a local daily plan.

What it supports:

- top tasks for the day
- `must`, `should`, `could` priorities
- task status updates
- sync to Todoist
- morning planning
- evening review

Main commands:

- `/plan`
- `/today`
- `/review`
- `/morning`

## 2. Todoist Integration

The bot can work with Todoist for task execution.

What it supports:

- fetch today’s Todoist tasks
- add a Todoist task
- complete a Todoist task
- sync daily plan items to Todoist
- reconcile local daily plan with Todoist completion state

## 3. LeetCode Log

The bot can log solved LeetCode problems to Google Sheets.

What it stores:

- problem name
- difficulty
- topic
- time spent

EXP:

- Easy = `+10`
- Medium = `+20`
- Hard = `+30`

Use this when:

- you solved a coding problem

## 4. Daily Work Log

The bot can log completed work sessions to the `Daily Work Log` sheet.

Use this for:

- studying
- development
- project work
- reading
- research
- movies
- gaming
- scrolling

What it stores:

- date
- time
- work title
- category
- tag
- duration
- output
- notes
- EXP

EXP behavior:

- productive categories add EXP
- entertainment categories deduct EXP
- neutral categories give `0 EXP`

## 5. Life Log

The bot can log the actual timeline of your day to the `Life Log` sheet.

Use this for:

- wake-up time
- meals
- study start/end
- work start/end
- breaks
- travel
- sleep

What it supports:

- point events
- completed sessions
- live start/stop tracking
- one open session at a time
- timeline summaries

Use this when:

- you care about sequence and clock time

## 6. One-Time Reminders

The bot can create one-time reminders on Telegram.

Example:

- `Remind me to buy milk at 4 PM`

Current behavior:

- reminder fires in Telegram
- buttons:
  - `Done`
  - `10m`
  - `30m`
  - `1h`
- one-time only
- in-memory only for now

Current limitation:

- reminders are lost if the bot restarts

## 7. Adaptive Hourly Heartbeats

The bot now checks in during the day.

Current schedule:

- morning check-in at `8:00 AM` IST
- hourly check-ins from `9:00 AM` to `10:00 PM` IST
- evening review at `8:00 PM` IST
- daily summary generation at `12:00 AM` IST

Hourly heartbeat behavior:

- short and crisp
- different theme each time
- can ask about:
  - daily plan
  - Todoist
  - work log
  - life log
  - reminders
  - drift
  - focus

Main command:

- `/hourly`

## 8. Adaptive Coach Behavior

The bot does not fully rewrite its personality, but it now adapts with a lightweight coach profile.

It can shift based on your activity:

- more warm when you seem low
- more firm when you are drifting
- more direct when must-do work is not moving
- more practical when logs and plan data are clear

This is designed to stay cheap in token and server cost.

How it works:

- `soul.md` stays the base personality
- a small coach profile is stored in SQLite
- behavior changes are driven by your plan, logs, reminders, and recent day summaries

## 9. Auto-Logging

The bot can now auto-log some clear activity messages without asking first.

Examples it can handle:

- `I studied DBMS for 55 minutes`
- `I solved Two Sum in 20 minutes Easy topic arrays`
- `I woke up at 7:10`

Routing:

- solved coding problem -> LeetCode Log
- completed effort session -> Daily Work Log
- timestamped life event -> Life Log

Current limitation:

- only clear/common message patterns are auto-logged right now
- ambiguous messages may still need clarification

## 10. Daily Memory Summaries

At the end of the day, the bot stores a summary of what happened.

This summary is saved in persistent memory / SQLite.

It includes:

- daily plan progress
- work-log totals
- life-log totals
- reminder activity
- EXP change
- heartbeat context

Main command:

- `/daysummary`

## 11. EXP and Level System

The bot tracks EXP and level.

Ways EXP changes:

- completing daily plan items
- completing Todoist tasks through the bot
- logging productive work
- logging wasted time
- manual habit logging

## 12. Main Telegram Commands

Current useful commands:

- `/start`
- `/text`
- `/voice`
- `/gui`
- `/terminal`
- `/compact`
- `/plan`
- `/today`
- `/review`
- `/morning`
- `/hourly`
- `/daysummary`
- `/codex`

## 13. What Is Working Together

The current bot is strongest when used as one loop:

1. plan the day in the morning
2. execute tasks
3. log work sessions and life events during the day
4. use reminders for one-time nudges
5. respond to hourly check-ins
6. review the day at night
7. let the daily summary store what happened for long-term memory

## 14. Current Limitations

Important current limits:

- reminders are not persistent across restarts
- auto-logging is not perfect for ambiguous messages
- adaptive behavior is lightweight, not deep personality evolution
- hourly coaching is only as good as the logs and plan data it can see
- no dashboard/analytics UI yet

## 15. Best Simple Usage

If you want the highest value from the current system:

1. use `/plan` every morning
2. log clear work sessions as you finish them
3. log important life events when timing matters
4. use reminders for one-time nudges
5. answer the hourly pings honestly
6. check `/daysummary` to see what got stored
