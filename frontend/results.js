/* ================= CONFIG ================= */
const CONFIG = {
  EXTRACT_URL:
    window.location.protocol === "file:"
      ? "http://localhost:8001/api/extract"
      : "/api/extract",
  API_URL:
    window.location.protocol === "file:"
      ? "http://localhost:8001/api/analyze"
      : "/api/analyze", // POST: multipart form with `file` (PDF) and/or `text`
  OPTIMIZE_URL:
    window.location.protocol === "file:"
      ? "http://localhost:8001/api/optimize"
      : "/api/optimize", // POST: JSON with the user's schedule + preferences; returns the same shape as API_URL
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
      id, name, description, reasoning, recommended,
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

const state = {
  data: null,
  selected: null,
  net: "in",
  file: null,
  source: null,
  extraction: null,
};

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
  extract({ file, continueToAnalyze: true });
}

$("manualBtn").addEventListener("click", () => {
  const text = $("manualText").value.trim();
  if (!text)
    return showError(
      'Type at least one procedure and its cost, e.g. "Crown (D2740) – $1,400".',
    );
  extract({ text, continueToAnalyze: true });
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

async function extract({ file, text, continueToAnalyze = false }) {
  showError("");
  setBusy(true);
  $("results").hidden = true;
  $("results").classList.remove("show");
  $("loading").hidden = false;
  $("how").hidden = true;

  try {
    const body = new FormData();
    if (file) body.append("file", file);
    if (text) body.append("text", text);
    const email = window.localStorage.getItem("benefitPilot.employeeEmail");
    if (email) body.append("employeeEmail", email);

    try {
      const res = await fetch(CONFIG.EXTRACT_URL, { method: "POST", body });
      if (!res.ok) {
        let message = "The treatment plan could not be extracted.";
        try {
          const payload = await res.json();
          if (payload.error) message = payload.error;
        } catch {
          // Keep the user-facing fallback message for non-JSON responses.
        }
        const error = new Error(message);
        error.apiResponse = true;
        throw error;
      }
      state.extraction = await res.json();
      state.source = { file, text };
    } catch (err) {
      if (!CONFIG.USE_MOCK_ON_ERROR || err.apiResponse) throw err;
      state.extraction = {
        treatment: {
          provider: MOCK.provider,
          visitDate: MOCK.date,
          procedures: MOCK.procedures,
        },
      };
      state.source = { file, text };
    }
    if (continueToAnalyze) {
      await analyzeSource();
    } else {
      await analyzeSource();
    }
  } catch (err) {
    showError(err.message || "We couldn’t process that plan. Please try again.");
  } finally {
    $("loading").hidden = true;
    if ($("results").hidden) $("how").hidden = false;
    setBusy(false);
  }
}

async function analyzeSource() {
  showError("");
  setBusy(true);
  $("loading").hidden = false;
  $("how").hidden = true;
  let i = 0;
  $("loadTitle").textContent = STEPS[1];
  const timer = setInterval(() => {
    i = (i + 1) % STEPS.length;
    $("loadTitle").textContent = STEPS[i];
  }, 1600);
  try {
    const body = new FormData();
    if (state.source.file) body.append("file", state.source.file);
    if (state.source.text) body.append("text", state.source.text);
    const email = window.localStorage.getItem("benefitPilot.employeeEmail");
    if (email) body.append("employeeEmail", email);
    const res = await fetch(CONFIG.API_URL, { method: "POST", body });
    if (!res.ok) throw new Error("The treatment plan could not be analyzed.");
    render(await res.json());
  } catch (err) {
    showError(err.message || "We couldn’t build your care options. Please try again.");
  } finally {
    clearInterval(timer);
    $("loading").hidden = true;
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
  $("addPlanStatus").textContent = "";
  if (!keep || !data.options.some((o) => o.id === state.selected)) {
    state.selected = (
      data.options.find((o) => o.recommended) || data.options[0]
    ).id;
    state.net = "in";
  }

  $("provider").textContent = data.provider;
  $("pdate").textContent = data.date;
  $("dentist").textContent = data.providerDetails?.location
    ? `${data.dentist} • ${data.providerDetails.location}`
    : data.dentist;
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
      <p class="desc">${esc(o.aiExplanation || o.description)}</p>
      <div class="stats">
        <div class="stat"><small>You pay</small><strong>${money(o.youPay)}</strong></div>
        <div class="stat"><small>Plan pays</small><strong>${money(o.planPays)}</strong></div>
        <div class="stat"><small>Remaining after plan</small><strong class="g">${money(o.benefitRemaining)}</strong></div>
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
  state.data.options.forEach(option => {
    const card = document.querySelector(`.opt[data-id="${option.id}"]`);
    const scenario = option.scenario[state.net];
    const values = [scenario.youPay, scenario.planPays, scenario.benefitRemaining];
    card?.querySelectorAll('.stat strong').forEach((value, index) => { value.textContent = money(values[index]); });
  });
  const opt = state.data.options.find((o) => o.id === state.selected);
  const s = opt.scenario[state.net];
  $("scenRows").innerHTML = `
    <div><span>Estimated treatment cost</span><b>${money(s.totalCost)}</b></div>
    <div><span>Plan pays</span><b class="b">${money(s.planPays)}</b></div>
    <div><span>You pay</span><b class="b">${money(s.youPay)}</b></div>
    <div><span>Projected benefit use (2026)</span><b>${money(s.benefitUsed)}</b></div>
    <div><span>Remaining after plan (2026)</span><b class="g">${money(s.benefitRemaining)}</b></div>
    <div><span>Next-year projected use (2027)</span><b>${money(s.nextYearUsed)}</b></div>
    ${s.monthlyPayments ? s.monthlyPayments.map((amount, i) => `<div><span>Estimated ${esc(state.data.months[i])} payment</span><b>${money(amount)}</b></div>`).join("") : ""}`;
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
 $("schedRows").addEventListener("change", (e) => {
  if (!e.target.name?.startsWith("s")) return;
  const row = Number(e.target.name.slice(1));
  const option = state.data.options.find((o) => o.id === state.selected);
  if (option && Number.isInteger(row)) {
    option.schedule[row] = [
      ...document.querySelectorAll(`input[name="${e.target.name}"]`),
    ].indexOf(e.target);
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
    employeeEmail: window.localStorage.getItem("benefitPilot.employeeEmail"),
    provider: data.provider,
    providerDetails: data.providerDetails,
    date: data.date,
    dentist: data.dentist,
    pricing: data.pricing,
    insurance: data.insurance,
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
      throw err;
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


$("addPlanBtn").addEventListener("click", async () => {
  const button = $("addPlanBtn");
  const option = state.data?.options.find(item => item.id === state.selected);
  if (!option) return;
  button.disabled = true;
  $("addPlanStatus").textContent = "Adding plan…";
  try {
    const plan = await window.BenefitData.savePlan({
      optionId: option.id, procedures: state.data.procedures, schedule: option.schedule,
      network: state.net, provider: state.data.provider,
      settings: { ...state.data.settings, latestMonth: $("fLatest").value },
    });
    option.scenario[state.net] = plan.scenario;
    renderScenario();
    $("addPlanStatus").textContent = "Plan added. Dashboard projections updated.";
  } catch (error) {
    $("addPlanStatus").textContent = error.message || "Could not add plan. Please try again.";
  } finally { button.disabled = false; }
});
