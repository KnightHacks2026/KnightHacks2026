"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Prototype from "./prototype";

export default function PrototypeHost() {
  const ref = useRef<HTMLDivElement>(null);
  const [shadow, setShadow] = useState<ShadowRoot | null>(null);

  useEffect(() => {
    if (ref.current && !ref.current.shadowRoot) {
      setShadow(ref.current.attachShadow({ mode: "open" }));
    } else if (ref.current?.shadowRoot) {
      setShadow(ref.current.shadowRoot);
    }
  }, []);

  return <>
    <link rel="stylesheet" href="/figma-make-fonts.css" />
    <div ref={ref} data-custodyos-demo="figma-make">
      {shadow && createPortal(<><link rel="stylesheet" href="/figma-make-preflight.css" /><link rel="stylesheet" href="/figma-make.css" /><Prototype /></>, shadow)}
    </div>
  </>;
}
