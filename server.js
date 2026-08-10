/**
 * BusinessMarket18 / Apply750
 * Live Visitor Tracking Server
 *
 * Endpoints:
 *
 * POST /track
 * GET  /active-now
 * GET  /live-stats
 * GET  /daily-stats
 * GET  /weekly-stats
 * GET  /monthly-stats
 * GET  /
 *
 * Data is stored in events.jsonl.
 *
 * IMPORTANT:
 * - This server does NOT need dashboard.html.
 * - Your Wix/Apply750 HTML dashboard can call these endpoints.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

// --------------------------------------------------
// SETTINGS
// --------------------------------------------------

const PORT = process.env.PORT || 4000;

const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN || "*";

const EVENTS_FILE =
  path.join(__dirname, "events.jsonl");

// Keep 30 days of events in memory
const HISTORY_DAYS = 30;

const HISTORY_MS =
  HISTORY_DAYS * 24 * 60 * 60 * 1000;

// Visitor is considered active if seen
// within the last 60 seconds
const ACTIVE_WINDOW_MS = 60 * 1000;

// Maximum number of events kept in memory
const MAX_EVENTS_IN_MEMORY = 200000;

// --------------------------------------------------
// MEMORY
// --------------------------------------------------

let events = [];

// --------------------------------------------------
// LOAD SAVED HISTORY
// --------------------------------------------------

function loadEvents() {

  if (!fs.existsSync(EVENTS_FILE)) {
    console.log("No events.jsonl file found.");
    return;
  }

  try {

    const lines = fs
      .readFileSync(EVENTS_FILE, "utf8")
      .split("\n")
      .filter(Boolean);

    const cutoff =
      Date.now() - HISTORY_MS;

    for (const line of lines) {

      try {

        const e = JSON.parse(line);

        if (
          e &&
          typeof e.ts === "number" &&
          e.ts >= cutoff
        ) {

          events.push(e);

        }

      } catch (error) {

        // Ignore invalid lines

      }

    }

    // Protect memory
    if (events.length > MAX_EVENTS_IN_MEMORY) {

      events =
        events.slice(
          events.length - MAX_EVENTS_IN_MEMORY
        );

    }

    console.log(
      `Loaded ${events.length} events from disk`
    );

  } catch (error) {

    console.error(
      "Could not load events.jsonl:",
      error
    );

  }
}

loadEvents();

// --------------------------------------------------
// SAVE EVENT
// --------------------------------------------------

function appendToDisk(event) {

  fs.appendFile(
    EVENTS_FILE,
    JSON.stringify(event) + "\n",
    (error) => {

      if (error) {
        console.error(
          "Could not save event:",
          error
        );
      }

    }
  );

}

// --------------------------------------------------
// CLEAN OLD MEMORY EVENTS
// --------------------------------------------------

function cleanupEvents() {

  const cutoff =
    Date.now() - HISTORY_MS;

  events =
    events.filter(
      (event) => event.ts >= cutoff
    );

  if (events.length > MAX_EVENTS_IN_MEMORY) {

    events =
      events.slice(
        events.length - MAX_EVENTS_IN_MEMORY
      );

  }

}

// --------------------------------------------------
// SEND JSON
// --------------------------------------------------

function sendJSON(
  res,
  status,
  data
) {

  const body =
    JSON.stringify(data);

  res.writeHead(status, {

    "Content-Type":
      "application/json; charset=utf-8",

    "Access-Control-Allow-Origin":
      ALLOWED_ORIGIN,

    "Access-Control-Allow-Methods":
      "GET, POST, OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type",

    "Cache-Control":
      "no-store"

  });

  res.end(body);

}

// --------------------------------------------------
// READ POST BODY
// --------------------------------------------------

function readBody(req) {

  return new Promise(
    (resolve, reject) => {

      let data = "";

      req.on(
        "data",
        (chunk) => {

          data += chunk;

          if (data.length > 1000000) {

            req.destroy();

            reject(
              new Error(
                "Request too large"
              )
            );

          }

        }
      );

      req.on(
        "end",
        () => resolve(data)
      );

      req.on(
        "error",
        reject
      );

    }
  );

}

// --------------------------------------------------
// CREATE SERVER
// --------------------------------------------------

const server =
  http.createServer(
    async (req, res) => {

      const parsed =
        url.parse(
          req.url,
          true
        );

      // ----------------------------------------------
      // CORS PREFLIGHT
      // ----------------------------------------------

      if (
        req.method === "OPTIONS"
      ) {

        res.writeHead(
          204,
          {

            "Access-Control-Allow-Origin":
              ALLOWED_ORIGIN,

            "Access-Control-Allow-Methods":
              "GET, POST, OPTIONS",

            "Access-Control-Allow-Headers":
              "Content-Type"

          }
        );

        return res.end();

      }

      // ----------------------------------------------
      // CLEAN OLD EVENTS
      // ----------------------------------------------

      cleanupEvents();

      // ----------------------------------------------
      // ROOT /
      // ----------------------------------------------

      if (
        req.method === "GET" &&
        parsed.pathname === "/"
      ) {

        return sendJSON(
          res,
          200,
          {

            ok: true,

            service:
              "BusinessMarket18 Live Visitor Tracker",

            status:
              "online",

            historyDays:
              HISTORY_DAYS,

            eventsInMemory:
              events.length,

            endpoints: {

              track:
                "POST /track",

              activeNow:
                "GET /active-now",

              liveStats:
                "GET /live-stats",

              dailyStats:
                "GET /daily-stats",

              weeklyStats:
                "GET /weekly-stats",

              monthlyStats:
                "GET /monthly-stats"

            }

          }
        );

      }

      // ----------------------------------------------
      // POST /track
      // ----------------------------------------------

      if (
        req.method === "POST" &&
        parsed.pathname === "/track"
      ) {

        try {

          const raw =
            await readBody(req);

          let payload = {};

          if (raw) {

            try {

              payload =
                JSON.parse(raw);

            } catch (error) {

              return sendJSON(
                res,
                400,
                {
                  ok: false,
                  error:
                    "Invalid JSON"
                }
              );

            }

          }

          const event = {

            ts:
              Date.now(),

            sessionId:
              String(
                payload.sessionId ||
                "unknown"
              ).slice(0, 100),

            page:
              String(
                payload.page ||
                "/"
              ).slice(0, 500),

            ref:
              String(
                payload.ref ||
                ""
              ).slice(0, 500),

            event:
              String(
                payload.event ||
                "pageview"
              ).slice(0, 100)

          };

          events.push(event);

          appendToDisk(event);

          cleanupEvents();

          return sendJSON(
            res,
            200,
            {

              ok: true,

              message:
                "Visitor event recorded",

              timestamp:
                event.ts

            }
          );

        } catch (error) {

          console.error(
            "Track error:",
            error
          );

          return sendJSON(
            res,
            400,
            {

              ok: false,

              error:
                "Could not process tracking request"

            }
          );

        }

      }

      // ----------------------------------------------
      // GET /active-now
      // ----------------------------------------------

      if (
        req.method === "GET" &&
        parsed.pathname === "/active-now"
      ) {

        const cutoff =
          Date.now() -
          ACTIVE_WINDOW_MS;

        const activeSessions =
          new Set();

        for (
          const event of events
        ) {

          if (
            event.ts >= cutoff
          ) {

            activeSessions.add(
              event.sessionId
            );

          }

        }

        return sendJSON(
          res,
          200,
          {

            ok: true,

            activeNow:
              activeSessions.size,

            at:
              Date.now()

          }
        );

      }

      // ----------------------------------------------
      // GET /live-stats
      //
      // Example:
      //
      // /live-stats?windowSeconds=604800&bucketSeconds=3600
      //
      // 604800 = 7 days
      // 3600   = 1 hour
      // ----------------------------------------------

      if (
        req.method === "GET" &&
        parsed.pathname === "/live-stats"
      ) {

        let windowSeconds =
          parseInt(
            parsed.query.windowSeconds
          );

        let bucketSeconds =
          parseInt(
            parsed.query.bucketSeconds
          );

        if (
          !Number.isFinite(
            windowSeconds
          ) ||
          windowSeconds <= 0
        ) {

          windowSeconds =
            86400;

        }

        if (
          !Number.isFinite(
            bucketSeconds
          ) ||
          bucketSeconds <= 0
        ) {

          bucketSeconds =
            3600;

        }

        // Maximum 30 days
        windowSeconds =
          Math.min(
            windowSeconds,
            HISTORY_DAYS *
              24 *
              60 *
              60
          );

        bucketSeconds =
          Math.max(
            bucketSeconds,
            60
          );

        const now =
          Date.now();

        const cutoff =
          now -
          windowSeconds * 1000;

        const bucketMs =
          bucketSeconds * 1000;

        const numBuckets =
          Math.ceil(
            windowSeconds /
            bucketSeconds
          );

        const buckets =
          Array.from(
            {
              length:
                numBuckets
            },
            () => new Set()
          );

        const pageviews =
          Array.from(
            {
              length:
                numBuckets
            },
            () => 0
          );

        for (
          const event of events
        ) {

          if (
            event.ts < cutoff
          ) {
            continue;
          }

          const index =
            Math.floor(
              (event.ts - cutoff) /
              bucketMs
            );

          if (
            index < 0 ||
            index >= numBuckets
          ) {
            continue;
          }

          buckets[index].add(
            event.sessionId
          );

          pageviews[index]++;

        }

        const series =
          buckets.map(
            (bucket, index) => {

              return {

                t:
                  new Date(
                    cutoff +
                    index *
                    bucketMs
                  ).toISOString(),

                visitors:
                  bucket.size,

                pageviews:
                  pageviews[index]

              };

            }
          );

        return sendJSON(
          res,
          200,
          {

            ok: true,

            windowSeconds,

            bucketSeconds,

            series

          }
        );

      }

      // ----------------------------------------------
      // DAILY STATS
      //
      // Returns last 30 days
      // ----------------------------------------------

      if (
        req.method === "GET" &&
        parsed.pathname === "/daily-stats"
      ) {

        const now =
          new Date();

        const result = [];

        for (
          let i = HISTORY_DAYS - 1;
          i >= 0;
          i--
        ) {

          const start =
            new Date(now);

          start.setHours(
            0,
            0,
            0,
            0
          );

          start.setDate(
            start.getDate() - i
          );

          const end =
            new Date(start);

          end.setDate(
            end.getDate() + 1
          );

          const uniqueVisitors =
            new Set();

          let pageviews = 0;

          for (
            const event of events
          ) {

            if (
              event.ts >=
                start.getTime() &&
              event.ts <
                end.getTime()
            ) {

              uniqueVisitors.add(
                event.sessionId
              );

              pageviews++;

            }

          }

          result.push({

            date:
              start
                .toISOString()
                .slice(0, 10),

            visitors:
              uniqueVisitors.size,

            pageviews

          });

        }

        return sendJSON(
          res,
          200,
          {

            ok: true,

            days:
              result

          }
        );

      }

      // ----------------------------------------------
      // WEEKLY STATS
      // ----------------------------------------------

      if (
        req.method === "GET" &&
        parsed.pathname === "/weekly-stats"
      ) {

        const result = [];

        const now =
          new Date();

        for (
          let week = 3;
          week >= 0;
          week--
        ) {

          const end =
            new Date(now);

          end.setHours(
            23,
            59,
            59,
            999
          );

          end.setDate(
            end.getDate() -
            week * 7
          );

          const start =
            new Date(end);

          start.setDate(
            start.getDate() - 6
          );

          start.setHours(
            0,
            0,
            0,
            0
          );

          const uniqueVisitors =
            new Set();

          let pageviews = 0;

          for (
            const event of events
          ) {

            if (
              event.ts >=
                start.getTime() &&
              event.ts <=
                end.getTime()
            ) {

              uniqueVisitors.add(
                event.sessionId
              );

              pageviews++;

            }

          }

          result.push({

            week:
              start
                .toISOString()
                .slice(0, 10),

            visitors:
              uniqueVisitors.size,

            pageviews

          });

        }

        return sendJSON(
          res,
          200,
          {

            ok: true,

            weeks:
              result

          }
        );

      }

      // ----------------------------------------------
      // MONTHLY STATS
      // ----------------------------------------------

      if (
        req.method === "GET" &&
        parsed.pathname === "/monthly-stats"
      ) {

        const result = [];

        const now =
          new Date();

        for (
          let monthOffset = 2;
          monthOffset >= 0;
          monthOffset--
        ) {

          const start =
            new Date(
              now.getFullYear(),
              now.getMonth() -
                monthOffset,
              1,
              0,
              0,
              0,
              0
            );

          const end =
            new Date(
              now.getFullYear(),
              now.getMonth() -
                monthOffset +
                1,
              1,
              0,
              0,
              0,
              0
            );

          const uniqueVisitors =
            new Set();

          let pageviews = 0;

          for (
            const event of events
          ) {

            if (
              event.ts >=
                start.getTime() &&
              event.ts <
                end.getTime()
            ) {

              uniqueVisitors.add(
                event.sessionId
              );

              pageviews++;

            }

          }

          result.push({

            month:
              `${start.getFullYear()}-${String(
                start.getMonth() + 1
              ).padStart(2, "0")}`,

            visitors:
              uniqueVisitors.size,

            pageviews

          });

        }

        return sendJSON(
          res,
          200,
          {

            ok: true,

            months:
              result

          }
        );

      }

      // ----------------------------------------------
      // 404
      // ----------------------------------------------

      return sendJSON(
        res,
        404,
        {

          ok: false,

          error:
            "not found",

          path:
            parsed.pathname

        }
      );

    }
  );

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

server.listen(
  PORT,
  () => {

    console.log(
      `Live tracker running on port ${PORT}`
    );

    console.log(
      `Keeping ${HISTORY_DAYS} days of history`
    );

  }
);
