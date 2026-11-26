import React from "react";
import ReactDOM from "react-dom/client";
import "katex/dist/katex.min.css";
import "./styles/app.css";
import "./styles/features.css";
import App from "./App";
import { isWindows } from "./lib/platform";

// Windows 专属的样式（细滚动条等）挂在 <html class="win"> 上
if (isWindows) document.documentElement.classList.add("win");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
