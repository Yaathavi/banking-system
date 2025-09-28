// server.js
require("dotenv").config();

const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs");

// create SQS client using your region from .env
const sqs = new SQSClient({ region: process.env.AWS_REGION });

const express = require("express");

const app = express(); // creates the express app instance

app.use(express.json()); // lets us read JSON body from requests

const users = [{ account_id: "12345", password: "password123" }];

const { v4: uuidv4 } = require("uuid"); // 👈 add at the top

// maybe a ping thing later

const jwt = require("jsonwebtoken");

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
app.post("/transactions", (req, res) => {
  // 1. Get token from the Authorization header
  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    return res.status(401).json({ error: "Missing token" });
  }

  // Header format: "Bearer <token>", so split on space
  const token = authHeader.split(" ")[1];

  // 2. Verify token
  const jwt = require("jsonwebtoken");
  try {
    jwt.verify(token, process.env.JWT_SECRET); // throws error if invalid
  } catch (err) {
    return res.status(403).json({ error: "Invalid or expired token" });
  }

  // 3. Get transaction data from request body
  const transaction = req.body;

  // 4. Apply fraud rules
  const fraudRules = require("./utils/fraudRules");
  const flagged = fraudRules(transaction);

  if (flagged) {
    console.log("🚨 FLAGGED TRANSACTION:", transaction);
    transaction.transaction_id = uuidv4();

    // Send message to SQS
    const params = {
      QueueUrl: process.env.SQS_QUEUE_URL,
      MessageBody: JSON.stringify(transaction),
    };

    sqs
      .send(new SendMessageCommand(params))
      .then(() =>
        console.log(
          "📤 Sent flagged transaction to SQS with ID:",
          transaction.transaction_id
        )
      )
      .catch((err) => console.error("❌ Failed to send to SQS:", err));

    return res.json({
      status: "flagged",
      transaction_id: transaction.transaction_id,
    });
  }
  return res.json({
    status: "approved",
  }); // ✅ return ID to caller
});

app.listen(process.env.PORT, () => {
  console.log(`🚀 Server running on http://localhost:${process.env.PORT}`);
});
