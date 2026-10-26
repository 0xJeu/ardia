import { useState } from "react";
import { markHoverProps } from "./hoverShift";

export function useHover() {
  const [hovered, setHovered] = useState(false);
  const [hoverProps] = useState(() => markHoverProps({ onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) }));
  return { hovered, hoverProps };
}
