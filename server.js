/**
 * ============================================================
 * LIVE VISITOR TRACKER
 * ============================================================
 *
 * Endpoints:
 *
 * POST /track
 * GET  /live-stats
 * GET  /active-now
 *
 * NEW:
 * GET /traffic-history?range=today
 * GET /traffic-history?range=7days
 * GET /traffic-history?range=30days
 * GET /traffic-history?from=2026-08-01&to=2026-08-08
 *
 * GET /
 * GET /dashboard.html
 *
 * Data is stored in events.jsonl.
 * Historical data can be read after server restart.
 *
 * ============================================================
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");


/* ============================================================
   CONFIGURATION
============================================================ */

const PORT =
    process.env.PORT || 4000;

const ALLOWED_ORIGIN =
    process.env.ALLOWED_ORIGIN || "*";

const EVENTS_FILE =
    path.join(__dirname, "events.jsonl");


/*
   Active visitor = visitor pinged
   during the last 60 seconds.
*/

const ACTIVE_WINDOW_MS =
    60 * 1000;


/*
   Keep a large amount of traffic
   in memory for fast live statistics.

   Disk remains the permanent history.
*/

const MAX_EVENTS_IN_MEMORY =
    500000;


/*
   How many days of history the server
   loads from events.jsonl on startup.

   90 days gives you plenty of history.
*/

const HISTORY_DAYS =
    90;


/* ============================================================
   EVENTS
============================================================ */

/**
 * @type {{
 *   ts:number,
 *   sessionId:string,
 *   page:string,
 *   ref:string,
 *   event:string
 * }[]}
 */

let events = [];


/* ============================================================
   LOAD HISTORY
============================================================ */

function loadEvents() {

    if (!fs.existsSync(EVENTS_FILE)) {

        console.log(
            "No events.jsonl found. Starting with empty history."
        );

        return;
    }


    try {

        const lines =
            fs.readFileSync(
                EVENTS_FILE,
                "utf8"
            )
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

                const e =
                    JSON.parse(line);


                if (
                    e &&
                    Number.isFinite(e.ts) &&
                    e.ts >= cutoff
                ) {

                    events.push(e);

                }

            } catch (_) {

                /*
                   Ignore corrupted lines.
                */

            }

        }


        /*
           Safety limit.
        */

        if (
            events.length >
            MAX_EVENTS_IN_MEMORY
        ) {

            events =
                events.slice(
                    events.length -
                    MAX_EVENTS_IN_MEMORY
                );

        }


        console.log(
            `Loaded ${events.length} traffic events from disk`
        );


    } catch (err) {

        console.error(
            "Could not load events.jsonl:",
            err.message
        );

    }

}


loadEvents();


/* ============================================================
   SAVE EVENT
============================================================ */

function appendToDisk(event) {

    fs.appendFile(
        EVENTS_FILE,
        JSON.stringify(event) + "\n",
        (err) => {

            if (err) {

                console.error(
                    "Could not save event:",
                    err.message
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
   READ REQUEST BODY
============================================================ */

function readBody(req) {

    return new Promise(
        (resolve, reject) => {

            let data = "";


            req.on(
                "data",
                chunk => {

                    data += chunk;


                    if (
                        data.length >
                        1e6
                    ) {

                        req.destroy();

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


/* ============================================================
   DATE HELPERS
============================================================ */

function startOfDay(timestamp) {

    const d =
        new Date(timestamp);


    d.setHours(
        0,
        0,
        0,
        0
    );


    return d.getTime();

}


function endOfDay(timestamp) {

    const d =
        new Date(timestamp);


    d.setHours(
        23,
        59,
        59,
        999
    );


    return d.getTime();

}


/* ============================================================
   UNIQUE VISITORS
============================================================ */

function uniqueVisitors(
    list
) {

    const set =
        new Set();


    for (
        const event of list
    ) {

        set.add(
            event.sessionId
        );

    }


    return set.size;

}


/* ============================================================
   DAILY HISTORY
============================================================ */

function getDailyHistory(
    from,
    to
) {

    const days = [];


    const first =
        new Date(from);

    first.setHours(
        0,
        0,
        0,
        0
    );


    const last =
        new Date(to);

    last.setHours(
        0,
        0,
        0,
        0
    );


    for (
        let d =
            first.getTime();

        d <= last.getTime();

        d +=
            24 *
            60 *
            60 *
            1000
    ) {

        const dayStart =
            d;

        const dayEnd =
            d +
            24 *
            60 *
            60 *
            1000 -
            1;


        const dayEvents =
            events.filter(
                event =>
                    event.ts >= dayStart &&
                    event.ts <= dayEnd
            );


        const visitors =
            uniqueVisitors(
                dayEvents
            );


        const pageviews =
            dayEvents.length;


        days.push({

            date:
                new Date(
                    dayStart
                )
                .toISOString()
                .slice(
                    0,
                    10
                ),

            visitors,

            pageviews

        });

    }


    return days;

}


/* ============================================================
   WEEKLY HISTORY
============================================================ */

function getWeeklyHistory(
    from,
    to
) {

    const weeks = new Map();


    for (
        const event of events
    ) {

        if (
            event.ts < from ||
            event.ts > to
        ) {

            continue;

        }


        const d =
            new Date(
                event.ts
            );


        /*
           Monday = start of week.
        */

        const day =
            d.getDay();


        const diff =
            day === 0
                ? -6
                : 1 - day;


        d.setDate(
            d.getDate() +
            diff
        );


        d.setHours(
            0,
            0,
            0,
            0
        );


        const key =
            d.toISOString()
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
        (a,b) =>
            a[0].localeCompare(
                b[0]
            )
    )
    .map(
        ([week, list]) => ({

            week,

            visitors:
                uniqueVisitors(
                    list
                ),

            pageviews:
                list.length

        })
    );

}


/* ============================================================
   MONTHLY HISTORY
============================================================ */

function getMonthlyHistory(
    from,
    to
) {

    const months = new Map();


    for (
        const event of events
    ) {

        if (
            event.ts < from ||
            event.ts > to
        ) {

            continue;

        }


        const d =
            new Date(
                event.ts
            );


        const key =
            d.getFullYear() +
            "-" +
            String(
                d.getMonth() + 1
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
        (a,b) =>
            a[0].localeCompare(
                b[0]
            )
    )
    .map(
        ([month, list]) => ({

            month,

            visitors:
                uniqueVisitors(
                    list
                ),

            pageviews:
                list.length

        })
    );

}


/* ============================================================
   SERVER
============================================================ */

const server =
    http.createServer(
        async (
            req,
            res
        ) => {

            const parsed =
                url.parse(
                    req.url,
                    true
                );


            /* =================================================
               CORS PREFLIGHT
            ================================================= */

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


            /* =================================================
               POST /track
            ================================================= */

            if (
                req.method ===
                    "POST" &&

                parsed.pathname ===
                    "/track"
            ) {

                try {

                    const raw =
                        await readBody(
                            req
                        );


                    const payload =
                        raw
                            ? JSON.parse(
                                raw
                            )
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
                                events.length -
                                MAX_EVENTS_IN_MEMORY
                            );

                    }


                    return sendJSON(
                        res,
                        200,
                        {
                            ok:true
                        }
                    );


                } catch (err) {

                    return sendJSON(
                        res,
                        400,
                        {
                            ok:false,
                            error:
                                "bad request"
                        }
                    );

                }

            }


            /* =================================================
               GET /active-now
            ================================================= */

            if (
                req.method ===
                    "GET" &&

                parsed.pathname ===
                    "/active-now"
            ) {

                const cutoff =
                    Date.now() -
                    ACTIVE_WINDOW_MS;


                const activeSessions =
                    new Set(

                        events

                            .filter(
                                event =>
                                    event.ts >=
                                    cutoff
                            )

                            .map(
                                event =>
                                    event.sessionId
                            )

                    );


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


            /* =================================================
               GET /live-stats
               
               Supports up to 90 days.
            ================================================= */

            if (
                req.method ===
                    "GET" &&

                parsed.pathname ===
                    "/live-stats"
            ) {

                let windowSeconds =
                    parseInt(
                        parsed.query
                            .windowSeconds
                    ) || 600;


                /*
                   Maximum = 90 days.
                */

                windowSeconds =
                    Math.min(
                        windowSeconds,
                        7776000
                    );


                const bucketSeconds =
                    Math.max(
                        parseInt(
                            parsed.query
                                .bucketSeconds
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


                const numBuckets =
                    Math.ceil(
                        (
                            now -
                            cutoff
                        ) /
                        bucketMs
                    );


                /*
                   Prevent extremely large
                   bucket arrays.
                */

                const safeBuckets =
                    Math.min(
                        numBuckets,
                        10000
                    );


                const buckets =
                    Array.from(
                        {
                            length:
                                safeBuckets
                        },
                        () =>
                            new Set()
                    );


                const pageviews =
                    Array.from(
                        {
                            length:
                                safeBuckets
                        },
                        () => 0
                    );


                for (
                    const event
                    of events
                ) {

                    if (
                        event.ts <
                        cutoff
                    ) {

                        continue;

                    }


                    const idx =
                        Math.min(

                            Math.floor(
                                (
                                    event.ts -
                                    cutoff
                                ) /
                                bucketMs
                            ),

                            safeBuckets -
                            1

                        );


                    if (
                        idx < 0
                    ) {

                        continue;

                    }


                    buckets[
                        idx
                    ].add(
                        event.sessionId
                    );


                    pageviews[
                        idx
                    ] += 1;

                }


                const series =
                    buckets.map(
                        (
                            set,
                            i
                        ) => ({

                            t:
                                new Date(
                                    cutoff +
                                    i *
                                    bucketMs
                                )
                                .toISOString(),

                            visitors:
                                set.size,

                            pageviews:
                                pageviews[i]

                        })
                    );


                return sendJSON(
                    res,
                    200,
                    {

                        windowSeconds,

                        bucketSeconds,

                        series

                    }
                );

            }


            /* =================================================
               NEW HISTORICAL TRAFFIC API
               
               /traffic-history?range=today
               /traffic-history?range=7days
               /traffic-history?range=30days
               /traffic-history?range=90days
               
               OR
               
               /traffic-history?from=2026-08-01&to=2026-08-08
            ================================================= */

            if (
                req.method ===
                    "GET" &&

                parsed.pathname ===
                    "/traffic-history"
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


                /* ---------------------------------------------
                   CUSTOM DATE RANGE
                --------------------------------------------- */

                if (
                    parsed.query.from ||
                    parsed.query.to
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

                                ok:false,

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


                /* ---------------------------------------------
                   PRESET RANGES
                --------------------------------------------- */

                else if (
                    range ===
                    "today"
                ) {

                    from =
                        startOfDay(
                            now
                        );


                    to =
                        endOfDay(
                            now
                        );

                }


                else if (
                    range ===
                    "7days"
                ) {

                    from =
                        startOfDay(
                            now -
                            6 *
                            24 *
                            60 *
                            60 *
                            1000
                        );

                }


                else if (
                    range ===
                    "30days"
                ) {

                    from =
                        startOfDay(
                            now -
                            29 *
                            24 *
                            60 *
                            60 *
                            1000
                        );

                }


                else if (
                    range ===
                    "90days"
                ) {

                    from =
                        startOfDay(
                            now -
                            89 *
                            24 *
                            60 *
                            60 *
                            1000
                        );

                }


                else {

                    return sendJSON(
                        res,
                        400,
                        {

                            ok:false,

                            error:
                                "Invalid range."

                        }
                    );

                }


                /* ---------------------------------------------
                   FILTER EVENTS
                --------------------------------------------- */

                const filtered =
                    events.filter(
                        event =>
                            event.ts >= from &&
                            event.ts <= to
                    );


                /* ---------------------------------------------
                   DAILY DATA
                --------------------------------------------- */

                const daily =
                    getDailyHistory(
                        from,
                        to
                    );


                /* ---------------------------------------------
                   WEEKLY DATA
                --------------------------------------------- */

                const weekly =
                    getWeeklyHistory(
                        from,
                        to
                    );


                /* ---------------------------------------------
                   MONTHLY DATA
                --------------------------------------------- */

                const monthly =
                    getMonthlyHistory(
                        from,
                        to
                    );


                /* ---------------------------------------------
                   SUMMARY
                --------------------------------------------- */

                const summary = {

                    visitors:
                        uniqueVisitors(
                            filtered
                        ),

                    pageviews:
                        filtered.length,

                    from:
                        new Date(
                            from
                        )
                        .toISOString(),

                    to:
                        new Date(
                            to
                        )
                        .toISOString(),

                    days:
                        daily.length

                };


                return sendJSON(
                    res,
                    200,
                    {

                        ok:true,

                        range,

                        summary,

                        daily,

                        weekly,

                        monthly

                    }
                );

            }


            /* =================================================
               SERVER HEALTH
            ================================================= */

            if (
                req.method ===
                    "GET" &&

                parsed.pathname ===
                    "/health"
            ) {

                return sendJSON(
                    res,
                    200,
                    {

                        ok:true,

                        events:
                            events.length,

                        serverTime:
                            new Date()
                                .toISOString(),

                        historyDays:
                            HISTORY_DAYS

                    }
                );

            }


            /* =================================================
               DASHBOARD
            ================================================= */

            if (
                req.method ===
                    "GET" &&

                (
                    parsed.pathname ===
                        "/" ||

                    parsed.pathname ===
                        "/dashboard.html"
                )
            ) {

                const file =
                    path.join(
                        __dirname,
                        "dashboard.html"
                    );


                fs.readFile(
                    file,
                    (
                        err,
                        content
                    ) => {

                        if (err) {

                            res.writeHead(
                                500
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


            /* =================================================
               404
            ================================================= */

            return sendJSON(
                res,
                404,
                {

                    ok:false,

                    error:
                        "not found"

                }
            );

        }
    );


/* ============================================================
   START SERVER
============================================================ */

server.listen(
    PORT,
    () => {

        console.log(
            `Live tracker running on port ${PORT}`
        );

        console.log(
            `Historical traffic API enabled`
        );

        console.log(
            `History retention: ${HISTORY_DAYS} days`
        );

    }
);
