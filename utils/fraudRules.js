// fraudRules.js
// Fraud detection checks:
// 1. Unusually large withdrawal amount (relative to User_Stats).
// 2. Transactions from different geographic regions within a short time window.
// 3. Too many failed login attempts before a transaction.

const {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
} = require("@aws-sdk/client-dynamodb");

const ddb = new DynamoDBClient({ region: process.env.AWS_REGION });

async function fraudRules(transaction) {
  const accountId = transaction.account_id;

  // --- 1️⃣ Large withdrawal compared to running average ---
  if (process.env.USER_STATS_TABLE && accountId) {
    try {
      const stats = await ddb.send(
        new GetItemCommand({
          TableName: process.env.USER_STATS_TABLE,
          Key: { account_id: { S: accountId } },
        })
      );

      if (stats.Item && stats.Item.avg_amount) {
        const avg = parseFloat(stats.Item.avg_amount.N);
        if (transaction.amount > avg * 3) {
          // simple rule: >3x avg
          console.log(
            `🚩 Large withdrawal: ${transaction.amount} vs avg ${avg}`
          );
          return true;
        }
      } else if (transaction.amount > 5000) {
        // fallback if no stats yet
        console.log(`🚩 Large withdrawal default rule triggered`);
        return true;
      }
    } catch (err) {
      console.error("⚠️ Failed to query User_Stats:", err);
    }
  }

  // --- 2️⃣ Geo mismatch in short time window ---
  if (process.env.RECENT_LOGINS_TABLE && accountId && transaction.geo_region) {
    try {
      const now = Date.now();
      const fiveMinAgo = now - 5 * 60 * 1000;

      const result = await ddb.send(
        new QueryCommand({
          TableName: process.env.RECENT_LOGINS_TABLE,
          KeyConditionExpression:
            "account_id = :aid AND #ts BETWEEN :start AND :end",
          ExpressionAttributeValues: {
            ":aid": { S: accountId },
            ":start": { N: fiveMinAgo.toString() },
            ":end": { N: now.toString() },
          },
          ExpressionAttributeNames: {
            "#ts": "timestamp",
          },
        })
      );

      if (result.Items) {
        const regions = new Set(
          result.Items.map((i) => i.geo_region?.S).filter(Boolean)
        );
        regions.add(transaction.geo_region);
        if (regions.size > 1) {
          console.log(
            `🚩 Geo mismatch detected in last 5 min: ${Array.from(regions).join(
              ","
            )}`
          );
          return true;
        }
      }
    } catch (err) {
      console.error("⚠️ Failed to query Recent_Logins:", err);
    }
  }

  // --- 3️⃣ Too many failed logins before transaction ---
  if (process.env.RECENT_LOGINS_TABLE && accountId) {
    try {
      const now = Date.now();
      const fiveMinAgo = now - 5 * 60 * 1000;

      const result = await ddb.send(
        new QueryCommand({
          TableName: process.env.RECENT_LOGINS_TABLE,
          KeyConditionExpression:
            "account_id = :aid AND #ts BETWEEN :start AND :end",
          ExpressionAttributeValues: {
            ":aid": { S: accountId },
            ":start": { N: fiveMinAgo.toString() },
            ":end": { N: now.toString() },
          },
          ExpressionAttributeNames: {
            "#ts": "timestamp",
          },
        })
      );

      if (result.Items) {
        const failedCount = result.Items.filter(
          (i) => i.status?.S === "fail"
        ).length;
        if (failedCount >= 3) {
          console.log(
            `🚩 Too many failed logins in last 5 min: ${failedCount}`
          );
          return true;
        }
      }
    } catch (err) {
      console.error("⚠️ Failed to query Recent_Logins:", err);
    }
  }

  // If no rules matched → safe
  return false;
}

module.exports = fraudRules;
