/* Local HTML demo backend. Requires Node.js 22.13+ (24 LTS recommended).
 * Uses the existing SQL fixtures, not a hardcoded list in the browser.
 * Database and sessions are in memory and reset when the server restarts.
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, scryptSync, timingSafeEqual } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const root = __dirname;
const port = Number(process.env.PORT || 3000);
const db = new DatabaseSync(":memory:");
db.exec(fs.readFileSync(path.join(root, "MOCKDATA_BASE", "plans.sql"), "utf8"));
db.exec(fs.readFileSync(path.join(root, "MOCKDATA_BASE", "employees.sql"), "utf8"));

// Convert fixture passwords to salted hashes in the running database.
const updatePassword = db.prepare("UPDATE employees_h SET password = ? WHERE employee_id = ?");
function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
for (const employee of db.prepare("SELECT employee_id, password FROM employees_h").all()) {
  updatePassword.run(hashPassword(employee.password), employee.employee_id);
}
const dummyHash = hashPassword(randomBytes(32).toString("hex"));
function verifyPassword(password, storedHash) {
  const [salt, expected] = storedHash.split(":");
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(expected, "hex"));
}

const sessions = new Map();
const sessionLifetime = 8 * 60 * 60 * 1000;
function currentEmployeeId(request) {
  const token = (request.headers.cookie || "").split(";")
    .map((part) => part.trim()).find((part) => part.startsWith("benefitpilot_session="))
    ?.slice("benefitpilot_session=".length);
  const session = token && sessions.get(token);
  if (!session) return null;
  if (session.expires <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session.employeeId;
}

function json(response, status, data, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(data));
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw new Error("Request too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const files = new Map([
  ["/login.html", ["login.html", "text/html"]],
  ["/loginapp.js", ["loginapp.js", "text/javascript"]],
  ["/loginstyle.css", ["loginstyle.css", "text/css"]],
  ["/dashboard.html", ["dashboard.html", "text/html"]],
  ["/treatments.html", ["treatments.html", "text/html"]],
  ["/app.js", ["app.js", "text/javascript"]],
  ["/styles.css", ["styles.css", "text/css"]],
]);

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/api/login" && request.method === "POST") {
      // Reject cross-origin submissions. The UI posts JSON from this server.
      if (request.headers.origin && request.headers.origin !== "http://" + request.headers.host) {
        return json(response, 403, { message: "Invalid request origin." });
      }
      if (!request.headers["content-type"]?.startsWith("application/json")) {
        return json(response, 415, { message: "Expected a JSON request." });
      }
      let input;
      try { input = await readJson(request); }
      catch { return json(response, 400, { message: "Invalid login request." }); }
      if (!input || typeof input.email !== "string" || typeof input.password !== "string") {
        return json(response, 400, { message: "Email and password are required." });
      }
      const email = input.email.trim().toLowerCase();
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
          || !input.password || input.password.length > 1024) {
        return json(response, 400, { message: "Enter a valid email and password." });
      }
      // Parameter binding prevents an email from being interpreted as SQL.
      const employee = db.prepare(
        "SELECT employee_id, password FROM employees_h WHERE email = ? COLLATE NOCASE"
      ).get(email);
      const validPassword = verifyPassword(input.password, employee?.password || dummyHash);
      if (!employee || !validPassword) {
        return json(response, 401, { message: "Incorrect email or password." });
      }
      for (const [token, session] of sessions) {
        if (session.expires <= Date.now()) sessions.delete(token);
      }
      // Rotate the current session on every successful login.
      const oldToken = (request.headers.cookie || "").split(";")
        .map((part) => part.trim()).find((part) => part.startsWith("benefitpilot_session="))
        ?.slice("benefitpilot_session=".length);
      if (oldToken) sessions.delete(oldToken);
      const token = randomBytes(32).toString("hex");
      sessions.set(token, { employeeId: employee.employee_id, expires: Date.now() + sessionLifetime });
      return json(response, 200, { success: true }, {
        "Set-Cookie": `benefitpilot_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`,
      });
    }

    // dashboard.html can call this endpoint to load its signed-in user and plan.
    if (url.pathname === "/api/me" && request.method === "GET") {
      const employeeId = currentEmployeeId(request);
      if (!employeeId) return json(response, 401, { message: "Please sign in." });
      const employee = db.prepare(`
        SELECT e.employee_id, e.first_name, e.last_name, e.email, e.employer,
               e.hsa_enrolled, e.hsa_balance, e.fsa_enrolled, e.fsa_balance,
               p.plan_id, p.plan_name, p.plan_type, p.provider, p.annual_maximum,
               p.deductible, p.preventive_coverage, p.basic_coverage, p.major_coverage,
               p.in_network_supported, p.out_of_network_supported,
               p.plan_reset_month, p.plan_reset_day
        FROM employees_h e JOIN plans_h p ON e.plan_id = p.plan_id
        WHERE e.employee_id = ?
      `).get(employeeId);
      return json(response, 200, { employee });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return json(response, 405, { message: "Method not allowed." });
    }
    if (url.pathname === "/") {
      response.writeHead(302, { Location: "/login.html" });
      return response.end();
    }
    if (url.pathname === "/dashboard.html" && !currentEmployeeId(request)) {
      response.writeHead(302, { Location: "/login.html", "Cache-Control": "no-store" });
      return response.end();
    }
    // Explicit allowlist keeps SQL fixtures, credentials, and server code private.
    const file = files.get(url.pathname);
    if (!file || !fs.existsSync(path.join(root, file[0]))) {
      if (url.pathname === "/dashboard.html") {
        response.writeHead(404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        return response.end("<h1>Login successful</h1><p>Add dashboard.html to the project folder to display your dashboard here.</p>");
      }
      return json(response, 404, { message: "Page not found." });
    }
    response.writeHead(200, { "Content-Type": file[1] + "; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    response.end(request.method === "HEAD" ? undefined : fs.readFileSync(path.join(root, file[0])));
  } catch {
    if (!response.headersSent) json(response, 500, { message: "Unable to complete the request. Please try again." });
    else response.end();
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`BenefitPilot login: http://localhost:${port}/login.html`);
});
