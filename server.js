// server.js
require("dotenv").config(); // loads .env variables into process.env
const express = require("express"); // imports express
const app = express(); // creates the express app instance

app.use(express.json()); // lets us read JSON body from requests

app.listen(process.env.PORT, () => {
  console.log(`🚀 Server running on http://localhost:${process.env.PORT}`);
});
