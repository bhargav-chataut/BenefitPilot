-- database: :memory:
CREATE TABLE benefit_usage (
  employee_id TEXT PRIMARY KEY,

  annual_benefit_used INTEGER,
  deductible_used INTEGER,

  FOREIGN KEY (employee_id)
    REFERENCES employees(employee_id)
);INSERT INTO benefit_usage VALUES
('EMP1001', 620, 50),
('EMP1002', 300, 25),
('EMP1003', 1100, 25);


SELECT
  e.employee_id,
  e.first_name,
  e.email,
  e.employer,

  p.plan_name,
  p.plan_type,
  p.annual_maximum,
  p.deductible,
  p.preventive_coverage,
  p.basic_coverage,
  p.major_coverage,
  p.in_network_supported,
  p.out_of_network_supported,

  b.annual_benefit_used,
  b.deductible_used,

  e.hsa_enrolled,
  e.hsa_balance,
  e.fsa_enrolled,
  e.fsa_balance

FROM employees e

JOIN plans p
ON e.plan_id = p.plan_id

JOIN benefit_usage b
ON e.employee_id = b.employee_id

WHERE e.email = 'alex@acme.com';