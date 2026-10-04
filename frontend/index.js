/* ================= CONFIG ================= */
const AUTH = {
  LOGIN_URL: "/api/login", // POST JSON { email, password } -> 2xx on success
  REDIRECT_TO: "dashboard.html", // where to go after sign-in
  USE_MOCK_ON_ERROR: true, // set to false once your backend is live
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
    try {
      const res = await fetch(AUTH.LOGIN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.status === 401 || res.status === 403)
        throw Object.assign(new Error("bad"), { auth: true });
      if (!res.ok) throw new Error("Request failed (" + res.status + ")");
    } catch (err) {
      if (err.auth || !AUTH.USE_MOCK_ON_ERROR) throw err;
      await new Promise((r) => setTimeout(r, 900)); // demo only: backend not reachable
    }
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
