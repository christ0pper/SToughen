'use client';

import { useId, useState } from 'react';

export interface TabDef {
  id: string;
  label: string;
  content: React.ReactNode;
}

/**
 * The underlined tab strip from the employee frame.
 *
 * Every panel is rendered once and then hidden, rather than mounted on demand:
 * the content is server-rendered, so switching costs nothing, nothing refetches,
 * and a half-filled form on one tab is still there when you come back to it.
 */
export interface TabsProps {
  tabs: TabDef[];
  initial?: string;
  /** Padding for the tab bar, when the panels below it need to sit flush. */
  barClassName?: string;
  panelClassName?: string;
}

export function Tabs({ tabs, initial, barClassName = '', panelClassName = 'pt-5' }: TabsProps) {
  const base = useId();
  const [active, setActive] = useState(initial ?? tabs[0]?.id);

  return (
    <div>
      <div className={`tabs overflow-x-auto ${barClassName}`} role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${base}-${tab.id}-tab`}
            aria-selected={active === tab.id}
            aria-controls={`${base}-${tab.id}-panel`}
            className={`tab shrink-0 ${active === tab.id ? 'tab-active' : ''}`}
            onClick={() => setActive(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${base}-${tab.id}-panel`}
          aria-labelledby={`${base}-${tab.id}-tab`}
          hidden={active !== tab.id}
          className={panelClassName}
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
