// Header identity is independent of page data and demo fallbacks.
(() => {
  const label = document.getElementById("userName");
  if (!label) return;
  try {
    const email = localStorage.getItem("benefitPilot.employeeEmail");
    const profile = JSON.parse(localStorage.getItem("benefitPilot.employeeProfile") || "null");
    label.textContent = email && profile?.email?.toLowerCase() === email.toLowerCase()
      ? profile.name || email
      : email || "Account";
  } catch {
    label.textContent = "Account";
  }
})();
