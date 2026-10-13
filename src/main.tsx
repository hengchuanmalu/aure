import App from "@/App";
import { DataProvider } from '@/state/DataProvider';
import "@/styles.css";
import { HoverHintProvider } from "@/ui/HoverHint";
import { createRoot } from "react-dom/client";
createRoot(document.getElementById("root")!).render(
  <DataProvider>
    <HoverHintProvider><App /></HoverHintProvider>
  </DataProvider>,
);
