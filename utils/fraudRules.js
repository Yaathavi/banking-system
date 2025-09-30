// utils/fraudRules.js
const { DynamoDBClient, QueryCommand } = require("@aws-sdk/client-dynamodb");

const ddb = new DynamoDBClient({ region: process.env.AWS_REGION });

async function fraudRules(transaction) {
  // Rule 1️⃣: Large withdrawal
  if (transaction.amount > 5000) {
    return { flagged: true, reason: "Large withdrawal" };
  }

  console.log(
    "💰 Amount receivedd:",
    transaction.amount,
    typeof transaction.amount
  );

  // Only run DynamoDB checks if we have an account_id
  if (!transaction.account_id) {
    return { flagged: false, reason: "No account_id provided" };
  }

  // Query recent logins for this account
  const recentLoginsResp = await ddb.send(
    new QueryCommand({
      TableName: process.env.RECENT_LOGINS_TABLE,
      KeyConditionExpression: "account_id = :a",
      ExpressionAttributeValues: {
        ":a": { S: transaction.account_id },
      },
      Limit: 5,
      ScanIndexForward: false, // newest first
    })
  );

  const recentLogins = recentLoginsResp.Items || [];

  // Rule 2️⃣: Too many failed logins before transaction
  const failedAttempts = recentLogins.filter(
    (i) => (i.status?.S || "").toLowerCase() === "fail" // match how you store it
  );
  if (failedAttempts.length >= 3) {
    return { flagged: true, reason: "Too many failed logins" };
  }

  // Rule 3️⃣: Geo mismatch within 5 minutes of last login
  if (recentLogins.length > 0 && transaction.geo_region) {
    const lastLogin = recentLogins[0];
    if (
      lastLogin.geo_region?.S &&
      lastLogin.geo_region.S !== transaction.geo_region
    ) {
      // compare to now or transaction-provided time
      const now = Date.now();
      const lastLoginTime = parseInt(lastLogin.timestamp.N, 10);
      const timeDiff = now - lastLoginTime;

      if (timeDiff < 5 * 60 * 1000) {
        // 5 minutes
        return { flagged: true, reason: "Geo mismatch within 5 minutes" };
      }
    }
  }

  return { flagged: false, reason: "No fraud detected" };
}

module.exports = fraudRules;
