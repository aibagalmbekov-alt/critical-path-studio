"use strict";

const { readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");

const dist = join(__dirname, "../dist");
const read = file => readFileSync(join(dist, file), "utf8").trimEnd();
const closingScript = new RegExp("</script", "ig");
const embedScript = file => read(file).replace(closingScript, "<\\/script");
const output = resolve(process.argv[2] || "critical-path-studio.html");
const html = read("index.html")
  .replace('<link rel="stylesheet" href="style.css">', () => "<style>\n" + read("style.css") + "\n</style>")
  .replace(/\s*<script defer src="(?:scheduler|app)\.js"><\/script>/g, "")
  .replace("</body>", () => "<script>\n" + embedScript("scheduler.js") + "\n" + embedScript("app.js") + "\n</script>\n</body>");
writeFileSync(output, html + "\n");
console.log("Created " + output);
