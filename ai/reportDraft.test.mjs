import test from "node:test";
import assert from "node:assert/strict";

import {
  DRAFT_SCHEMA,
  SECTIONS,
  buildDraftMessages,
  draftReport,
  numbersNotInEvidence,
  parseDraft,
  summariseStats,
} from "./reportDraft.mjs";

const STATS = {
  mare: {
    own: { name: "CIRCIOS", best: 89, runs: 4, wins: 1 },
    row: { horse_name: "CIRCIOS", sire_name: "KINGMAN", dam_name: "COULD IT BE LOVE", damsire_name: "WAR FRONT", foaling_year: 2022 },
    runs: [{ meetingDate: "2025-07-18", courseName: "Newbury", distance: "7f", positionOfficial: "1" }],
    seasons: [{ season: 2026, status: "in_foal", covering_sire: "FRANKEL", last_service_date: "2026-02-24" }],
  },
  produce: { n: 0, horses: [] },
  family: { siblings: [{ name: "ADELAIDE RIVER", groupWins: 1 }] },
  stallions: [
    {
      name: "FRANKEL",
      fee: { stallion: "Frankel", local_ccy: "GBP", fee_2025_local: 350000, stud_location: "Juddmonte" },
      mating: {
        sire: { progeny: { n: 880, stakesWinners: 160, group1Winners: 42, horses: [] } },
        nick: { n: 6, stakesWinners: 1, horses: [{ name: "SAND GAZELLE", best: 109 }] },
      },
      missing: [],
    },
  ],
};

test("the prompt carries the figures, the notes and the rule against inventing any", () => {
  const { system, user, evidence } = buildDraftMessages({
    mare: { name: "CIRCIOS", yob: 2022, statusLine: "i/f FRANKEL lsd 24/02/26" },
    season: 2027,
    preferences: [
      { rank: 1, stallion: "NOT THIS TIME", region: "USA" },
      { rank: 2, stallion: "NIGHT OF THUNDER", tag: "3x3 Galileo" },
    ],
    notes: "Not very big, quite Kingman. Tread carefully on temperament.",
    stats: STATS,
  });

  assert.match(system, /must appear in the STATS or NOTES/);
  assert.match(system, /from 40 runners", never "from 40 foals/);
  assert.match(user, /MARE: CIRCIOS \(2022\)/);
  assert.match(user, /STATUS: i\/f FRANKEL lsd 24\/02\/26/);
  assert.match(user, /1\. NOT THIS TIME \(USA\)/);
  assert.match(user, /2\. NIGHT OF THUNDER \[3x3 Galileo\]/);
  assert.match(user, /Tread carefully on temperament/);
  // The figures themselves must be in the turn, or the model has nothing to
  // write from and every number it produces is invented by construction.
  assert.match(user, /"stakesWinners": 160/);
  assert.match(user, /SAND GAZELLE/);
  assert.equal(evidence.stats.stallions[0].name, "FRANKEL");
});

test("the stats are cut to figures a paragraph can use", () => {
  const compact = summariseStats(STATS);
  assert.equal(compact.mare.row.damsire, "WAR FRONT");
  assert.equal(compact.stallions[0].fee.latest, 350000);
  assert.equal(compact.stallions[0].progeny.stakesWinners, 160);
  assert.equal(compact.stallions[0].cross.n, 6);
  assert.equal(compact.mare.seasons[0].coveringSire, "FRANKEL");
  // A horse list is capped, so a stallion with 40 named runners does not
  // become most of the prompt.
  const many = summariseStats({ stallions: [{ name: "X", mating: { sire: { progeny: { horses: Array.from({ length: 40 }, (_, i) => ({ name: `H${i}` })) } } } }] });
  assert.equal(many.stallions[0].progeny.horses.length, 8);
});

test("a draft is read out of a fence, and half a draft is refused", () => {
  const full = { race_record: "a", pedigree: "b", produce_record: "c", analysis: "d" };
  assert.deepEqual(parseDraft(JSON.stringify(full)), full);
  assert.deepEqual(parseDraft("```json\n" + JSON.stringify(full) + "\n```"), full);
  assert.deepEqual(parseDraft(full), full);
  assert.throws(() => parseDraft('{"race_record":"a"}'), /missing: pedigree, produce_record, analysis/);
  assert.throws(() => parseDraft("I would be glad to help with that."), /did not come back as JSON/);
  assert.deepEqual(DRAFT_SCHEMA.required, SECTIONS);
});

test("a figure that is not in the evidence is reported, and arithmetic anyone can do is not", () => {
  const { evidence } = buildDraftMessages({ stats: STATS });
  const warnings = numbersNotInEvidence(
    {
      analysis:
        "There are 6 runners on the cross for 1 SW in SAND GAZELLE, rated 109. " +
        "He has 47 SWs from 312 runners overall. Foaled 2022, she won 1 of her 4 starts.",
    },
    evidence,
  );
  const flagged = warnings.map((w) => w.figure);
  assert.deepEqual(flagged, ["47", "312"]);
  // 109 is in the evidence; 2022 is a year; 6, 1 and 4 are plain counts.
  assert.ok(!flagged.includes("109"));
  assert.ok(!flagged.includes("2022"));
  assert.equal(warnings[0].section, "analysis");
});

test("the draft asks for a guaranteed shape and still works where the API has never heard of one", () => {
  const sections = { race_record: "a", pedigree: "b", produce_record: "c", analysis: "d" };
  const calls = [];
  const anthropic = {
    messages: {
      create: async (req) => {
        calls.push(req);
        if (req.output_config) {
          const err = new Error("output_config: extra fields not permitted");
          throw err;
        }
        return { content: [{ type: "text", text: JSON.stringify(sections) }], model: "claude-opus-5", usage: { input_tokens: 10 } };
      },
    },
  };
  return draftReport({ anthropic, stats: STATS }).then((out) => {
    assert.equal(calls.length, 2);
    assert.ok(calls[0].output_config, "the first attempt asks the API to guarantee the shape");
    assert.ok(!calls[1].output_config, "the second asks for it in words");
    assert.match(calls[1].messages[0].content, /Return ONLY a JSON object/);
    assert.deepEqual(out.sections, sections);
    assert.equal(out.model, "claude-opus-5");
    assert.deepEqual(out.warnings, []);
  });
});

test("a genuine API failure is not mistaken for an unsupported parameter", async () => {
  const anthropic = {
    messages: {
      create: async () => {
        throw new Error("overloaded_error: the service is temporarily unavailable");
      },
    },
  };
  await assert.rejects(draftReport({ anthropic, stats: STATS }), /overloaded_error/);
});

test("a refusal is a 400 with a reason, not a parse failure", async () => {
  const anthropic = {
    messages: {
      create: async () => ({ content: [], stop_reason: "refusal", stop_details: { category: "cyber" } }),
    },
  };
  await assert.rejects(draftReport({ anthropic, stats: STATS }), (err) => {
    assert.equal(err.status, 400);
    assert.match(err.message, /declined to draft/);
    return true;
  });
});
