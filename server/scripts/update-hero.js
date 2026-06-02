require("dotenv").config();
const data = require("../data");

async function main() {
  await data.updateSiteContent({ hero_image: "/herov1.png" });
  console.log("Hero image set to /herov1.png");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
