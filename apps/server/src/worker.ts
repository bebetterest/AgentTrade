import { startRuntime } from "./runtime.js";

startRuntime("worker").catch((error) => {
  console.error(error);
  process.exit(1);
});
