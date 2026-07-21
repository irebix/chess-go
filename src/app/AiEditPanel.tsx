import React, { useState } from "react";

export function AiEditPanel(): React.ReactElement {
  const [open, setOpen] = useState(false);

  const toggle = (): void => {
    setOpen((value) => !value);
  };

  return (
    <section className={`panel-section ai-edit-panel ${open ? "is-open" : ""}`}>
      <div
        className="panel-section-toggle"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          toggle();
        }}
      >
        <span className={`panel-disclosure ${open ? "is-open" : ""}`} aria-hidden="true">
          {open ? "⌄" : ">"}
        </span>
        <span>AI编辑</span>
      </div>
      {open ? <div className="panel-section-content ai-edit-panel-content" /> : null}
    </section>
  );
}
