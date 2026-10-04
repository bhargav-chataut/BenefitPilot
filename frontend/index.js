/* ================= CONFIG ================= */
const AUTH = {
  LOGIN_URL: "/api/login", // POST JSON { email, password }
  REDIRECT_TO: "results.html", // Go directly to Treatments page
  USE_MOCK_ON_ERROR: true, // fallback if offline
};

const $ = (id) => document.getElementById(id);
const form = $("loginForm"),
  pw = $("password"),
  toggle = $("togglePw");

/* Show / hide password */
toggle.addEventListener("click", () => {
  const show = pw.type === "password";
  pw.type = show ? "text" : "password";
  toggle.setAttribute("aria-pressed", String(show));
  toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
});

function showError(msg) {
  const el = $("loginError");
  el.textContent = msg;
  el.hidden = !msg;
}

function setLoading(on) {
  $("signInBtn").disabled = on;
  $("signInBtn").classList.toggle("loading", on);
  $("signInLabel").textContent = on ? "Signing in…" : "Sign In";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("");
  const email = $("email").value.trim(),
    password = pw.value;

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    showError("Enter a valid work email address.");
    return $("email").focus();
  }
  if (!password) {
    showError("Enter your password.");
    return pw.focus();
  }

  setLoading(true);
  try {
    let payload = null;
    try {
      const res = await fetch(AUTH.LOGIN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const body = await res.json().catch(() => null);

      if (res.status === 401 || res.status === 403) {
        throw Object.assign(new Error(body?.error || "Incorrect email or password."), { auth: true });
      }
      if (!res.ok) {
        throw new Error(body?.error || "Request failed (" + res.status + ")");
      }

      payload = body;
    } catch (err) {
      if (err.auth || !AUTH.USE_MOCK_ON_ERROR) throw err;

      // Demo fallback if backend is offline
      await new Promise((r) => setTimeout(r, 600));
      payload = {
        employee: {
          fullName: "Alex Carter",
          email: email,
          employer: "USM",
          hsaBalance: 500,
          fsaBalance: 300,
        },
        plan: {
          planName: "Dental PPO Plus",
          annualMaximum: 2000,
          deductible: 50,
        },
        usage: {
          annualBenefitUsed: 620,
          deductibleUsed: 50,
          annualBenefitRemaining: 1380,
          deductibleRemaining: 0,
        },
        redirectTo: AUTH.REDIRECT_TO,
      };
    }

    // Save session data for Treatments page to consume
    if (payload) {
      sessionStorage.setItem("benefitpilot_session", JSON.stringify(payload));
    }

    // Go directly to Treatments
    window.location.href = payload?.redirectTo || AUTH.REDIRECT_TO;
  } catch (err) {
    showError(
      err.message ||
        (err.auth
          ? "Incorrect email or password."
          : "We couldn’t sign you in. Please try again.")
    );
    setLoading(false);
  }
});
