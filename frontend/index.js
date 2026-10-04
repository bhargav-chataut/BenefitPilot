/* ================= CONFIG ================= */
const AUTH = {
  LOGIN_URL:
    window.location.protocol === "file:"
      ? "http://localhost:8001/api/login"
      : "/api/login",
  REDIRECT_TO: "dashboard.html", // where to go after sign-in
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

async function authenticate(email, password) {
  const response = await fetch(AUTH.LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error("Incorrect email or password."), {
      auth: true,
    });
  }
  if (!response.ok) throw new Error(`Login request failed (${response.status}).`);
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
    await authenticate(email, password);
    window.localStorage.setItem("benefitPilot.employeeEmail", email);
    window.location.href = AUTH.REDIRECT_TO;
  } catch (err) {
    showError(
      err.auth
        ? "Incorrect email or password."
        : "We couldn’t sign you in. Please try again.",
    );
    setLoading(false);
  }
});
