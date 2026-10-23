// Launcher: `node -e "require(<plugin root>/scripts/run.cjs)"` runs the capture on stdin.
// Always exits 0 and prints nothing.
"use strict";
try {
  require("./capture.cjs").main();
} catch {
  // never throw
}
process.exitCode = 0;
