/**
 * What each table holds, in one line.
 *
 * list_tables promised "a one-line note on what each holds" and returned bare
 * names. The assistant, told the notes existed and given none, had no way to
 * find the right table except to describe them one at a time - which is exactly
 * what it did: a question about two-year-old winners spent nineteen steps, ten
 * of them describe_table, and still did not reach an answer.
 *
 * A name is not a description. "APIData_Table2" and "racingpost" do not say
 * which is the warehouse and which is a feed, and no amount of model
 * intelligence recovers that from the string.
 *
 * Notes are written only where the table's own API route establishes what it
 * serves. A table with no note is still listed - an honest gap beats a
 * confident guess, because a wrong note would send the assistant somewhere
 * worse than nowhere.
 */

export const TABLE_NOTES = {
  // --- the desk's own working lists ----------------------------------------
  // These are what the product is for, and the assistant could not see any of
  // them until now: they route through hand-written endpoints rather than the
  // generic /api/:table one, so they were never on the allow-list it inherited.
  review_horses:
    "The Review List: horses put up for review, with the rating and figures " +
    "they were put up on. Scope by user_id.",
  review_horse_actions:
    "What the desk decided about a reviewed horse - the Enquire actions and " +
    "their state. This is the record of what was actually done about a horse.",
  review_conditions: "The conditions a horse had to meet to reach the Review List.",
  review_rule_preferences: "Each user's Review List rules and thresholds.",
  bloodstock_clients:
    "The Client List: one row per bloodstock client with their brief in `prefs`, " +
    "their pipeline and scored suggestions, all JSON. Scope by user_id.",
  notifications: "Notifications raised for a user, and whether they were read.",
  daily_notifications_all_users: "The daily digest as it was sent, per user.",
  DeclarationsTracking: "Declarations feed. Largely dormant - check for recent rows before relying on it.",
  EntriesTracking: "Entries feed. Largely dormant - check for recent rows before relying on it.",

  // --- the main race record -------------------------------------------------
  APIData_Table2:
    "THE MAIN WAREHOUSE. One row per horse per run: name, age, sex, sire, dam, " +
    "owner, trainer, jockey, course, distance, going, finishing position and the " +
    "Timeform figures. Start here for anything about how a horse actually ran. " +
    "Dates are in meetingDate. Very large - always bound by date.",
  racingpost: "Racing Post racecards: the runners declared for races ahead.",
  racingpost_results: "Racing Post results: finishing positions for races already run.",
  RacesAndEntries: "Entries and declarations for upcoming races.",
  ClosingEntries: "Early-closing entries - races entered well in advance.",
  FranceRaceRecords: "French cards and results.",
  IrelandRaceRecords: "Irish race records.",
  predicted_timeform: "Modelled Timeform ratings for horses without a published one.",

  // --- what this user follows ----------------------------------------------
  horseTracking:
    "Which horses each user tracks, with the tracking type and their notes. " +
    "Scope by user_id. This is the table behind 'my tracker'.",
  sire_tracking: "Sires each user follows.",
  dam_tracking: "Dams each user follows.",
  owner_tracking: "Owners each user follows.",
  jockey_tracking: "Jockeys each user follows.",
  race_watchlist: "Races a user has flagged to watch.",
  notify_horses: "Horses set up for notification.",
  reviewed_results: "Results a user has marked reviewed.",
  horse_tracking_shares: "Tracking lists shared between users.",
  UserAccounts: "Platform users. Names here are what user_id refers to elsewhere.",
  ai_questions: "Questions put to BlandfordAI - read this through team_activity, not SQL.",

  // --- sectionals, stride and pars ------------------------------------------
  sectionsparsed: "Parsed sectional times per horse per run - splits and finishing speed.",
  attheraces: "At The Races sectional and stride data by horse and by race.",
  pars_data: "Course-and-distance pars.",
  StrideParsPerMeeting: "Stride pars for one meeting.",
  StrideParsPercentilesPerTrack: "Stride percentiles by track.",
  report_track_pars_tf: "Track pars, Timeform source.",
  report_track_pars_rtv: "Track pars, Racing TV source.",
  report_track_pars_atr: "Track pars, At The Races source.",
  report_track_pars_atr_going: "Track pars by going, At The Races source.",
  RaceNet_Data: "Racenet data by horse.",
  racenets: "Racenet feed rows.",

  // --- sires and dams -------------------------------------------------------
  sire_uplift: "How much a sire lifts the mares he covers.",
  sire_age_reports: "Sire progeny performance split by age.",
  sire_country_reports: "Sire progeny performance split by country.",
  sire_sex_reports: "Sire progeny performance split by sex of progeny.",
  sire_crop_reports: "Sire performance by crop.",
  sire_distance_reports: "Sire progeny performance by distance.",
  sire_worldwide_reports: "Sire progeny performance worldwide.",
  sire_going_firm: "Sire progeny performance on firm.",
  sire_going_good_firm: "Sire progeny performance on good to firm.",
  sire_going_good: "Sire progeny performance on good.",
  sire_going_soft: "Sire progeny performance on soft.",
  sire_going_heavy: "Sire progeny performance on heavy.",
  sire_going_unknown: "Sire progeny performance where going is not recorded.",
  "stallion-fee": "Published stud fees.",
  potential_stallion: "Colts assessed as potential stallions.",
  report_potential_stallions: "The potential-stallion report.",
  mareupdates: "Broodmare updates.",
  dampedigree_ratings: "Dam pedigree ratings.",

  // --- trainers -------------------------------------------------------------
  report_trainer_form: "Trainer form.",
  report_trainer_uplift_summary: "Per-trainer summary of how horses improved on joining the yard.",
  report_trainer_uplift_moves: "The individual horse moves behind the trainer uplift summary.",

  // --- sales ----------------------------------------------------------------
  foalSale_Dashboard: "Foal sale dashboard rows.",
  foalSale_Pedigree: "Foal sale pedigrees.",
  foalSale_StallionStats: "Stallion statistics for the foal sale.",
  foalSale_Sales: "Foal sale results.",
  foalSale_StudFeeAnalysis: "Stud fee analysis for the foal sale.",
};

/**
 * Tables big enough that an unbounded scan will hit the query timeout.
 *
 * A GROUP BY over the whole of APIData_Table2 is a full scan and does not come
 * back inside 20s - the assistant found this the hard way, spending a step on a
 * query that could never have finished. Saying so up front is cheaper than
 * letting it discover the limit each time.
 */
export const LARGE_TABLES = ["APIData_Table2", "racingpost_results", "sectionsparsed", "attheraces"];

/** Every table, each with its note where one is established. */
export function describeTables(allowedTables) {
  return [...allowedTables].sort().map((name) => ({
    name,
    note: TABLE_NOTES[name],
    large: LARGE_TABLES.includes(name) || undefined,
  }));
}
