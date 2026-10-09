import app from "./app.js";
import { env } from "./config/env.js";

app.listen(env.port, () => {
  console.log(
    `Consejero Cero Uno API en http://localhost:${env.port}`
  );

  console.log(`Modelo principal: ${env.primaryModel}`);
  console.log(`Modelo alternativo: ${env.fallbackModel}`);
});