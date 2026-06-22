import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { installErrLog } from "./lib/errlog";
import { connectLifecycle } from "./lib/lifecycle";
import "./styles/index.css";

installErrLog();
connectLifecycle();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
