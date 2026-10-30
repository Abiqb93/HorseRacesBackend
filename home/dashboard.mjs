/**
 * Each user's home page lists, built here rather than in the browser.
 *
 * The home page (horses-website-deployed src/pages/dashboard/home.jsx) used to
 * build these itself on every visit: six race feeds and three days of results,
 * about 7 MB, then every runner matched against the horses, sires, dams,
 * owners and jockeys the user tracks, about five seconds before anything
 * showed (30 October 2026). This is the same matching, function for function,
 * so the page can show a stored copy at once.
 *
 * It gives back the two objects the page keeps in its own cache, in the same
 * shape: `aux` (the sire, dam, owner and jockey update cards, the key sets
 * the other tabs mark their rows with, reviewed results, shares) and `dash`
 * (tracked horses, entries and declarations grouped today/upcoming, the last
 * three days' results). A change to the matching on the page belongs here too.
 */

import { getEntryOwner, sameOwner } from "./vendor/ownerMatch.mjs";
import { raceDayStamp } from "./vendor/racecardFields.mjs";

export const API_BASE = "https://horseracesbackend-production.up.railway.app";

export const RACE_FEED_NAMES = [
  "RacesAndEntries",
  "FranceRaceRecords",
  "IrelandRaceRecords",
  "ClosingEntries",
  "DeclarationsTracking",
  "EntriesTracking",
];

export const localISODate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ----------------------------------------------------------------- silks

export const normalizeSilkCode = (silkCode) => {
  if (silkCode === null || silkCode === undefined) return null;
  const raw = String(silkCode).trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const absInt = Math.abs(Math.trunc(n));
  if (!Number.isFinite(absInt) || absInt <= 0) return null;
  return absInt;
};

export const hasUsableSilkCode = (silkCode) => normalizeSilkCode(silkCode) !== null;

export const firstUsableSilkCode = (...values) => {
  for (const value of values) {
    const normalized = normalizeSilkCode(value);
    if (normalized !== null) return normalized;
  }
  return null;
};

// ----------------------------------------------------------------- names

export const normHorseKey = (name) => {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[’']/g, "")
    .trim();
};

const cleanKey = (s) => (s ? String(s).toLowerCase().trim() : "");

// ----------------------------------------------------------------- tracking rows

const EXCLUDED_TRACKING_TYPES_FOR_TOTAL = new Set(["Reviewed", "Private Note", "Stopped"]);

const getTrackingType = (row) =>
  String(row?.TrackingType || row?.trackingType || row?.tracking_type || "").trim();

const getTrackingDateTs = (row) => {
  const raw = row?.trackingDate || row?.noteDateTime || row?.created_at || row?.updated_at || null;
  const ts = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(ts) ? ts : 0;
};

export const pickLatestTrackingRecord = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows.slice().sort((a, b) => getTrackingDateTs(b) - getTrackingDateTs(a))[0];
};

export const buildActiveTrackedNamesFromRows = (rows) => {
  const grouped = {};
  for (const row of rows || []) {
    const key = normHorseKey(row?.horseName);
    if (!key) continue;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(row);
  }
  return Object.entries(grouped)
    .filter(([, horseRows]) => {
      const latest = pickLatestTrackingRecord(horseRows);
      if (getTrackingType(latest) === "Stopped") return false;
      return horseRows.some((row) => !EXCLUDED_TRACKING_TYPES_FOR_TOTAL.has(getTrackingType(row)));
    })
    .map(([key]) => key);
};

// ----------------------------------------------------------------- row fields

export const getEntryJockeyName = (ent) =>
  ent.Rider || ent.Jockey || ent.rider || ent.jockey || ent.jockeyName || ent.jockeyFullName ||
  ent.jockey_short || ent["Rider"] || ent["Jockey"] || ent["Rider Name"] || ent["Jockey Name"] ||
  ent["JockeyFullName"] || ent["RiderFullName"] || "";

export const getRecordJockeyName = (rec) =>
  rec.jockeyName || rec.jockeyFullName || rec.jockey || rec.jockey_short || rec.rider ||
  rec.riderName || rec["Jockey"] || rec["Rider"] || "";

export const getHorseName = (row) =>
  row?.Horse || row?.["Horse Name"] || row?.horseName || row?.horse_name || row?.horse || row?.name || "";

export const getRaceTitle = (row) =>
  row?.RaceTitle || row?.raceTitle || row?.race_title || row?.Race || row?.title || row?.race ||
  row?.EventName || row?.race_name || "";

export const getRaceTrack = (row) =>
  row?.FixtureTrack || row?.Track || row?.track || row?.Course || row?.course || row?.courseName ||
  row?.course_name || row?.Racecourse || row?.racecourse || "";

export const getRaceTime = (row) =>
  row?.RaceTime || row?.raceTime || row?.race_time || row?.Time || row?.time || row?.Start ||
  row?.start || row?.["Race Time"] || row?.OffTime || "";

export const getRaceDateRaw = (row) =>
  row?.FixtureDate || row?.fixtureDate || row?.meetingDate || row?.meeting_date || row?.MeetingDate ||
  row?.Date || row?.date || row?.raceDate || row?.race_date || "";

// ----------------------------------------------------------------- dates

export const parseDateFlexible = (raw) => {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return isNaN(d.getTime()) ? null : d;
  }
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return isNaN(d.getTime()) ? null : d;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

const convertTo24Hour = (timeStr) => {
  if (!timeStr) return "12:00";
  const [time, meridian] = timeStr.toLowerCase().split(/(am|pm)/).filter(Boolean);
  let [hours, minutes] = time.replace(/\s/g, "").split(".").map(Number);
  if (meridian === "pm" && hours !== 12) hours += 12;
  if (meridian === "am" && hours === 12) hours = 0;
  return `${String(hours).padStart(2, "0")}:${String(minutes || 0).padStart(2, "0")}`;
};

const cleanDateString = (dateStr, timeStr) => {
  if (!dateStr) return null;
  const cleaned = String(dateStr)
    .replace(/(\d{1,2})(st|nd|rd|th)/g, "$1")
    .replace(/^(\w+)\s+(\d{1,2})\s+/, "$1, $2 ");
  const parsed = new Date(`${cleaned} ${convertTo24Hour(timeStr || "12:00pm")}`);
  return isNaN(parsed) ? null : parsed;
};

export const parseRaceDate = (dateRaw, timeRaw) => {
  const d1 = parseDateFlexible(dateRaw);
  if (d1 && !isNaN(d1.getTime())) return d1;
  const d2 = cleanDateString(dateRaw, timeRaw);
  if (d2 && !isNaN(d2.getTime())) return d2;
  return null;
};

const startOfDay = (now) => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
};

// ----------------------------------------------------------------- update cards

const toUpdateRow = (ent, source, overrides = {}) => {
  const horseName = getHorseName(ent);
  const time = getRaceTime(ent);
  return {
    source,
    title: getRaceTitle(ent),
    track: getRaceTrack(ent),
    time,
    horseName,
    dateRaw: getRaceDateRaw(ent),
    timeRaw: time,
    jockeyName: getEntryJockeyName(ent) || "",
    trainerFullName: ent?.trainerFullName || ent?.trainerName || ent?.trainer_short || "",
    ownerName: ent?.ownerName || ent?.ownerFullName || ent?.Owner || ent?.owner || "",
    sireName: ent?.sireName || "",
    damName: ent?.damName || "",
    silkCode: ent?.silkCode ?? null,
    ...overrides,
  };
};

export const sortUpdates = (rows) =>
  rows.slice().sort((a, b) => {
    const da = parseRaceDate(a.dateRaw, a.timeRaw)?.getTime?.() || 9e15;
    const db = parseRaceDate(b.dateRaw, b.timeRaw)?.getTime?.() || 9e15;
    if (da !== db) return da - db;
    return String(a.timeRaw || "").localeCompare(String(b.timeRaw || ""));
  });

const matchHorseKeys = (sourcePayloads, horseKeys, getOverrides, accept) => {
  const matched = [];
  sourcePayloads.forEach((payload, i) => {
    const source = RACE_FEED_NAMES[i];
    (payload?.data || []).forEach((ent) => {
      const key = normHorseKey(getHorseName(ent));
      if (!key || !horseKeys.has(key)) return;
      if (accept && !accept(key, ent)) return;
      matched.push(toUpdateRow(ent, source, getOverrides?.(key, ent) || {}));
    });
  });
  return sortUpdates(matched);
};

/**
 * The page's "aux" cache for `userId`: what its first loader (the sire, dam,
 * owner and jockey cards) builds. `sireHorses` and `damHorses` are the offspring
 * lists for the user's tracked sires and dams, keyed by the name as tracked.
 */
export function buildAux({ userId, feeds, reviewed, shares, sires, dams, owners, jockeys, sireHorses, damHorses, now = new Date() }) {
  const reviewedResultsKeys = (reviewed || []).map((r) => {
    const title = String(r?.race_title || "").trim().toLowerCase();
    const name = String(r?.horse_name || "").trim().toLowerCase();
    return `${name}-${title}`;
  });
  const sharedWithMeUsers = (shares || []).filter((r) => r.shared_with_user_id === userId);

  // OWNER
  const ownerKeys = new Set();
  const horseToOwner = {};
  for (const owner of owners || []) {
    let horses = [];
    try {
      horses = JSON.parse(owner?.correspondingHorses || "[]");
    } catch {
      horses = [];
    }
    for (const name of horses) {
      const key = normHorseKey(name);
      if (!key) continue;
      ownerKeys.add(key);
      horseToOwner[key] = owner?.ownerFullName || "";
    }
  }
  const ownerStillMatches = (key, ent) => {
    const onRow = getEntryOwner(ent);
    if (!onRow) return true;
    return sameOwner(onRow, horseToOwner[key]);
  };
  const ownerUpdates = matchHorseKeys(
    feeds,
    ownerKeys,
    (key, ent) => ({ ownerName: getEntryOwner(ent) || horseToOwner[key] || "" }),
    ownerStillMatches,
  );

  // JOCKEY
  const trackedJockeyNames = (jockeys || [])
    .map((j) => j?.jockeyFullName || j?.jockeyName || j?.name || "")
    .filter(Boolean);
  const jockeyKeys = new Set(trackedJockeyNames.map(cleanKey).filter(Boolean));
  const todayStart = startOfDay(now);
  const jockeyMatched = [];
  feeds.forEach((payload, i) => {
    const source = RACE_FEED_NAMES[i];
    (payload?.data || []).forEach((ent) => {
      const entryJockey = getEntryJockeyName(ent);
      if (!jockeyKeys.has(cleanKey(entryJockey))) return;
      const dateObj = parseRaceDate(getRaceDateRaw(ent), getRaceTime(ent));
      if (dateObj && dateObj < todayStart) return;
      jockeyMatched.push(toUpdateRow(ent, source, { jockeyName: entryJockey }));
    });
  });

  // SIRE and DAM: a later parent's claim on a horse wins, as on the page.
  const byParent = (list, field, horsesOf) => {
    const keys = new Set();
    const horseTo = {};
    for (const parent of list || []) {
      const name = parent?.[field];
      if (!name) continue;
      for (const horseName of horsesOf[String(name).trim()] || []) {
        const key = normHorseKey(horseName);
        if (!key) continue;
        keys.add(key);
        horseTo[key] = name;
      }
    }
    return { keys, horseTo };
  };
  const sire = byParent(sires, "sireName", sireHorses || {});
  const dam = byParent(dams, "damName", damHorses || {});

  return {
    reviewedResultsKeys,
    sharedWithMeUsers,
    sireUpdates: matchHorseKeys(feeds, sire.keys, (key) => ({ sireName: sire.horseTo[key] || "" })),
    damUpdates: matchHorseKeys(feeds, dam.keys, (key) => ({ damName: dam.horseTo[key] || "" })),
    ownerUpdates,
    jockeyUpdates: sortUpdates(jockeyMatched),
    trackedJockeyNames,
    sireHorseKeysArr: Array.from(sire.keys),
    damHorseKeysArr: Array.from(dam.keys),
    ownerHorseKeysArr: Array.from(ownerKeys),
    trackedOwnerByHorse: horseToOwner,
    trackedJockeyKeysArr: Array.from(jockeyKeys),
  };
}

/**
 * The page's "dash" cache for one user: what its second loader builds from
 * the user's tracking rows, the feeds and `results` (the last three days of
 * APIData_Table2, as [{ date, records }]), marking rows with `aux`'s key sets.
 */
export function buildDash({ trackingRows, feeds, results, aux, now = new Date() }) {
  const sireHorseKeys = new Set(aux.sireHorseKeysArr);
  const damHorseKeys = new Set(aux.damHorseKeysArr);
  const ownerHorseKeys = new Set(aux.ownerHorseKeysArr);
  const trackedJockeyKeys = new Set(aux.trackedJockeyKeysArr);
  const trackedOwnerByHorse = aux.trackedOwnerByHorse || {};

  const trackedNames = buildActiveTrackedNamesFromRows(trackingRows);
  const trackedSet = new Set(trackedNames);

  const groupedTrackedRows = {};
  for (const entry of trackingRows || []) {
    const key = normHorseKey(entry.horseName);
    if (!key) continue;
    if (!groupedTrackedRows[key]) groupedTrackedRows[key] = [];
    groupedTrackedRows[key].push(entry);
  }
  const trackingCache = {};
  for (const [key, rows] of Object.entries(groupedTrackedRows)) {
    trackingCache[key] = pickLatestTrackingRecord(rows) || rows[0];
  }

  const silkLookup = {};
  for (const k of Object.keys(trackingCache)) {
    const sc = trackingCache[k]?.silkCode;
    if (hasUsableSilkCode(sc)) silkLookup[k] = normalizeSilkCode(sc);
  }
  const horseMetaByKey = {};
  for (const k of Object.keys(trackingCache)) {
    horseMetaByKey[k] = {
      sireName: trackingCache[k]?.sireName || "",
      damName: trackingCache[k]?.damName || "",
      ownerFullName: trackingCache[k]?.ownerFullName || "",
      trainerFullName: trackingCache[k]?.trainerFullName || "",
      jockeyName: trackingCache[k]?.jockeyName || "",
      silkCode: firstUsableSilkCode(trackingCache[k]?.silkCode),
    };
  }

  const getNotifSources = (horseKey, entry) => {
    const sources = [];
    if (trackedSet.has(horseKey)) sources.push("DIRECT");
    if (sireHorseKeys.has(horseKey)) sources.push("SIRE");
    if (damHorseKeys.has(horseKey)) sources.push("DAM");
    if (ownerHorseKeys.has(horseKey)) {
      const onRow = getEntryOwner(entry);
      if (!onRow || sameOwner(onRow, trackedOwnerByHorse[horseKey])) sources.push("OWNER");
    }
    const entJockey = cleanKey(getEntryJockeyName(entry));
    if (entJockey && trackedJockeyKeys.has(entJockey)) sources.push("JOCKEY");
    return sources;
  };

  const today = startOfDay(now);
  const grouped = {
    RaceUpdates: { today: [], upcoming: [] },
    ClosingEntries: { today: [], upcoming: [] },
    DeclarationsTracking: { today: [], upcoming: [] },
    EntriesTracking: { today: [], upcoming: [] },
  };

  feeds.forEach((payload, i) => {
    const label = RACE_FEED_NAMES[i];
    const url = `${API_BASE}/api/${label}`;
    const targetGroup = ["RacesAndEntries", "FranceRaceRecords", "IrelandRaceRecords"].includes(label)
      ? "RaceUpdates"
      : label;

    for (const entry of payload?.data || []) {
      const rawHorseName = getHorseName(entry);
      const horseKey = normHorseKey(rawHorseName);
      if (!horseKey) continue;
      const notifSources = getNotifSources(horseKey, entry);
      if (!notifSources.length) continue;

      const raceTrack = getRaceTrack(entry) || "-";
      const raceTime = getRaceTime(entry) || "-";
      const raceTitle = getRaceTitle(entry) || "-";
      const dateStr = getRaceDateRaw(entry);
      const raceDate = parseRaceDate(dateStr, raceTime);
      if (!raceDate || isNaN(raceDate.getTime())) continue;
      const raceDateOnly = new Date(raceDate);
      raceDateOnly.setHours(0, 0, 0, 0);
      const dayDiff = Math.floor((raceDateOnly - today) / (1000 * 60 * 60 * 24));

      const tinfo = trackingCache[horseKey] || {};
      const silkCode = firstUsableSilkCode(entry?.silkCode, tinfo?.silkCode, silkLookup?.[horseKey]);
      if (hasUsableSilkCode(silkCode)) silkLookup[horseKey] = normalizeSilkCode(silkCode);

      const notification = {
        sources: notifSources,
        rawHorseName,
        encodedHorseName: encodeURIComponent(rawHorseName?.trim() || ""),
        raceTrack,
        raceTime,
        raceTitle,
        encodedUrl: encodeURIComponent(url),
        encodedRaceTitle: encodeURIComponent(raceTitle),
        dayDiff,
        dateStr,
        raceDateISO: raceDayStamp(raceDate),
        raceKey: `${rawHorseName}-${raceTitle}-${dateStr}`,
        sireName: entry.sireName || tinfo?.sireName || "",
        damName: entry.damName || tinfo?.damName || "",
        ownerName: entry.ownerName || entry.ownerFullName || entry.Owner || tinfo?.ownerFullName || "",
        trainerFullName: entry.trainerFullName || entry.trainerName || entry.trainer_short || tinfo?.trainerFullName || "",
        jockeyName: getEntryJockeyName(entry) || tinfo?.jockeyName || "",
        silkCode,
        distance: entry?.Distance || entry?.distance || "",
        raceType: entry?.RaceType || entry?.raceType || "",
        officialRating: entry?.Rating && entry.Rating !== "--" ? entry.Rating : "",
        entryStatus: entry?.Status || "",
      };

      if (dayDiff === 0) grouped[targetGroup].today.push(notification);
      else if (dayDiff > 0) grouped[targetGroup].upcoming.push(notification);
    }
  });

  // RESULTS: the last three days, one row per horse per race, every reason it is there.
  const getResultSources = (horseKey, record) => {
    const sources = [];
    if (trackedSet.has(horseKey)) sources.push("DIRECT");
    if (sireHorseKeys.has(horseKey)) sources.push("SIRE");
    if (damHorseKeys.has(horseKey)) sources.push("DAM");
    if (ownerHorseKeys.has(horseKey)) {
      const onRow = getEntryOwner(record);
      if (!onRow || sameOwner(onRow, trackedOwnerByHorse[horseKey])) sources.push("OWNER");
    }
    const recJockey = cleanKey(getRecordJockeyName(record));
    if (recJockey && trackedJockeyKeys.has(recJockey)) sources.push("JOCKEY");
    return sources;
  };

  const aggMap = new Map();
  for (const { records } of results || []) {
    for (const record of records || []) {
      const horseKey = normHorseKey(record.horseName);
      if (!horseKey) continue;
      const sourcesArr = getResultSources(horseKey, record);
      if (!sourcesArr.length) continue;

      const localDate = new Date(record.meetingDate);
      const formattedDate = `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, "0")}-${String(localDate.getDate()).padStart(2, "0")}`;
      const timeOnly = record.scheduledTimeOfRaceLocal
        ? new Date(record.scheduledTimeOfRaceLocal).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
            timeZone: "UTC",
          })
        : null;
      const raceTitle = record.raceTitle || "";
      const dedupeKey = `${horseKey}__${String(raceTitle).trim().toLowerCase()}__${formattedDate}__${timeOnly || ""}`;
      const reviewKey = `${normHorseKey(record.horseName)}-${String(raceTitle || "").trim().toLowerCase()}`;

      const silkCode = firstUsableSilkCode(record?.silkCode, trackingCache[horseKey]?.silkCode, silkLookup?.[horseKey]);
      if (hasUsableSilkCode(silkCode)) silkLookup[horseKey] = normalizeSilkCode(silkCode);

      const baseRow = {
        sources: sourcesArr,
        horseName: record.horseName,
        position: record.positionOfficial,
        raceTitle,
        country: record.countryCode,
        date: formattedDate,
        time: timeOnly,
        track: record.courseName || "-",
        encodedUrl: encodeURIComponent(`${API_BASE}/api/APIData_Table2`),
        encodedRaceTitle: encodeURIComponent(String(raceTitle).trim()),
        reviewKey,
        numberOfRunners: record.numberOfRunners,
        silkCode,
        sireName: record.sireName || record.sire || "",
        damName: record.damName || record.dam || "",
        ownerFullName: record.ownerFullName || record.ownerName || "",
        trainerFullName: record.trainerFullName || record.trainerName || "",
        horseColour: record.horseColour || record.colour || "",
        horseAge: record.horseAge || record.age || "",
        horseGender: record.horseGender || record.gender || "",
        jockeyName: getRecordJockeyName(record) || "",
        _ts: record.scheduledTimeOfRaceLocal
          ? new Date(record.scheduledTimeOfRaceLocal).getTime()
          : new Date(record.meetingDate).getTime(),
      };

      const existing = aggMap.get(dedupeKey);
      if (!existing) {
        aggMap.set(dedupeKey, baseRow);
      } else {
        aggMap.set(dedupeKey, {
          ...existing,
          ...baseRow,
          sources: Array.from(new Set([...(existing.sources || []), ...(sourcesArr || [])])),
        });
      }
    }
  }

  return {
    trackedHorses: trackedNames,
    groupedNotifications: grouped,
    resultsData: Array.from(aggMap.values()),
    trackingCache,
    silkCodeByHorse: silkLookup,
    horseMetaByKey,
  };
}
