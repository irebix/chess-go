import type React from "react";

declare global {
  interface SpectrumDropdownElement extends HTMLElement {
    disabled: boolean;
    selectedIndex: number;
  }

  interface SpectrumTextareaElement extends HTMLElement {
    disabled: boolean;
    value: string;
  }

  namespace JSX {
    interface IntrinsicElements {
      "sp-dropdown": React.DetailedHTMLProps<
        React.HTMLAttributes<SpectrumDropdownElement>,
        SpectrumDropdownElement
      > & {
        disabled?: boolean;
        placeholder?: string;
      };
      "sp-menu": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      "sp-menu-item": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        disabled?: boolean;
        selected?: boolean;
      };
      "sp-textarea": React.DetailedHTMLProps<
        React.HTMLAttributes<SpectrumTextareaElement>,
        SpectrumTextareaElement
      > & {
        disabled?: boolean;
        placeholder?: string;
        value?: string;
      };
    }
  }
}

export {};
