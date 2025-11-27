import express from "npm:express@4.18.2";
import { corsMiddleware } from "./middleware/cors.middleware.ts";
import { loggingMiddleware } from "./middleware/logging.middleware.ts";
import {
  notFoundHandler,
  globalErrorHandler,
} from "./middleware/error.middleware.ts";
import appraisalRoutes from "./routes/appraisal.routes.ts";
import n8nRoutes from "./routes/n8n.routes.ts";
import emailRoutes from "./routes/email.routes.ts";

const app = express();
const port = 3000;

// Increase payload limit to handle larger requests (default is 100kb)
app.use(express.json({ limit: "10mb" }));

// Apply middleware
app.use(corsMiddleware);
app.use(loggingMiddleware);

// Mount routes
app.use("/run-inspection", appraisalRoutes);
app.use("/run-inspection/n8n", n8nRoutes);
app.use("/run-inspection/email", emailRoutes);

// Error handling (must be last) 
app.use(notFoundHandler);
app.use(globalErrorHandler);

app.listen(port, () => {
  console.log(`[RUN_INSPECTION] Express server listening on port ${port}`);
});
