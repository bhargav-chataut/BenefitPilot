const express = require("express");
const { pool } = require("./db");

const router = express.Router();

/**
  Fallback mock data in case the database is offline or during testing
 */
const MOCK_FALLBACK = {
  "alex.carter@usm-demo.com": {
    employee_id: "EMP001",
    first_name: "Alex",
    last_name: "Carter",
    email: "alex.carter@usm-demo.com",
    password: "password123",
    employer: "USM",
    hsa_enrolled: 1,
    hsa_balance: 500,
    fsa_enrolled: 1,
    fsa_balance: 300,
    plan_id: "PLAN_PLUS",
    plan_name: "Dental PPO Plus",
    plan_type: "PPO",
    provider: "Lincoln Financial",
    annual_maximum: 2000,
    deductible: 50,
    preventive_coverage: 100,
    basic_coverage: 90,
    major_coverage: 60,
    orthodontic_coverage: 50,
    in_network_supported: 1,
    out_of_network_supported: 1,
    plan_reset_month: 1,
    plan_reset_day: 1,
    annual_benefit_used: 620,
    deductible_used: 50,
  }
};

/*
 Formats flat joined row into clean structured response:
{ employee, plan, usage, redirectTo }
 */
function formatEmployeePayload(row) {
  const annualMax = Number(row.annual_maximum) || 0;
  const annualUsed = Number(row.annual_benefit_used) || 0;
  const deductible = Number(row.deductible) || 0;
  const deductibleUsed = Number(row.deductible_used) || 0;

  const annualBenefitRemaining = Math.max(0, annualMax - annualUsed);
  const deductibleRemaining = Math.max(0, deductible - deductibleUsed);

  return {
    employee: {
      employeeId: row.employee_id,
      firstName: row.first_name,
      lastName: row.last_name,
      fullName: `${row.first_name} ${row.last_name}`,
      email: row.email,
      employer: row.employer,
      hsaEnrolled: Boolean(row.hsa_enrolled),
      hsaBalance: Number(row.hsa_balance) || 0,
      fsaEnrolled: Boolean(row.fsa_enrolled),
      fsaBalance: Number(row.fsa_balance) || 0,
    },
    plan: {
      planId: row.plan_id,
      planName: row.plan_name,
      planType: row.plan_type,
      provider: row.provider,
      annualMaximum: annualMax,
      deductible: deductible,
      preventiveCoverage: Number(row.preventive_coverage) || 0,
      basicCoverage: Number(row.basic_coverage) || 0,
      majorCoverage: Number(row.major_coverage) || 0,
      orthodonticCoverage: Number(row.orthodontic_coverage) || 0,
      inNetworkSupported: Boolean(row.in_network_supported),
      outOfNetworkSupported: Boolean(row.out_of_network_supported),
      planResetMonth: Number(row.plan_reset_month) || 1,
      planResetDay: Number(row.plan_reset_day) || 1,
    },
    usage: {
      annualBenefitUsed: annualUsed,
      deductibleUsed: deductibleUsed,
      annualBenefitRemaining: annualBenefitRemaining,
      deductibleRemaining: deductibleRemaining,
    },
    redirectTo: "results.html", // Directly to Treatments page
  };
}

/**
 * Query employee, dental plan, and benefit usage from PostgreSQL
 */
const SQL_EMPLOYEE_PLAN_USAGE = `
  SELECT
    e.employee_id,
    e.first_name,
    e.last_name,
    e.email,
    e.password,
    e.employer,
    e.hsa_enrolled,
    e.hsa_balance,
    e.fsa_enrolled,
    e.fsa_balance,

    p.plan_id,
    p.plan_name,
    p.plan_type,
    p.provider,
    p.annual_maximum,
    p.deductible,
    p.preventive_coverage,
    p.basic_coverage,
    p.major_coverage,
    p.orthodontic_coverage,
    p.in_network_supported,
    p.out_of_network_supported,
    p.plan_reset_month,
    p.plan_reset_day,

    COALESCE(b.annual_benefit_used, 0) AS annual_benefit_used,
    COALESCE(b.deductible_used, 0) AS deductible_used

  FROM employees_h e

  LEFT JOIN plans_h p
    ON e.plan_id = p.plan_id

  LEFT JOIN benefit_usage b
    ON e.employee_id = b.employee_id

  WHERE LOWER(e.email) = LOWER($1)

  LIMIT 1;
`;

/**
 * POST /api/login
 * Step 1: LOGIN (email + password)
 * Step 2: Load employee
 * Step 3: Load dental plan
 * Step 4: Load benefit usage
 * Step 5: Directs to Treatments (results.html)
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Work email and password are required.",
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    let row = null;

    try {
      const result = await pool.query(SQL_EMPLOYEE_PLAN_USAGE, [cleanEmail]);
      if (result.rows && result.rows.length > 0) {
        row = result.rows[0];
      }
    } catch (dbError) {
      console.warn("DB query error in login, checking fallback:", dbError.message);
      row = MOCK_FALLBACK[cleanEmail];
    }

    if (!row) {
      return res.status(401).json({
        success: false,
        error: "Invalid email or password.",
      });
    }

    // Password validation: match DB password, or allow demo fallbacks ('password123' / 'demo123')
    const isValidPassword =
      password === row.password ||
      password === "password123" ||
      password === "demo123";

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        error: "Invalid email or password.",
      });
    }

    const payload = formatEmployeePayload(row);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      ...payload,
    });
  } catch (error) {
    console.error("Login route error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error during login.",
    });
  }
});

/**
 * GET /api/employee/:email
 * Helper route to reload employee + plan + usage data
 */
router.get("/employee/:email", async (req, res) => {
  try {
    const cleanEmail = req.params.email.trim().toLowerCase();
    const result = await pool.query(SQL_EMPLOYEE_PLAN_USAGE, [cleanEmail]);

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Employee not found.",
      });
    }

    const payload = formatEmployeePayload(result.rows[0]);
    return res.status(200).json({
      success: true,
      ...payload,
    });
  } catch (error) {
    console.error("Employee lookup error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to load employee details.",
    });
  }
});

/**
 * GET /api/dashboard
 * Returns dynamic dashboard metrics for the employee
 */
router.get("/dashboard", async (req, res) => {
  try {
    const email = (req.query.email || "alex.carter@usm-demo.com").trim().toLowerCase();
    let row = null;

    try {
      const result = await pool.query(SQL_EMPLOYEE_PLAN_USAGE, [email]);
      if (result.rows && result.rows.length > 0) {
        row = result.rows[0];
      }
    } catch (dbErr) {
      console.warn("DB error loading dashboard:", dbErr.message);
      row = MOCK_FALLBACK[email] || Object.values(MOCK_FALLBACK)[0];
    }

    if (!row) {
      return res.status(404).json({ success: false, error: "Employee not found." });
    }

    const payload = formatEmployeePayload(row);
    const annualMax = payload.plan.annualMaximum;
    const used = payload.usage.annualBenefitUsed;
    const remaining = payload.usage.annualBenefitRemaining;

    return res.status(200).json({
      success: true,
      user: {
        name: payload.employee.fullName,
        email: payload.employee.email,
        employer: payload.employee.employer,
      },
      planYear: {
        start: "Jan 1, 2026",
        end: "Dec 31, 2026",
        year: 2026,
      },
      annualMax,
      used,
      remaining,
      chart: {
        axisMax: Math.max(600, Math.ceil((used + 200) / 200) * 200),
        step: 200,
        months: [
          { month: "Jan", amount: Math.min(used, 90), projected: false },
          { month: "Feb", amount: Math.min(Math.max(0, used - 90), 180), projected: false },
          { month: "Mar", amount: Math.min(Math.max(0, used - 270), 150), projected: false },
          { month: "Apr", amount: 70, projected: false },
          { month: "May", amount: 180, projected: false },
          { month: "Jun", amount: 120, projected: false },
          { month: "Jul", amount: 90, projected: false },
          { month: "Aug", amount: 70, projected: false },
          { month: "Sep", amount: 110, projected: true },
          { month: "Oct", amount: 150, projected: true },
          { month: "Nov", amount: 135, projected: true },
          { month: "Dec", amount: 120, projected: true },
        ],
      },
      upcoming: [
        {
          date: "Oct 15, 2026",
          procedure: "Preventive Cleaning",
          provider: "Lincoln Dental Network",
          href: "results.html",
        },
        {
          date: "Nov 12, 2026",
          procedure: "Periodic Oral Exam",
          provider: "Lincoln Dental Network",
          href: "results.html",
        },
      ],
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to load dashboard metrics.",
    });
  }
});

module.exports = router;
