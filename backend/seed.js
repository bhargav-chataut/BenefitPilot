const { pool } = require("./db");

async function seedDatabase() {
  console.log("Initializing BenefitPilot tables and seed data in PostgreSQL...");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Create tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS plans_h (
        plan_id TEXT PRIMARY KEY,
        plan_name TEXT NOT NULL,
        plan_type TEXT NOT NULL,
        provider TEXT NOT NULL,
        annual_maximum INTEGER NOT NULL,
        deductible INTEGER NOT NULL,
        preventive_coverage INTEGER NOT NULL,
        basic_coverage INTEGER NOT NULL,
        major_coverage INTEGER NOT NULL,
        orthodontic_coverage INTEGER NOT NULL DEFAULT 0,
        in_network_supported INTEGER NOT NULL DEFAULT 1,
        out_of_network_supported INTEGER NOT NULL DEFAULT 1,
        plan_reset_month INTEGER NOT NULL DEFAULT 1,
        plan_reset_day INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS employees_h (
        employee_id TEXT PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        employer TEXT NOT NULL,
        plan_id TEXT NOT NULL REFERENCES plans_h(plan_id),
        hsa_enrolled INTEGER NOT NULL DEFAULT 0,
        hsa_balance INTEGER NOT NULL DEFAULT 0,
        fsa_enrolled INTEGER NOT NULL DEFAULT 0,
        fsa_balance INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS benefit_usage (
        employee_id TEXT PRIMARY KEY REFERENCES employees_h(employee_id),
        annual_benefit_used INTEGER NOT NULL DEFAULT 0,
        deductible_used INTEGER NOT NULL DEFAULT 0
      );

      -- Convenience views for backwards compatibility
      CREATE OR REPLACE VIEW plans AS SELECT * FROM plans_h;
      CREATE OR REPLACE VIEW employees AS SELECT * FROM employees_h;
    `);

    // 2. Insert plans
    await client.query(`
      INSERT INTO plans_h (
        plan_id, plan_name, plan_type, provider, annual_maximum, deductible,
        preventive_coverage, basic_coverage, major_coverage, orthodontic_coverage,
        in_network_supported, out_of_network_supported, plan_reset_month, plan_reset_day
      ) VALUES
        ('PLAN_STANDARD', 'Dental PPO Standard', 'PPO', 'Lincoln Financial', 1500, 50, 100, 80, 50, 0, 1, 1, 1, 1),
        ('PLAN_PLUS', 'Dental PPO Plus', 'PPO', 'Lincoln Financial', 2000, 50, 100, 90, 60, 50, 1, 1, 1, 1),
        ('PLAN_INO', 'Dental In-Network', 'INO', 'Lincoln Financial', 1750, 25, 100, 80, 50, 0, 1, 0, 1, 1)
      ON CONFLICT (plan_id) DO NOTHING;
    `);

    // 3. Insert employees
    await client.query(`
      INSERT INTO employees_h (
        employee_id, first_name, last_name, email, password, employer, plan_id,
        hsa_enrolled, hsa_balance, fsa_enrolled, fsa_balance
      ) VALUES
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
        ('EMP020','Harper','Scott','harper@magnolia-demo.com','password123','Magnolia Manufacturing','PLAN_PLUS',1,550,1,250)
      ON CONFLICT (employee_id) DO UPDATE SET
        password = EXCLUDED.password,
        plan_id = EXCLUDED.plan_id;
    `);

    // 4. Insert benefit usage
    await client.query(`
      INSERT INTO benefit_usage (employee_id, annual_benefit_used, deductible_used)
      VALUES
        ('EMP001', 620, 50),
        ('EMP002', 300, 25),
        ('EMP003', 1100, 25),
        ('EMP004', 450, 50),
        ('EMP005', 800, 50),
        ('EMP006', 200, 25),
        ('EMP007', 1400, 25),
        ('EMP008', 150, 25),
        ('EMP009', 500, 50),
        ('EMP010', 0, 0),
        ('EMP011', 750, 25),
        ('EMP012', 320, 50),
        ('EMP013', 400, 50),
        ('EMP014', 600, 50),
        ('EMP015', 950, 25),
        ('EMP016', 100, 25),
        ('EMP017', 1200, 50),
        ('EMP018', 350, 50),
        ('EMP019', 600, 25),
        ('EMP020', 450, 50)
      ON CONFLICT (employee_id) DO UPDATE SET
        annual_benefit_used = EXCLUDED.annual_benefit_used,
        deductible_used = EXCLUDED.deductible_used;
    `);

    await client.query("COMMIT");
    console.log("Database initialized and seeded successfully!");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error seeding database:", err);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  seedDatabase()
    .then(() => pool.end())
    .catch(() => process.exit(1));
}

module.exports = { seedDatabase };
