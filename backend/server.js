const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const { testConnection } = require("./db");
const { seedDatabase } = require("./seed");
const loginRouter = require("./login");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend files (login, treatments/results, dashboard, styles)
app.use(express.static(path.join(__dirname, "../frontend"), {
  extensions: ["html", "htm"]
}));

// Initialize DB tables and seed data, then test connection
(async () => {
  try {
    await testConnection();
    await seedDatabase();
  } catch (err) {
    console.warn("DB setup warning:", err.message);
  }
})();

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "BenefitPilot backend is running"
  });
});

// Mount Login & Employee routes
app.use("/api", loginRouter);

// Explicit clean routes for frontend pages
app.get("/alerts", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/alerts.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/dashboard.html"));
});

app.get("/treatments", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/treatments.html"));
});

app.get(["/benefit-timeline", "/timeline"], (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/benefit-timeline.html"));
});

app.get(["/results", "/treatment-plan"], (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/results.html"));
});

// Catch-all route to serve login page if user hits root or unknown route
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// Start server
app.listen(PORT, () => {
  console.log(`BenefitPilot server running on http://localhost:${PORT}`);
});