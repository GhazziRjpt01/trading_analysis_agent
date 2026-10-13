import app from "./app.js";
import { config } from "./config.js";

app.listen(config.port, () => {
  console.log(`server listening on http://127.0.0.1:${config.port}`);
});
