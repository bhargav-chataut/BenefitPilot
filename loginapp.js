/* Login UI. Password verification and sessions are handled by server.js. */
const form = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const errorMessage = document.getElementById("loginError");
const submitButton = document.getElementById("signInBtn");
const submitLabel = document.getElementById("signInLabel");
const passwordToggle = document.getElementById("togglePw");

function showLoginError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = !message;
}

passwordToggle.addEventListener("click", () => {
  const show = passwordInput.type === "password";
  passwordInput.type = show ? "text" : "password";
  passwordToggle.setAttribute("aria-pressed", String(show));
  passwordToggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submitButton.disabled) return;
  showLoginError("");

  const email = emailInput.value.trim().toLowerCase();
  const password = passwordInput.value; // Passwords are case-sensitive; do not trim.
  if (!email || !emailInput.validity.valid) {
    showLoginError("Enter a valid work email.");
    emailInput.focus();
    return;
  }
  if (!password) {
    showLoginError("Enter your password.");
    passwordInput.focus();
    return;
  }

  submitButton.disabled = true;
  submitButton.classList.add("loading");
  submitLabel.textContent = "Signing in...";
  form.setAttribute("aria-busy", "true");

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email, password }),
    });
    const result = await response.json();
    if (!response.ok) {
      showLoginError(result.message || "Unable to sign in. Please try again.");
      return;
    }
    // The server has set an HttpOnly session cookie. No password is stored here.
    window.location.assign("/dashboard.html");
  } catch {
    showLoginError("Cannot reach the login server. Open this page through http://localhost:3000.");
  } finally {
    submitButton.disabled = false;
    submitButton.classList.remove("loading");
    submitLabel.textContent = "Sign In";
    form.removeAttribute("aria-busy");
  }
});
