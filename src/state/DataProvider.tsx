import { desktop } from "@/infrastructure/tauri-bridge";
import { DesktopDataProvider } from "@/state/DesktopDataProvider";
import { MockDataProvider } from "@/state/MockDataProvider";
import type { ReactNode } from "react";
export function DataProvider({ children }: { children: ReactNode }) {
  return desktop() ? (
    <DesktopDataProvider>{children}</DesktopDataProvider>
  ) : (
    <MockDataProvider>{children}</MockDataProvider>
  );
}
export function ViewerDataProvider({ children }: { children: ReactNode }) {
  return desktop() ? (
    <DesktopDataProvider viewer>{children}</DesktopDataProvider>
  ) : (
    <>{children}</>
  );
}
