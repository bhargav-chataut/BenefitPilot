-- database: :memory:
CREATE TABLE benefit_us (
  employee_id TEXT PRIMARY KEY,

  annual_benefit_used INTEGER NOT NULL DEFAULT 0,
  deductible_used INTEGER NOT NULL DEFAULT 0,

  FOREIGN KEY (employee_id)
    REFERENCES employees(employee_id)
);


SELECT
  e.employee_id,
  e.first_name,
  e.last_name,
  e.email,
  e.employer,

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

  b.annual_benefit_used,
  b.deductible_used,

  (p.annual_maximum - b.annual_benefit_used)
    AS annual_benefit_remaining,

  CASE
    WHEN (p.deductible - b.deductible_used) < 0 THEN 0
    ELSE (p.deductible - b.deductible_used)
  END AS deductible_remaining,

  e.hsa_enrolled,
  e.hsa_balance,
  e.fsa_enrolled,
  e.fsa_balance

FROM employees e

JOIN plans_h p
  ON e.plan_id = p.plan_id

JOIN benefit_usage b
  ON e.employee_id = b.employee_id

WHERE e.email = 'alex.carter@usm-demo.com';