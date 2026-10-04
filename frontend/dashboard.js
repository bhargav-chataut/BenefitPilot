/* ================= CONFIG ================= */
const CONFIG = {
  SQL_BASE_URL:
    window.location.protocol === "file:"
      ? "http://localhost:8001/MOCKDATA_BASE/"
      : "../MOCKDATA_BASE/",
  SQL_FILES: [
    "plans.sql",
    "employees.sql",
    "benefit_usage.sql",
    "benefit_transactions.sql",
    "upcoming_care.sql",
  ],
  SQL_WASM_URL:
    "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.wasm",
};

/* ================= HELPERS ================= */
const $ = (id) => document.getElementById(id);
const money = (n) => "$" + Number(n).toLocaleString("en-US");
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

async function loadDatabase() {
  if (typeof initSqlJs !== "function") {
    throw new Error("SQLite could not be loaded.");
  }

  const SQL = await initSqlJs({ locateFile: () => CONFIG.SQL_WASM_URL });
  const database = new SQL.Database();
  for (const file of CONFIG.SQL_FILES) {
    const response = await fetch(CONFIG.SQL_BASE_URL + file);
    if (!response.ok) throw new Error(`Could not load ${file}.`);
    database.run(await response.text());
  }
  return database;
}

function queryOne(database, query, params = []) {
  const result = database.exec(query, params);
  if (!result.length || !result[0].values.length) return null;
  return Object.fromEntries(
    result[0].columns.map((column, index) => [
      column,
      result[0].values[0][index],
    ]),
  );
}

function queryAll(database, query, params = []) {
  const result = database.exec(query, params);
  if (!result.length) return [];
  return result[0].values.map((row) =>
    Object.fromEntries(
      result[0].columns.map((column, index) => [column, row[index]]),
    ),
  );
}

/* ================= LOAD ================= */
async function load() {
  try {
    const database = await loadDatabase();
    const email =
      window.localStorage.getItem("benefitPilot.employeeEmail") ||
      "alex.carter@usm-demo.com";
    const data = queryOne(
      database,
      `SELECT e.first_name || ' ' || e.last_name AS name,
              p.plan_reset_month, p.plan_reset_day,
              p.annual_maximum AS annualMax,
              b.annual_benefit_used AS used,
              MAX(0, p.annual_maximum - b.annual_benefit_used) AS remaining
       FROM employees e
       JOIN plans p ON p.plan_id = e.plan_id
       JOIN benefit_usage b ON b.employee_id = e.employee_id
       WHERE e.email = ?`,
      [email],
    );
    if (!data) throw new Error("No employee record found for this account.");
    const year = new Date().getFullYear();
    const months = queryAll(
      database,
      `WITH month_names(month_number, month) AS (
         VALUES
           (1, 'Jan'), (2, 'Feb'), (3, 'Mar'), (4, 'Apr'),
           (5, 'May'), (6, 'Jun'), (7, 'Jul'), (8, 'Aug'),
           (9, 'Sep'), (10, 'Oct'), (11, 'Nov'), (12, 'Dec')
       )
       SELECT m.month,
              COALESCE(SUM(CASE WHEN t.transaction_id IS NOT NULL
                               THEN t.benefit_used ELSE 0 END), 0)
              + COALESCE(SUM(CASE WHEN c.care_id IS NOT NULL
                                  THEN c.estimated_benefit ELSE 0 END), 0)
                AS amount,
              CASE WHEN SUM(CASE WHEN c.care_id IS NOT NULL
                                 THEN 1 ELSE 0 END) > 0
                   THEN 1 ELSE 0 END AS projected
       FROM month_names m
       LEFT JOIN benefit_transactions t
         ON CAST(strftime('%m', t.service_date) AS INTEGER) = m.month_number
        AND strftime('%Y', t.service_date) = ?
        AND t.employee_id = (SELECT employee_id FROM employees WHERE email = ?)
       LEFT JOIN upcoming_care c
         ON CAST(strftime('%m', c.scheduled_date) AS INTEGER) = m.month_number
        AND strftime('%Y', c.scheduled_date) = ?
        AND c.employee_id = (SELECT employee_id FROM employees WHERE email = ?)
        AND c.status = 'scheduled'
       GROUP BY m.month_number, m.month
       ORDER BY m.month_number`,
      [String(year), email, String(year), email],
    );
    const upcoming = queryAll(
      database,
      `SELECT scheduled_date AS date, procedure_name AS procedure,
              provider
       FROM upcoming_care
       WHERE employee_id = (SELECT employee_id FROM employees WHERE email = ?)
         AND status = 'scheduled'
       ORDER BY scheduled_date`,
      [email],
    ).map((care) => ({
      ...care,
      date: new Date(`${care.date}T00:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      href: "results.html",
    }));
    const monthlyMaximum = Math.max(
      0,
      ...months.map((month) => Number(month.amount)),
    );
    const chartAxisMax = Math.max(
      100,
      Math.ceil((monthlyMaximum * 1.3) / 100) * 100,
    );
    render({
      user: { name: data.name },
      planYear: {
        start: `Jan 1, ${year}`,
        end: `Dec 31, ${year}`,
        year,
      },
      annualMax: data.annualMax,
      used: data.used,
      remaining: data.remaining,
      chart: {
        axisMax: chartAxisMax,
        step: chartAxisMax / 4,
        months,
      },
      upcoming,
    });
    $("main").classList.remove("loading");
  } catch (err) {
    console.error("Dashboard database load failed:", err);
    $("main").classList.remove("loading");
    $("main").innerHTML +=
      '<p class="database-error">We couldn’t load your benefits database. Please refresh and try again.</p>';
  }
}

/* ================= RENDER ================= */
function render(d) {
  if (d.user) $("userName").textContent = d.user.name;

  // Annual maximum card
  $("yearLabel").textContent = d.planYear.year;
  $("planYear").textContent =
    `Plan year: ${d.planYear.start} – ${d.planYear.end}`;
  $("max").textContent = money(d.annualMax);
  $("used").textContent = money(d.used);
  $("remaining").textContent = money(d.remaining);
  const pct = Math.round((d.used / d.annualMax) * 100);
  $("pct").textContent = pct + "%";
  const C = 2 * Math.PI * 88;
  requestAnimationFrame(
    () => ($("arc").style.strokeDasharray = `${(pct / 100) * C} ${C}`),
  );

  // Year-at-a-glance chart
  const { axisMax, step, months } = d.chart;
  const ticks = [];
  for (let v = 0; v <= axisMax; v += step) ticks.push(v);

  $("yaxis").innerHTML = ticks
    .map(
      (v) => `<span style="bottom:${(v / axisMax) * 100}%">${money(v)}</span>`,
    )
    .join("");
  $("plot").innerHTML =
    ticks
      .map(
        (v) =>
          `<div class="hline" style="bottom:${(v / axisMax) * 100}%"></div>`,
      )
      .join("") +
    months
      .map(
        (
          m,
        ) => `<div class="col"><div class="bar${m.projected ? " proj" : ""}" style="height:0"
        data-h="${Math.min(100, (m.amount / axisMax) * 100)}" title="${esc(m.month)}: ${money(m.amount)}${m.projected ? " (projected)" : ""}"></div></div>`,
      )
      .join("");
  $("xaxis").innerHTML = months.length
    ? months.map((m) => `<span>${esc(m.month)}</span>`).join("")
    : '<span class="chart-empty">No monthly transactions recorded yet.</span>';
  requestAnimationFrame(() =>
    requestAnimationFrame(() =>
      document
        .querySelectorAll(".bar")
        .forEach((b) => (b.style.height = b.dataset.h + "%")),
    ),
  );

  // Upcoming care
  $("events").innerHTML = d.upcoming.length
    ? d.upcoming
        .map(
          (e) => `
    <li><a class="ev" href="${esc(e.href || "results.html")}">
      <i></i><span class="date">${esc(e.date)}</span>
      <span><strong>${esc(e.procedure)}</strong><small>${esc(e.provider)}</small></span>
      <svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>
    </a></li>`,
        )
        .join("")
    : '<li class="empty">No upcoming care scheduled yet.</li>';
}

load();
