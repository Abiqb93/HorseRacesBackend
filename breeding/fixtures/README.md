# Band fixtures

One file per client band, transcribed from the desk's own mating pack. The
pack is the source of record for identity — our results feed knows a mare's
rating and the country she ran in, and is wrong or silent about her parents
often enough that it cannot be trusted to name her.

`scripts/seed-band.mjs` reads one of these and writes it through the API.

```jsonc
{
  "client": "Wathnan Racing",
  "userId": "richardbrown1",
  "season": 2027,                       // the season being planned
  "sources": { "index": "…", "master": "…", "workingFolder": "…" },
  "mares": [
    {
      "name": "CIRCIOS",
      "foaledIn": "IRE",                // where she was foaled
      "yob": 2022,
      "sire": "KINGMAN",
      "dam": "COULD IT BE LOVE",
      "damsire": "WAR FRONT",
      "location": "Newsells",           // where she stands
      "physical": "Not very big, a good-looking filly, quite Kingman.",

      // Last season, either as the desk's own line or as the index's columns.
      "statusLine": "i/f FRANKEL lsd 24/02/26",
      "coveringSire": "FRANKEL",        // optional, overrides the line
      "lsd": "24 Feb 26",
      "foaled": "",                     // this year's foal, where she had one
      "foalBy": "",
      "foalSex": "",

      // Next season. The report's own lines win; the index string is the
      // fallback, and it ranks where a report's line offers alternatives.
      "preferenceLines": [
        "1st preference: Not This Time / Nyquist",
        "2nd preference: Night of Thunder"
      ],
      "suggestion": "Not This Time/ Night of Thunder",

      "raceRecord": "Placed twice before winning a 7f fillies' novice…",
      "pedigree": "This is a wonderful family…",
      "produceRecord": null,
      "analysis": "Kingman and War Front can both pass on…",
      "ruledOut": [{ "stallion": "JUSTIFY", "reason": "Cross less proven and in US" }]
    }
  ],
  "filliesInTraining": [
    { "name": "GODSPEED", "yob": 2022, "sire": "HELLO YOUMZAIN", "dam": "MARY'S PRECEDENT",
      "damsire": "STORMING HOME", "notes": "very straightforward ride and a good mover" }
  ]
}
```

Everything is a string or null; `""` means unset, as it does on the forms the
pages post. Dates may be written the way the pack writes them — `24 Feb 26`,
`25 Mar 2026`, `07.02.26` — and are read day-first.

Run it against a local server first:

```bash
node scripts/seed-band.mjs --fixture breeding/fixtures/wathnan-2027.json --dry-run
node scripts/seed-band.mjs --fixture breeding/fixtures/wathnan-2027.json --api http://localhost:8080
```

The dry run prints the match table and writes nothing. Check it before
pointing the script at the live server: a mare reported `partial` shares a
name with a different horse in our data and will carry no rating until
somebody says which she is.
