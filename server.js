/**
 * LIVE VISITOR TRACKER
 *
 * Endpoints:
 * POST /track
 * GET  /active-now
 * GET  /live-stats
 *
 * Historical:
 * GET /traffic-history?range=today
 * GET /traffic-history?range=7days
 * GET /traffic-history?range=30days
 * GET /traffic-history?range=90days
 * GET /traffic-history?from=2026-08-01&to=2026-08-06
 *
 * Health:
 * GET /health
 *
 * Dashboard:
 * GET /
 * GET /dashboard.html
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = process.env.PORT || 4000;

const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN || "*";

const EVENTS_FILE =
  path.join(__dirname, "events.jsonl");

const ACTIVE_WINDOW_MS =
  60 * 1000;

const MAX_EVENTS_IN_MEMORY =
  500000;

const HISTORY_DAYS =
  90;


/* ============================================================
   EVENTS
============================================================ */

let events = [];


/* ============================================================
   LOAD SAVED EVENTS
============================================================ */

function loadEvents() {

  if (!fs.existsSync(EVENTS_FILE)) {
    console.log("No events.jsonl found.");
    return;
  }

  try {

    const content =
      fs.readFileSync(EVENTS_FILE, "utf8");

    const lines =
      content
        .split("\n")
        .filter(Boolean);

    const cutoff =
      Date.now() -
      HISTORY_DAYS *
      24 *
      60 *
      60 *
      1000;

    for (const line of lines) {

      try {

        const event =
          JSON.parse(line);

        if (
          event &&
          Number.isFinite(event.ts) &&
          event.ts >= cutoff
        ) {
          events.push(event);
        }

      } catch (error) {
        // Ignore invalid lines
      }
    }

    if (
      events.length >
      MAX_EVENTS_IN_MEMORY
    ) {
      events =
        events.slice(
          -MAX_EVENTS_IN_MEMORY
        );
    }

    console.log(
      "Loaded " +
      events.length +
      " events from disk."
    );

  } catch (error) {

    console.error(
      "Error loading events:",
      error.message
    );

  }
}

loadEvents();


/* ============================================================
   SAVE EVENT TO DISK
============================================================ */

function appendToDisk(event) {

  fs.appendFile(
    EVENTS_FILE,
    JSON.stringify(event) + "\n",
    function(error) {

      if (error) {
        console.error(
          "Error saving event:",
          error.message
        );
      }

    }
  );
}


/* ============================================================
   JSON RESPONSE
============================================================ */

function sendJSON(
  res,
  status,
  data
) {

  const body =
    JSON.stringify(data);

  res.writeHead(
    status,
    {
      "Content-Type":
        "application/json",

      "Access-Control-Allow-Origin":
        ALLOWED_ORIGIN,

      "Access-Control-Allow-Methods":
        "GET, POST, OPTIONS",

      "Access-Control-Allow-Headers":
        "Content-Type"
    }
  );

  res.end(body);
}


/* ============================================================
   READ BODY
============================================================ */

function readBody(req) {

  return new Promise(
    function(resolve, reject) {

      let data = "";

      req.on(
        "data",
        function(chunk) {

          data += chunk;

          if (
            data.length >
            1000000
          ) {
            req.destroy();
          }

        }
      );

      req.on(
        "end",
        function() {
          resolve(data);
        }
      );

      req.on(
        "error",
        function(error) {
          reject(error);
        }
      );

    }
  );
}


/* ============================================================
   UNIQUE VISITORS
============================================================ */

function getUniqueVisitors(list) {

  const sessions =
    new Set();

  for (
    const event of list
  ) {

    sessions.add(
      event.sessionId
    );

  }

  return sessions.size;
}


/* ============================================================
   DAILY DATA
============================================================ */

function getDailyHistory(
  from,
  to
) {

  const result = [];

  const start =
    new Date(from);

  start.setHours(
    0,
    0,
    0,
    0
  );

  const end =
    new Date(to);

  end.setHours(
    0,
    0,
    0,
    0
  );

  for (
    let timestamp =
      start.getTime();

    timestamp <=
      end.getTime();

    timestamp +=
      24 *
      60 *
      60 *
      1000
  ) {

    const dayStart =
      timestamp;

    const dayEnd =
      timestamp +
      24 *
      60 *
      60 *
      1000 -
      1;

    const dayEvents =
      events.filter(
        function(event) {

          return (
            event.ts >= dayStart &&
            event.ts <= dayEnd
          );

        }
      );

    result.push({

      date:
        new Date(
          timestamp
        )
        .toISOString()
        .slice(
          0,
          10
        ),

      visitors:
        getUniqueVisitors(
          dayEvents
        ),

      pageviews:
        dayEvents.length

    });
  }

  return result;
}


/* ============================================================
   WEEKLY DATA
============================================================ */

function getWeeklyHistory(
  from,
  to
) {

  const weeks =
    new Map();

  for (
    const event of events
  ) {

    if (
      event.ts < from ||
      event.ts > to
    ) {
      continue;
    }

    const date =
      new Date(
        event.ts
      );

    const day =
      date.getDay();

    const difference =
      day === 0
        ? -6
        : 1 - day;

    date.setDate(
      date.getDate() +
      difference
    );

    date.setHours(
      0,
      0,
      0,
      0
    );

    const key =
      date
        .toISOString()
        .slice(
          0,
          10
        );

    if (
      !weeks.has(key)
    ) {
      weeks.set(
        key,
        []
      );
    }

    weeks
      .get(key)
      .push(event);
  }

  return Array.from(
    weeks.entries()
  )
  .sort(
    function(a, b) {
      return a[0]
        .localeCompare(
          b[0]
        );
    }
  )
  .map(
    function(entry) {

      const week =
        entry[0];

      const list =
        entry[1];

      return {

        week: week,

        visitors:
          getUniqueVisitors(
            list
          ),

        pageviews:
          list.length

      };

    }
  );
}


/* ============================================================
   MONTHLY DATA
============================================================ */

function getMonthlyHistory(
  from,
  to
) {

  const months =
    new Map();

  for (
    const event of events
  ) {

    if (
      event.ts < from ||
      event.ts > to
    ) {
      continue;
    }

    const date =
      new Date(
        event.ts
      );

    const key =
      date.getFullYear() +
      "-" +
      String(
        date.getMonth() + 1
      ).padStart(
        2,
        "0"
      );

    if (
      !months.has(key)
    ) {
      months.set(
        key,
        []
      );
    }

    months
      .get(key)
      .push(event);
  }

  return Array.from(
    months.entries()
  )
  .sort(
    function(a, b) {
      return a[0]
        .localeCompare(
          b[0]
        );
    }
  )
  .map(
    function(entry) {

      return {

        month:
          entry[0],

        visitors:
          getUniqueVisitors(
            entry[1]
          ),

        pageviews:
          entry[1].length

      };

    }
  );
}


/* ============================================================
   SERVER
============================================================ */

const server =
  http.createServer(
    async function(req, res) {

      const parsed =
        url.parse(
          req.url,
          true
        );


      /* ======================================================
         CORS
      ====================================================== */

      if (
        req.method ===
        "OPTIONS"
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


      /* ======================================================
         POST /track
      ====================================================== */

      if (
        req.method === "POST" &&
        parsed.pathname === "/track"
      ) {

        try {

          const raw =
            await readBody(req);

          const payload =
            raw
              ? JSON.parse(raw)
              : {};

          const event = {

            ts:
              Date.now(),

            sessionId:
              String(
                payload.sessionId ||
                "unknown"
              )
              .slice(
                0,
                64
              ),

            page:
              String(
                payload.page ||
                "/"
              )
              .slice(
                0,
                256
              ),

            ref:
              String(
                payload.ref ||
                ""
              )
              .slice(
                0,
                256
              ),

            event:
              String(
                payload.event ||
                "pageview"
              )
              .slice(
                0,
                32
              )

          };

          events.push(
            event
          );

          appendToDisk(
            event
          );

          if (
            events.length >
            MAX_EVENTS_IN_MEMORY
          ) {

            events =
              events.slice(
                -MAX_EVENTS_IN_MEMORY
              );

          }

          return sendJSON(
            res,
            200,
            {
              ok: true
            }
          );

        } catch (error) {

          return sendJSON(
            res,
            400,
            {
              ok: false,
              error:
                "bad request"
            }
          );

        }
      }


      /* ======================================================
         GET /active-now
      ====================================================== */

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

            activeNow:
              activeSessions.size,

            at:
              Date.now()

          }
        );
      }


      /* ======================================================
         GET /live-stats
      ====================================================== */

      if (
        req.method === "GET" &&
        parsed.pathname === "/live-stats"
      ) {

        let windowSeconds =
          parseInt(
            parsed.query.windowSeconds
          ) || 600;

        windowSeconds =
          Math.min(
            windowSeconds,
            7776000
          );

        const bucketSeconds =
          Math.max(
            parseInt(
              parsed.query.bucketSeconds
            ) || 10,
            5
          );

        const now =
          Date.now();

        const cutoff =
          now -
          windowSeconds *
          1000;

        const bucketMs =
          bucketSeconds *
          1000;

        const numberOfBuckets =
          Math.ceil(
            (
              now -
              cutoff
            ) /
            bucketMs
          );

        const buckets =
          Array.from(
            {
              length:
                numberOfBuckets
            },
            function() {
              return new Set();
            }
          );

        const pageviews =
          Array.from(
            {
              length:
                numberOfBuckets
            },
            function() {
              return 0;
            }
          );

        for (
          const event of events
        ) {

          if (
            event.ts <
            cutoff
          ) {
            continue;
          }

          const index =
            Math.min(
              Math.floor(
                (
                  event.ts -
                  cutoff
                ) /
                bucketMs
              ),
              numberOfBuckets - 1
            );

          if (
            index < 0
          ) {
            continue;
          }

          buckets[index].add(
            event.sessionId
          );

          pageviews[index] += 1;
        }

        const series =
          buckets.map(
            function(set, index) {

              return {

                t:
                  new Date(
                    cutoff +
                    index *
                    bucketMs
                  )
                  .toISOString(),

                visitors:
                  set.size,

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

            windowSeconds:
              windowSeconds,

            bucketSeconds:
              bucketSeconds,

            series:
              series

          }
        );
      }


      /* ======================================================
         GET /traffic-history
      ====================================================== */

      if (
        req.method === "GET" &&
        parsed.pathname === "/traffic-history"
      ) {

        const now =
          Date.now();

        let from;
        let to =
          now;

        const range =
          String(
            parsed.query.range ||
            "7days"
          )
          .toLowerCase();


        /* CUSTOM DATE */

        if (
          parsed.query.from
        ) {

          const fromDate =
            new Date(
              String(
                parsed.query.from
              ) +
              "T00:00:00"
            );

          const toDate =
            new Date(
              String(
                parsed.query.to ||
                parsed.query.from
              ) +
              "T23:59:59.999"
            );

          if (
            isNaN(
              fromDate.getTime()
            ) ||
            isNaN(
              toDate.getTime()
            )
          ) {

            return sendJSON(
              res,
              400,
              {

                ok: false,

                error:
                  "Invalid date. Use YYYY-MM-DD."

              }
            );
          }

          from =
            fromDate.getTime();

          to =
            toDate.getTime();

        }


        /* TODAY */

        else if (
          range === "today"
        ) {

          const date =
            new Date(now);

          date.setHours(
            0,
            0,
            0,
            0
          );

          from =
            date.getTime();

          date.setHours(
            23,
            59,
            59,
            999
          );

          to =
            date.getTime();

        }


        /* 7 DAYS */

        else if (
          range === "7days"
        ) {

          from =
            now -
            6 *
            24 *
            60 *
            60 *
            1000;

        }


        /* 30 DAYS */

        else if (
          range === "30days"
        ) {

          from =
            now -
            29 *
            24 *
            60 *
            60 *
            1000;

        }


        /* 90 DAYS */

        else if (
          range === "90days"
        ) {

          from =
            now -
            89 *
            24 *
            60 *
            60 *
            1000;

        }


        else {

          return sendJSON(
            res,
            400,
            {

              ok: false,

              error:
                "Invalid range. Use today, 7days, 30days or 90days."

            }
          );

        }


        const filtered =
          events.filter(
            function(event) {

              return (
                event.ts >= from &&
                event.ts <= to
              );

            }
          );


        const daily =
          getDailyHistory(
            from,
            to
          );

        const weekly =
          getWeeklyHistory(
            from,
            to
          );

        const monthly =
          getMonthlyHistory(
            from,
            to
          );


        return sendJSON(
          res,
          200,
          {

            ok: true,

            range:
              range,

            summary: {

              visitors:
                getUniqueVisitors(
                  filtered
                ),

              pageviews:
                filtered.length,

              from:
                new Date(
                  from
                ).toISOString(),

              to:
                new Date(
                  to
                ).toISOString(),

              days:
                daily.length

            },

            daily:
              daily,

            weekly:
              weekly,

            monthly:
              monthly

          }
        );
      }


      /* ======================================================
         GET /health
      ====================================================== */

      if (
        req.method === "GET" &&
        parsed.pathname === "/health"
      ) {

        return sendJSON(
          res,
          200,
          {

            ok: true,

            events:
              events.length,

            historyDays:
              HISTORY_DAYS,

            serverTime:
              new Date()
                .toISOString()

          }
        );
      }


      /* ======================================================
         DASHBOARD
      ====================================================== */

      if (
        req.method === "GET" &&
        (
          parsed.pathname === "/" ||
          parsed.pathname === "/dashboard.html"
        )
      ) {

        const file =
          path.join(
            __dirname,
            "dashboard.html"
          );

        fs.readFile(
          file,
          function(error, content) {

            if (error) {

              res.writeHead(
                500,
                {
                  "Content-Type":
                    "text/plain"
                }
              );

              return res.end(
                "dashboard.html missing"
              );
            }

            res.writeHead(
              200,
              {
                "Content-Type":
                  "text/html"
              }
            );

            res.end(
              content
            );

          }
        );

        return;
      }


      /* ======================================================
         404
      ====================================================== */

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


/* ============================================================
   START
============================================================ */

server.listen(
  PORT,
  function() {

    console.log(
      "Live tracker running on port " +
      PORT
    );

    console.log(
      "Historical traffic API enabled."
    );

    console.log(
      "History retention: " +
      HISTORY_DAYS +
      " days."
    );

  }
);
