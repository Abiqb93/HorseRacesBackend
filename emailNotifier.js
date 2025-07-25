const cron = require("node-cron");
const nodemailer = require("nodemailer");
const mysql = require("mysql2/promise");

// === GMAIL CREDENTIALS ===
const GMAIL_USER = "bloodstockblandford@gmail.com";
const GMAIL_PASS = "bhnfjsgmgpwdjhjo"; // App password

// === Set up reusable transporter ===
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_PASS,
  },
});

// === DB Config ===
const dbConfig = {
  host: "horseprofileshub.czyece6mq0kn.eu-north-1.rds.amazonaws.com",
  user: "abiqb93",
  password: "Saps123$#",
  database: "horseprofileshub",
  port: 3306,
};

// === Utility: Convert UK time string (e.g., 2.15pm) to minutes since midnight ===
function parseUKTimeToMinutes(timeStr) {
  if (!timeStr) return null;

  const cleaned = timeStr.trim().toLowerCase();
  const match = cleaned.match(/^(\d{1,2})[.:](\d{2})(am|pm)?$/);

  if (match) {
    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const meridian = match[3];

    if (meridian === "pm" && hours < 12) hours += 12;
    if (meridian === "am" && hours === 12) hours = 0;

    return hours * 60 + minutes;
  }

  return null;
}

// === MAIN CRON JOB ===
cron.schedule("* * * * *", async () => {
  const now = new Date();
  const ukNow = new Date(now.toLocaleString("en-GB", { timeZone: "Europe/London" }));

  const todayStr = ukNow.toISOString().split("T")[0];
  const nowMins = ukNow.getHours() * 60 + ukNow.getMinutes();

  try {
    const conn = await mysql.createConnection(dbConfig);

    // Step 1: Fetch users with notifications
    const [watchlist] = await conn.execute(`
      SELECT user_id, race_title, race_time, race_date, notified
      FROM race_watchlist
      WHERE notify = 1 AND notified = 0 AND race_date = ?
    `, [todayStr]);

    for (const item of watchlist) {
      const raceMins = parseUKTimeToMinutes(item.race_time);
      if (raceMins === null) continue;

      if (raceMins - nowMins === 5) {
        // Get email for user
        const [rows] = await conn.execute(
          "SELECT email FROM UserAccounts WHERE user_id = ?",
          [item.user_id]
        );

        const email = rows[0]?.email;
        if (!email) continue;

        // Send Email
        await transporter.sendMail({
          from: `"Horse Watchlist" <${GMAIL_USER}>`,
          to: email,
          subject: `Race Reminder: ${item.race_title}`,
          text: `Hello ${item.user_id},\n\nThis is a reminder that your watchlisted race "${item.race_title}" is scheduled in 5 minutes (UK time).\n\nRegards,\nHorse Watchlist`,
        });

        console.log(`[EMAIL SENT] to ${email} for race: ${item.race_title}`);

        // Mark as notified
        await conn.execute(
          "UPDATE race_watchlist SET notified = 1 WHERE user_id = ? AND race_title = ? AND race_date = ?",
          [item.user_id, item.race_title, item.race_date]
        );
      }
    }

    await conn.end();
  } catch (err) {
    console.error("[CRON ERROR]:", err);
  }
});