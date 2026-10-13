// Native Vercel Express discovery requires an Express import in this entry file.
const express = require("express");
const app = express();
app.use(require("./server/app"));
module.exports = app;
