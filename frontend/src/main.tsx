import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { installErrLog } from "./lib/errlog";
import "./styles/index.css";

installErrLog();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
