import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const el = document.getElementById("root");
if (!el) throw new Error("#root not found");

// No <StrictMode>: it double-invokes effects in dev, which would churn the
// Babylon Engine/WebGL context on every hot start.
createRoot(el).render(<App />);
