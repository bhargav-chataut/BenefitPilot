-- database: :memory:
-- -------------------------
-- 2. EMPLOYEES
-- -------------------------

CREATE TABLE employees (
  employee_id TEXT PRIMARY KEY,

  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,

  employer TEXT NOT NULL,
  plan_id TEXT NOT NULL,

  hsa_enrolled INTEGER NOT NULL DEFAULT 0,
  hsa_balance INTEGER NOT NULL DEFAULT 0,

  fsa_enrolled INTEGER NOT NULL DEFAULT 0,
  fsa_balance INTEGER NOT NULL DEFAULT 0,

  FOREIGN KEY (plan_id)
    REFERENCES plans(plan_id)
);

INSERT INTO employees (
  employee_id,
  first_name,
  last_name,
  email,
  password,
  employer,
  plan_id,
  hsa_enrolled,
  hsa_balance,
  fsa_enrolled,
  fsa_balance
)
VALUES

('EMP001','Alex','Carter','alex.carter@usm-demo.com','password123','USM','PLAN_PLUS',1,500,1,300),
('EMP002','Maya','Patel','maya.patel@usm-demo.com','password123','USM','PLAN_STANDARD',0,0,1,400),
('EMP003','Jordan','Lee','jordan.lee@usm-demo.com','password123','USM','PLAN_INO',1,900,0,0),
('EMP004','Emily','Johnson','emily.johnson@usm-demo.com','password123','USM','PLAN_PLUS',1,1250,1,250),

('EMP005','Marcus','Brown','marcus.brown@msu-demo.com','password123','MSU','PLAN_STANDARD',1,600,0,0),
('EMP006','Sophia','Davis','sophia.davis@msu-demo.com','password123','MSU','PLAN_PLUS',0,0,1,550),
('EMP007','Ethan','Wilson','ethan.wilson@msu-demo.com','password123','MSU','PLAN_INO',1,1800,0,0),
('EMP008','Olivia','Martinez','olivia.martinez@msu-demo.com','password123','MSU','PLAN_STANDARD',1,350,1,200),

('EMP009','Noah','Thompson','noah@deltatech-demo.com','password123','Delta Tech','PLAN_PLUS',1,750,0,0),
('EMP010','Ava','Robinson','ava@deltatech-demo.com','password123','Delta Tech','PLAN_STANDARD',0,0,1,600),
('EMP011','Liam','Clark','liam@deltatech-demo.com','password123','Delta Tech','PLAN_INO',1,1100,0,0),
('EMP012','Isabella','Lewis','isabella@deltatech-demo.com','password123','Delta Tech','PLAN_PLUS',1,400,1,350),

('EMP013','Mason','Walker','mason@pinestate-demo.com','password123','Pine State Health','PLAN_STANDARD',1,850,0,0),
('EMP014','Mia','Hall','mia@pinestate-demo.com','password123','Pine State Health','PLAN_PLUS',0,0,1,450),
('EMP015','Lucas','Allen','lucas@pinestate-demo.com','password123','Pine State Health','PLAN_INO',1,1500,0,0),
('EMP016','Charlotte','Young','charlotte@pinestate-demo.com','password123','Pine State Health','PLAN_STANDARD',1,250,1,300),

('EMP017','James','Hernandez','james@magnolia-demo.com','password123','Magnolia Manufacturing','PLAN_PLUS',1,2000,0,0),
('EMP018','Amelia','King','amelia@magnolia-demo.com','password123','Magnolia Manufacturing','PLAN_STANDARD',0,0,1,500),
('EMP019','Benjamin','Wright','ben@magnolia-demo.com','password123','Magnolia Manufacturing','PLAN_INO',1,700,0,0),
('EMP020','Harper','Scott','harper@magnolia-demo.com','password123','Magnolia Manufacturing','PLAN_PLUS',1,550,1,250),

('EMP021','Bhargav','Chataut','bhargavchataut101@gmail.com','password123','Codelinc','PLAN_PLUS',1,500,1,300);

SELECT *
FROM employees;