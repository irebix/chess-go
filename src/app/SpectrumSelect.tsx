import React, { useEffect, useRef } from "react";

export interface SpectrumSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SpectrumSelectProps {
  ariaLabel: string;
  value: string;
  options: readonly SpectrumSelectOption[];
  disabled?: boolean;
  id?: string;
  className?: string;
  onValueChange(value: string): void;
}

export function SpectrumSelect({
  ariaLabel,
  value,
  options,
  disabled = false,
  id,
  className,
  onValueChange
}: SpectrumSelectProps): React.ReactElement {
  const dropdownRef = useRef<SpectrumDropdownElement | null>(null);
  const optionsRef = useRef(options);
  const onValueChangeRef = useRef(onValueChange);
  optionsRef.current = options;
  onValueChangeRef.current = onValueChange;

  useEffect(() => {
    const dropdown = dropdownRef.current;
    if (!dropdown) return;
    const selectedIndex = options.findIndex((option) => option.value === value);
    dropdown.selectedIndex = selectedIndex >= 0 ? selectedIndex : 0;
    dropdown.disabled = disabled;
  }, [disabled, options, value]);

  useEffect(() => {
    const dropdown = dropdownRef.current;
    if (!dropdown) return;
    const handleChange = (event: Event): void => {
      const currentDropdown = event.currentTarget as SpectrumDropdownElement;
      const option = optionsRef.current[currentDropdown.selectedIndex];
      if (option && !option.disabled) onValueChangeRef.current(option.value);
    };
    dropdown.addEventListener("change", handleChange);
    return () => dropdown.removeEventListener("change", handleChange);
  }, []);

  return (
    <sp-dropdown
      id={id}
      ref={dropdownRef}
      className={["chessgo-sp-dropdown", className].filter(Boolean).join(" ")}
      aria-label={ariaLabel}
      disabled={disabled || undefined}
      style={{ width: "100%" }}
    >
      <sp-menu slot="options">
        {options.map((option) => (
          <sp-menu-item
            key={option.value}
            disabled={option.disabled || undefined}
            selected={option.value === value || undefined}
          >
            {option.label}
          </sp-menu-item>
        ))}
      </sp-menu>
    </sp-dropdown>
  );
}
