require("dotenv").config();
const { getAdminPin } = require("./lib/adminAuth");

console.log(`Admin access code is set via ADMIN_PIN (current: ${getAdminPin()}).`);
console.log("Open /admin/ and enter the 4-digit code to sign in.");
