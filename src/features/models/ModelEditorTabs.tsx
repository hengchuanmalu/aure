import { useUiMotion } from "@/ui/useUiMotion";
import { type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";

export function ModelEditorTabs({
  tabs,
  icons,
  active,
  onChange,
}: {
  tabs: string[];
  icons: LucideIcon[];
  active: number;
  onChange: (index: number) => void;
}) {
  const nav = useRef<HTMLElement>(null);
  const { transitions } = useUiMotion();
  const [bounds, setBounds] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>();
  useLayoutEffect(() => {
    const element = nav.current!;
    const measure = () => {
      const button = element.querySelector<HTMLElement>(
        '[data-checked="true"]',
      );
      if (button)
        setBounds({
          x: button.offsetLeft,
          y: button.offsetTop,
          width: button.offsetWidth,
          height: button.offsetHeight,
        });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element
      .querySelectorAll("button")
      .forEach((button) => observer.observe(button));
    return () => observer.disconnect();
  }, [active]);
  return (
    <nav
      ref={nav}
      className="editor-tabs model-editor-tabs"
      aria-label="编辑资料分区"
    >
      {bounds && (
        <motion.span
          className="model-editor-selection"
          aria-hidden="true"
          initial={false}
          animate={bounds}
          transition={transitions.selection}
        />
      )}
      {tabs.map((label, index) => {
        const Icon = icons[index];
        return (
          <button
            key={label}
            data-checked={active === index ? "true" : "false"}
            className={active === index ? "active" : ""}
            aria-current={active === index ? "step" : undefined}
            onClick={() => onChange(index)}
          >
            <Icon aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </nav>
  );
}
