// Header identity is independent of page data and demo fallbacks.
(() => {
  const label = document.getElementById("userName");
  if (!label) return;
  const avatar = document.querySelector(".avatar");
  const initials = name => {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length > 1) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return (parts[0] || "A").slice(0, 2).toUpperCase();
  };
  const setName = name => {
    const value = name || "Account";
    label.textContent = value;
    if (avatar) {
      avatar.textContent = initials(value);
      avatar.setAttribute("aria-label", `${value} initials`);
    }
  };
  window.BenefitEmployee = {setName};
  try {
    const email = localStorage.getItem("benefitPilot.employeeEmail");
    const profile = JSON.parse(localStorage.getItem("benefitPilot.employeeProfile") || "null");
    setName(email && profile?.email?.toLowerCase() === email.toLowerCase()
      ? profile.name || email
      : email || "Account");
  } catch {
    setName("Account");
  }
})();
