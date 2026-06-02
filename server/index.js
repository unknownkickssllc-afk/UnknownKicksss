const app = require("./app");
const data = require("./data");

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  const server = app.listen(PORT, async () => {
    try {
      const count = await data.countProducts();
      if (count === 0) console.log("No products found. Run: npm run seed");
    } catch (e) {
      console.warn("DB check:", e.message);
    }
    console.log(`Unknown Kicks → http://localhost:${PORT}`);
    console.log(`Admin dashboard → http://localhost:${PORT}/admin/`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\nPort ${PORT} is already in use — the app may already be running.`);
      console.error(`Open http://localhost:${PORT}/admin/ in your browser.`);
      console.error(`To restart: netstat -ano | findstr :${PORT}  then  taskkill /PID <pid> /F\n`);
      process.exit(1);
    }
    throw err;
  });
}

module.exports = app;
