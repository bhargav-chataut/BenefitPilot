/* ================= CONFIG ================= */
const CONFIG = {
  API_URL: "/api/analyze", // POST: multipart form with `file` (PDF) and/or `text`
  OPTIMIZE_URL: "/api/optimize", // POST: JSON with the user's schedule + preferences; returns the same shape as API_URL
  USE_MOCK_ON_ERROR: true, // set to false once your backend is live
};

/*
  Expected backend response (JSON):
  {
    provider, date, dentist,
    months: ["Oct","Nov","Dec","Jan"],
    procedures: [{ name, code, cost }],
    settings: { budget, priority, provider, latestMonth },
    options: [{
      id, name, description, recommended,
      youPay, planPays, benefitRemaining, range,
      schedule: [monthIndex per procedure],
      scenario: {
        in:  { totalCost, planPays, youPay, benefitUsed, benefitRemaining, nextYearUsed },
        out: { ...same keys }
      }
    }]
  }
*/
const MOCK = {
  provider: "Downtown Dental",
  date: "Oct 3, 2026",
  dentist: "Dr. Sarah Mitchell",
  months: ["Oct", "Nov", "Dec", "Jan"],
  procedures: [
    { name: "Crown", code: "D2740", cost: 1400 },
    { name: "Filling #1", code: "D2391", cost: 250 },
    { name: "Filling #2", code: "D2391", cost: 225 },
  ],
  settings: {
    budget: "$500",
    priority: "Lowest cost",
    provider: "In-network preferred",
    latestMonth: "Jan",
  },
  options: [
    {
      id: "budget",
      name: "Budget",
      recommended: true,
      description:
        "Maximize your benefits and minimize your out-of-pocket costs.",
      youPay: 700,
      planPays: 1175,
      benefitRemaining: 520,
      range: "Oct 2026 – Jan 2027",
      schedule: [0, 1, 2],
      scenario: {
        in: {
          totalCost: 1875,
          planPays: 1175,
          youPay: 700,
          benefitUsed: 1175,
          benefitRemaining: 520,
          nextYearUsed: 0,
        },
        out: {
          totalCost: 1875,
          planPays: 940,
          youPay: 935,
          benefitUsed: 940,
          benefitRemaining: 755,
          nextYearUsed: 0,
        },
      },
    },
    {
      id: "balanced",
      name: "Balanced",
      description: "Balance your costs and use benefits efficiently.",
      youPay: 820,
      planPays: 1060,
      benefitRemaining: 250,
      range: "Oct 2026 – Jan 2027",
      schedule: [0, 0, 3],
      scenario: {
        in: {
          totalCost: 1875,
          planPays: 1060,
          youPay: 815,
          benefitUsed: 1060,
          benefitRemaining: 250,
          nextYearUsed: 0,
        },
        out: {
          totalCost: 1875,
          planPays: 850,
          youPay: 1025,
          benefitUsed: 850,
          benefitRemaining: 460,
          nextYearUsed: 0,
        },
      },
    },
    {
      id: "premium",
      name: "Premium",
      description: "Get treatment sooner with minimal out-of-pocket costs.",
      youPay: 975,
      planPays: 900,
      benefitRemaining: 80,
      range: "Oct 2026 – Dec 2026",
      schedule: [0, 0, 1],
      scenario: {
        in: {
          totalCost: 1875,
          planPays: 900,
          youPay: 975,
          benefitUsed: 900,
          benefitRemaining: 80,
          nextYearUsed: 0,
        },
        out: {
          totalCost: 1875,
          planPays: 720,
          youPay: 1155,
          benefitUsed: 720,
          benefitRemaining: 260,
          nextYearUsed: 0,
        },
      },
    },
  ],
};

/* ================= HELPERS ================= */
const $ = (id) => document.getElementById(id);
const money = (n) => "$" + Number(n).toLocaleString("en-US");
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const state = { data: null, selected: null, net: "in", file: null };

/* ================= INPUTS ================= */
const dropzone = $("dropzone"),
  fileInput = $("fileInput");

$("chooseBtn").addEventListener("click", () => fileInput.click());
fileInput.addEventListener(
  "change",
  () => fileInput.files[0] && handleFile(fileInput.files[0]),
);

["dragenter", "dragover"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add("drag");
  }),
);
["dragleave", "drop"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag");
  }),
);
dropzone.addEventListener(
  "drop",
  (e) => e.dataTransfer.files[0] && handleFile(e.dataTransfer.files[0]),
);

function handleFile(file) {
  if (
    file.type !== "application/pdf" &&
    !file.name.toLowerCase().endsWith(".pdf")
  )
    return showError("Please upload a PDF file.");
  if (file.size > 10 * 1024 * 1024)
    return showError("That file is over 10 MB. Please upload a smaller PDF.");
  state.file = file;
  $("fileName").textContent = file.name;
  $("fileName").classList.add("ok");
  analyze({ file });
}

$("manualBtn").addEventListener("click", () => {
  const text = $("manualText").value.trim();
  if (!text)
    return showError(
      'Type at least one procedure and its cost, e.g. "Crown (D2740) – $1,400".',
    );
  analyze({ text });
});

function showError(msg) {
  const el = $("formError");
  el.textContent = msg;
  el.hidden = !msg;
}

/* ================= ANALYZE ================= */
const STEPS = [
  "Reading your treatment plan…",
  "Matching procedures to your benefits…",
  "Building your care options…",
];

async function analyze({ file, text }) {
  showError("");
  setBusy(true);
  $("results").hidden = true;
  $("results").classList.remove("show");
  $("loading").hidden = false;
  $("how").hidden = true;

  let i = 0;
  $("loadTitle").textContent = STEPS[0];
  const timer = setInterval(() => {
    i = (i + 1) % STEPS.length;
    $("loadTitle").textContent = STEPS[i];
  }, 1600);

  try {
    const body = new FormData();
    if (file) body.append("file", file);
    if (text) body.append("text", text);

    let data;
    try {
      const res = await fetch(CONFIG.API_URL, { method: "POST", body });
      if (!res.ok) throw new Error("Request failed (" + res.status + ")");
      data = await res.json();
    } catch (err) {
      if (!CONFIG.USE_MOCK_ON_ERROR) throw err;
      await wait(3500); // simulate AI processing time
      data = MOCK;
    }
    render(data);
  } catch (err) {
    showError("We couldn’t process that plan. Please try again.");
  } finally {
    clearInterval(timer);
    $("loading").hidden = true;
    if ($("results").hidden) $("how").hidden = false;
    setBusy(false);
  }
}

function setBusy(on) {
  ["chooseBtn", "manualBtn"].forEach((id) => ($(id).disabled = on));
  $("manualText").disabled = on;
}

/* ================= RENDER ================= */
function render(data, keep = false) {
  state.data = data;
  if (!keep || !data.options.some((o) => o.id === state.selected)) {
    state.selected = (
      data.options.find((o) => o.recommended) || data.options[0]
    ).id;
    state.net = "in";
  }

  $("provider").textContent = data.provider;
  $("pdate").textContent = data.date;
  $("dentist").textContent = data.dentist;
  $("pcount").textContent = data.procedures.length + " procedures";

  $("procList").innerHTML = data.procedures
    .map(
      (p) => `
    <li><svg class="ic"><use href="#tooth"/></svg>
      <span>${esc(p.name)} <small>(${esc(p.code)})</small></span><span class="p">${money(p.cost)}</span></li>`,
    )
    .join("");

  $("fLatest").innerHTML = data.months
    .map((m) => `<option>${esc(m)}</option>`)
    .join("");
  setSelect("fBudget", data.settings.budget);
  setSelect("fPriority", data.settings.priority);
  setSelect("fProvider", data.settings.provider);
  setSelect("fLatest", data.settings.latestMonth);

  $("options").innerHTML = data.options
    .map(
      (o) => `
    <label class="opt card" data-id="${esc(o.id)}">
      <input type="radio" name="opt" value="${esc(o.id)}">
      <div class="head"><span class="radio"></span><h4>${esc(o.name)}</h4>${o.recommended ? '<span class="badge">Recommended</span>' : ""}</div>
      <p class="desc">${esc(o.description)}</p>
      <div class="stats">
        <div class="stat"><small>You pay</small><strong>${money(o.youPay)}</strong></div>
        <div class="stat"><small>Plan pays</small><strong>${money(o.planPays)}</strong></div>
        <div class="stat"><small>Benefit remaining</small><strong class="g">${money(o.benefitRemaining)}</strong></div>
      </div>
      <div class="meta"><svg class="ic"><use href="#cal"/></svg>${data.procedures.length} procedures &bull; ${esc(o.range)}</div>
    </label>`,
    )
    .join("");

  renderSelected();

  document.body.classList.remove("intake-mode");
  $("how").hidden = true;
  $("results").hidden = false;
  if (!keep) {
    $("results").classList.add("show");
    $("results").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function setSelect(id, value) {
  const el = $(id);
  if (![...el.options].some((o) => o.text === value))
    el.add(new Option(value, value));
  el.value = value;
}

function renderSelected() {
  const { data } = state;
  const opt = data.options.find((o) => o.id === state.selected);

  document.querySelectorAll(".opt").forEach((el) => {
    const on = el.dataset.id === state.selected;
    el.classList.toggle("sel", on);
    el.querySelector("input").checked = on;
  });

  $("months").innerHTML =
    "<span></span>" +
    data.months
      .map(
        (m, i) =>
          `<span class="${i === opt.schedule[0] ? "on" : ""}">${esc(m)}</span>`,
      )
      .join("");

  $("schedRows").innerHTML = data.procedures
    .map(
      (p, r) => `
    <div class="sched"><span>${esc(p.name)} <small>(${esc(p.code)})</small></span>
      ${data.months.map((_, c) => `<input type="radio" name="s${r}" aria-label="${esc(p.name)} in ${esc(data.months[c])}" ${opt.schedule[r] === c ? "checked" : ""}>`).join("")}
    </div>`,
    )
    .join("");

  renderScenario();
}

function renderScenario() {
  const opt = state.data.options.find((o) => o.id === state.selected);
  const s = opt.scenario[state.net];
  $("scenRows").innerHTML = `
    <div><span>Estimated treatment cost</span><b>${money(s.totalCost)}</b></div>
    <div><span>Plan pays</span><b class="b">${money(s.planPays)}</b></div>
    <div><span>You pay</span><b class="b">${money(s.youPay)}</b></div>
    <div><span>Annual benefit used (2026)</span><b>${money(s.benefitUsed)}</b></div>
    <div><span>Annual benefit remaining (2026)</span><b class="g">${money(s.benefitRemaining)}</b></div>
    <div><span>Next-year benefit used (2027)</span><b>${money(s.nextYearUsed)}</b></div>`;
  document
    .querySelectorAll(".seg button")
    .forEach((b) => b.classList.toggle("on", b.dataset.net === state.net));
}

/* ================= INTERACTIONS ================= */
$("options").addEventListener("change", (e) => {
  if (e.target.name === "opt") {
    state.selected = e.target.value;
    renderSelected();
  }
});
document.querySelector(".seg").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) {
    state.net = b.dataset.net;
    renderScenario();
  }
});

/* ================= OPTIMIZE ================= */
/*
  Request body sent to OPTIMIZE_URL:
  { optionId, network: "in" | "out", procedures: [...],
    schedule: [monthIndex per procedure],
    settings: { budget, priority, provider, latestMonth } }
  Response: the same JSON shape as the analyze response (full, updated data).
*/
$("optimizeBtn").addEventListener("click", optimize);

async function optimize() {
  const { data } = state;
  const schedule = data.procedures.map((_, r) =>
    [...document.querySelectorAll(`input[name="s${r}"]`)].findIndex(
      (i) => i.checked,
    ),
  );
  const settings = {
    budget: $("fBudget").value,
    priority: $("fPriority").value,
    provider: $("fProvider").value,
    latestMonth: $("fLatest").value,
  };
  const payload = {
    optionId: state.selected,
    network: state.net,
    procedures: data.procedures,
    schedule,
    settings,
  };

  const btn = $("optimizeBtn"),
    plan = document.querySelector(".plan");
  btn.disabled = true;
  btn.classList.add("working");
  plan.classList.add("busy");
  $("optimizeLabel").textContent = "Optimizing…";

  try {
    let next;
    try {
      const res = await fetch(CONFIG.OPTIMIZE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Request failed (" + res.status + ")");
      next = await res.json();
    } catch (err) {
      if (!CONFIG.USE_MOCK_ON_ERROR) throw err;
      await wait(2200); // simulate AI processing time
      next = JSON.parse(JSON.stringify(data)); // demo only: nudge the selected option's numbers
      const o = next.options.find((x) => x.id === state.selected);
      o.schedule = schedule;
      o.youPay = Math.max(0, o.youPay - 25);
      o.planPays += 25;
      ["in", "out"].forEach((k) => {
        o.scenario[k].youPay = Math.max(0, o.scenario[k].youPay - 25);
        o.scenario[k].planPays += 25;
      });
      next.settings = settings;
    }
    render(next, true);
  } catch (err) {
    showError("We couldn’t update your plan. Please try again.");
  } finally {
    btn.disabled = false;
    btn.classList.remove("working");
    plan.classList.remove("busy");
    $("optimizeLabel").textContent = "Optimize my plan";
  }
}
