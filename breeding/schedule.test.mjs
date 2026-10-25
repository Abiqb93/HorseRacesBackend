import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cron = require("node-cron");

/**
 * Every job the server schedules, as server.jsx writes it. On 25 October
 * 2026, the night UK clocks went back, the nightly breeding pass did not
 * run: node-cron 4.2.1 worked out its next run from 24 October as
 * 1 January 2027, and its weekly Monday job as a date years away. The
 * scheduler only checks again a day later, so a wrong answer moves a job to
 * whatever time of day the server happened to start.
 */
const JOBS = [
  { name: "breeding nightly", pattern: "50 2 * * *", timezone: "Europe/London", at: "02:50" },
  { name: "trainer uplift, Mondays", pattern: "10 4 * * 1", timezone: "Europe/London", at: "04:10", weekly: true },
  { name: "track pars", pattern: "40 3 * * *", timezone: "Europe/London", at: "03:40" },
  { name: "nick statistics", pattern: "20 3 * * *", timezone: "Europe/London", at: "03:20" },
  { name: "France tomorrow", pattern: "30 18 * * *", timezone: "Europe/Paris", at: "18:30" },
  { name: "France yesterday", pattern: "15 1 * * *", timezone: "Europe/Paris", at: "01:15" },
  { name: "France morning reconcile", pattern: "30 8 * * *", timezone: "Europe/Paris", at: "08:30" },
];

const clock = (date, timeZone) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);

// The days either side of both clock changes in 2026, and an ordinary week.
const FROM = [
  "2026-03-27T12:00:00Z", "2026-03-28T10:00:00Z", "2026-03-29T00:30:00Z",
  "2026-10-23T12:00:00Z", "2026-10-24T01:50:00Z", "2026-10-24T10:50:00Z", "2026-10-25T00:30:00Z", "2026-10-25T04:40:00Z",
  "2026-11-04T09:00:00Z",
];

test("every scheduled job runs next at its own local time, within a day (a week for the weekly), across the clock changes", () => {
  mock.timers.enable({ apis: ["Date"] });
  try {
    for (const job of JOBS) {
      const task = cron.createTask(job.pattern, () => {}, { timezone: job.timezone });
      try {
        for (const from of FROM) {
          mock.timers.setTime(Date.parse(from));
          const [next] = task.getNextRuns(1);
          const hours = (next.getTime() - Date.parse(from)) / 3_600_000;
          const limit = job.weekly ? 7 * 24 + 1 : 25;
          assert.ok(hours > 0 && hours <= limit, `${job.name} from ${from}: next run ${next.toISOString()}, ${hours.toFixed(1)} hours away`);
          assert.equal(clock(next, job.timezone), job.at, `${job.name} from ${from}: runs at ${clock(next, job.timezone)} local`);
        }
      } finally {
        task.destroy();
      }
    }
  } finally {
    mock.timers.reset();
  }
});

test("the breeding nightly pass runs on the night the clocks go back", () => {
  mock.timers.enable({ apis: ["Date"] });
  try {
    const task = cron.createTask("50 2 * * *", () => {}, { timezone: "Europe/London" });
    try {
      mock.timers.setTime(Date.parse("2026-10-24T10:50:00Z"));
      assert.deepEqual(task.getNextRuns(3).map((d) => d.toISOString()), [
        "2026-10-25T02:50:00.000Z",
        "2026-10-26T02:50:00.000Z",
        "2026-10-27T02:50:00.000Z",
      ]);
    } finally {
      task.destroy();
    }
  } finally {
    mock.timers.reset();
  }
});
