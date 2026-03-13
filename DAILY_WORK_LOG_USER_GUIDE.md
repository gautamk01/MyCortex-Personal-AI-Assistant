# Daily Work Log User Guide

This guide explains how to use the new **Daily Work Log** feature in Gravity Claw.

It is meant for tracking:

- studying
- development work
- project work
- reading
- research
- entertainment time
- low-value time like scrolling

The goal is simple:

1. track where your time goes
2. reward productive time
3. penalize wasted time
4. make your days more honest

## What This Feature Does

The bot can log your work sessions into a Google Sheet tab called:

- `Daily Work Log`

Each row represents **one session**.

Example sessions:

- studied DBMS for 60 minutes
- built a project feature for 90 minutes
- read operating systems notes for 40 minutes
- watched a movie for 120 minutes
- played games for 45 minutes

Each log stores:

- date
- time
- work title
- category
- tag
- duration
- output
- notes
- EXP

## Categories

### Productive Categories

These give positive EXP:

- `studying`
- `development`
- `project`
- `reading`
- `research`

### Negative Categories

These deduct EXP:

- `fun`
- `movies`
- `gaming`
- `scrolling`

### Neutral Categories

These log time but do not affect EXP:

- `admin`
- `health`
- `other`

## How EXP Works

EXP depends on:

1. the category
2. the time spent

### Duration Scale

- under 20 minutes = `0`
- 20 to 44 minutes = `5`
- 45 to 74 minutes = `10`
- 75 to 104 minutes = `15`
- 105+ minutes = `20`

### Examples

- `studying` for 60 minutes = `+10 EXP`
- `development` for 120 minutes = `+20 EXP`
- `movies` for 90 minutes = `-15 EXP`
- `gaming` for 30 minutes = `-5 EXP`
- `admin` for 45 minutes = `0 EXP`

## How To Interact With It

You interact with it through normal chat messages.

The agent has tools to:

- log a work session
- fetch recent work logs
- update a work log
- delete a work log
- summarize your work logs

## Best Way To Log A Session

When you finish a session, send something like:

### Productive Session Examples

- `Log that I studied DBMS for 60 minutes. Tag: DBMS. Output: revised normalization.`
- `I worked on Gravity Claw for 90 minutes. Category: development. Tag: Student OS. Output: built sheet logging.`
- `Log a reading session: 40 minutes reading operating systems notes. Tag: OS.`
- `I researched vector databases for 50 minutes. Category: research. Tag: Pinecone.`

### Negative Session Examples

- `Log that I watched a movie for 120 minutes. Category: movies. Tag: entertainment.`
- `I played games for 45 minutes. Category: gaming.`
- `Log 30 minutes of scrolling. Category: scrolling.`

### Neutral Session Examples

- `Log 35 minutes of admin work. Tag: college forms.`
- `I spent 50 minutes exercising. Category: health.`

## Recommended Format

This format works well:

`Log a work session: [what you did], category [category], tag [tag], [time] minutes, output [result], notes [optional note]`

Example:

`Log a work session: revised DBMS indexing, category studying, tag DBMS, 55 minutes, output finished unit 4 revision`

## How To View Recent Logs

You can ask:

- `Show my recent work logs`
- `Get my last 10 work logs`
- `Show today's work log entries`

The bot should fetch the recent rows from the Daily Work Log sheet.

## How To Update A Log

If a row was logged incorrectly, ask the bot to update it.

Examples:

- `Update work log row 12. Change notes to: got distracted halfway.`
- `Update row 15 in my work log. Change output to: finished auth UI.`
- `Change row 18 category to development.`

Important:

- updating a row does **not** recalculate EXP automatically

## How To Delete A Log

Examples:

- `Delete work log row 21`
- `Remove row 19 from my daily work log`

Use this only if a row is wrong or duplicated.

## How To Get A Summary

You can ask for summaries by day or by range.

Examples:

- `Summarize my work logs for today`
- `Where did my time go today?`
- `Show total time by category today`
- `Summarize my work logs from 2026-03-10 to 2026-03-14`
- `How much time did I spend on DBMS this week?`

The summary should show:

- total minutes
- total EXP
- time by category
- time by tag

## When To Use LeetCode Log vs Daily Work Log

Use **LeetCode Log** when:

- you solved a coding problem
- you want to track difficulty, topic, and problem-solving time

Use **Daily Work Log** when:

- you studied a subject
- you built a project
- you read or researched something
- you spent time on entertainment or distractions
- you want a broader picture of your day

## Good Daily Usage Pattern

A practical way to use it:

1. plan your day in the morning
2. do a focused session
3. log it immediately after finishing
4. repeat for the next session
5. check summary at night

This works better than trying to reconstruct the whole day later.

## Example Day

Example interactions:

- `Plan my day around DBMS revision, a project task, and one LeetCode problem`
- `Log that I studied DBMS for 70 minutes. Category: studying. Tag: DBMS. Output: finished joins and indexing.`
- `Log 95 minutes of development work on Gravity Claw. Tag: work log feature.`
- `Log 35 minutes of scrolling. Category: scrolling.`
- `Summarize my work logs for today`
- `Run my evening review`

## Tips

- keep categories accurate
- use tags consistently, like `DBMS`, `OS`, `Gravity Claw`, `React`
- log sessions soon after they finish
- use output field for something concrete
- do not hide entertainment time if you want honest tracking

## Common Mistakes

- using `other` too often
- logging huge vague sessions like `worked all day`
- mixing LeetCode problem logs into the work log
- forgetting to include time spent
- using random tags every time for the same subject or project

## Suggested Tags

For study:

- `DBMS`
- `OS`
- `CN`
- `DSA`
- `Math`

For development:

- `Gravity Claw`
- `Student OS`
- `Telegram Bot`
- `Frontend`
- `Backend`

For personal tracking:

- `entertainment`
- `focus`
- `habit`

## Short Prompt Templates

Use these directly:

- `Log a studying session for 60 minutes on DBMS. Output: finished normalization.`
- `Log a development session for 90 minutes on Gravity Claw.`
- `Log 30 minutes of gaming.`
- `Show my recent work logs.`
- `Summarize my work logs for today.`
- `Delete work log row 14.`

## What This Helps You See

If you use it consistently, you will start seeing:

- how much real study time you do
- how much time goes into building
- how much time gets lost to movies, games, and scrolling
- what subjects or projects dominate your week
- whether your day matches your plan

That is the main point of this feature.
