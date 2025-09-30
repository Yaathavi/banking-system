// server.js
require("dotenv").config();

const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs");
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");

// create SQS client using your region from .env
const sqs = new SQSClient({ region: process.env.AWS_REGION });

const app = express();
app.use(express.json());

const users = [{ account_id: "12345", password: "password123" }];

// POST /login route
app.post("/login", (req, res) => {
  const { account_id, password } = req.body;

  const user = users.find(
    (user) => user.account_id === account_id && user.password === password
  );

  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  // Create a JWT token
  const token = jwt.sign({ account_id }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });

  res.json({ token });
});

// POST /transactions - validates token, applies fraud detection rules
app.post("/transactions", async (req, res) => {
  // 1. Get token from the Authorization header
  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    return res.status(401).json({ error: "Missing token" });
  }

  // Header format: "Bearer <token>", so split on space
  const token = authHeader.split(" ")[1];

  // 2. Verify token
  try {
    jwt.verify(token, process.env.JWT_SECRET); // throws error if invalid
  } catch (err) {
    return res.status(403).json({ error: "Invalid or expired token" });
  }

  // 3. Get transaction data from request body
  const transaction = req.body;

  // 4. Apply fraud rules (async)
  const fraudRules = require("./utils/fraudRules");
  const flaggedResult = await fraudRules(transaction);

  if (flaggedResult.flagged) {
    console.log("🚨 FLAGGED TRANSACTION:", flaggedResult.reason, transaction);
    transaction.transaction_id = uuidv4();

    // Send message to SQS
    const params = {
      QueueUrl: process.env.SQS_QUEUE_URL,
      MessageBody: JSON.stringify(transaction),
    };

    try {
      await sqs.send(new SendMessageCommand(params));
      console.log(
        "📤 Sent flagged transaction to SQS with ID:",
        transaction.transaction_id
      );
    } catch (err) {
      console.error("❌ Failed to send to SQS:", err);
    }

    return res.json({
      status: "flagged",
      transaction_id: transaction.transaction_id,
      reason: flaggedResult.reason,
    });
  }

  return res.json({ status: "approved" });
});

// Simple health check route for ALB
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
});
