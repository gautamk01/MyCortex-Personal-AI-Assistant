# Life Log User Guide

This guide explains how to use the new **Life Log** tracker in Gravity Claw.

## What It Is

Life Log is a timeline tracker for your day.

Use it when you want to record:

- when you woke up
- when you started or ended studying
- meal times
- breaks
- travel
- project/work blocks
- sleep

This is different from the Daily Work Log:

- `Daily Work Log` = completed work sessions and EXP
- `Life Log` = timestamped sequence of your day

## What Gets Stored

Each row in the `Life Log` sheet stores:

- start date
- start time
- end date
- end time
- duration
- activity
- category
- tag
- entry type
- source
- notes

## Categories

Life Log uses these categories:

- `sleep`
- `study`
- `development`
- `work`
- `meal`
- `exercise`
- `travel`
- `break`
- `entertainment`
- `personal`
- `admin`
- `other`

## How To Talk To The Bot

### Single events

Use messages like:

- `I woke up at 7:10`
- `Had breakfast at 8:00`
- `Left for college at 9:15`

These are logged as timestamped point events.

### Completed sessions

Use messages like:

- `I studied DBMS from 8:00 to 9:10`
- `Worked on Gravity Claw for 90 minutes starting at 10:30`
- `I took a break from 4:15 to 4:35`

These are logged as completed sessions with duration.

### Live tracking

Use messages like:

- `Starting work now`
- `Starting lunch now`
- `Start studying DBMS at 8:30`

Later you can say:

- `End my current session`
- `I ended lunch at 1:20`
- `Stop my study session now`

The bot will close the currently open session and calculate the duration.

### Multiple events in one message

You can also send:

- `I woke up at 7:20, had breakfast at 8, and started studying at 8:30`

The bot should split that into multiple Life Log rows automatically.

## When To Use Life Log vs Daily Work Log

Use **Life Log** when:

- you care about the actual order of the day
- you mention clock times
- you want a daily timeline
- you want wake-up, meal, break, and sleep records

Use **Daily Work Log** when:

- you finished a work session and want it counted as work
- you want EXP for productive time
- you want to track category totals for study/project/entertainment effort

## Example Prompts

- `I woke up at 7:05`
- `Had lunch from 1:00 to 1:25`
- `Started studying DBMS at 8:30`
- `End my current session at 10:15`
- `I worked on Gravity Claw from 10:30 to 12:00`
- `Show my life log for today`
- `Summarize my day timeline`
- `How much time did I spend on breaks today?`

## What The Bot Can Do

Through the Life Log tools, the bot can:

- add a point event
- add a completed session
- start a live session
- end the current live session
- fetch recent life-log rows
- update a wrong row
- delete a wrong row
- summarize the day as a timeline plus totals

## Notes

- Life Log does not award EXP in the current version.
- Only one live session should stay open at a time.
- Starting a new live session auto-closes the previous one.
