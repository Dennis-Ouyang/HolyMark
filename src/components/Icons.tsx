/** 线性图标，统一 16×16 网格、1.4 描边 */
const P: Record<string, JSX.Element> = {
  side: <><rect x="2" y="2.5" width="12" height="11" rx="2" /><path d="M6 2.5v11" /></>,
  panel: <><rect x="2" y="2.5" width="12" height="11" rx="2" /><path d="M10 2.5v11" /></>,
  search: <><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></>,
  focus: <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />,
  folder: <path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />,
  doc: <><path d="M4 2h5.5L12 4.5V14H4z" /><path d="M6 7.5h4M6 10h4" /></>,
  file: <path d="M4 2h5.5L12 4.5V14H4z" />,
  chev: <path d="m4.5 6 3.5 3.5L11.5 6" />,
  gear: <><circle cx="8" cy="8" r="2.2" /><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4" /></>,
  code: <path d="m5.5 4.5-3.5 3.5 3.5 3.5M10.5 4.5l3.5 3.5-3.5 3.5" />,
  math: <path d="M11.5 3H4.5l4 5-4 5h7" />,
  link: <path d="M7 9a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.8.8M9 7a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.8-.8" />,
  note: <path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z" />,
  ul: <><circle cx="3" cy="4.5" r=".8" fill="currentColor" /><circle cx="3" cy="8" r=".8" fill="currentColor" /><circle cx="3" cy="11.5" r=".8" fill="currentColor" /><path d="M6 4.5h8M6 8h8M6 11.5h8" /></>,
  ol: <><path d="M6 4.5h8M6 8h8M6 11.5h8" /><path d="M2.5 3.5h1v3M2.3 9h1.6l-1.6 2.5h1.7" strokeWidth="1" /></>,
  task: <><rect x="2" y="3" width="4" height="4" rx="1" /><path d="m2.8 11 1 1 1.8-2" /><path d="M8.5 5h5.5M8.5 11h5.5" /></>,
  quote: <path d="M3 3v10M6 5h8M6 8h8M6 11h5" />,
  table: <><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M2 6.5h12M2 9.8h12M6 3v10M10 3v10" /></>,
  img: <><rect x="2" y="3" width="12" height="10" rx="1.5" /><circle cx="6" cy="6.5" r="1.2" /><path d="m2.5 12 3.5-3.5 2.5 2.5 2-2 3 3" /></>,
  codeb: <><rect x="2" y="2.5" width="12" height="11" rx="1.5" /><path d="m6 6.5-1.8 1.5L6 9.5M10 6.5l1.8 1.5L10 9.5" /></>,
  mathb: <><rect x="2" y="2.5" width="12" height="11" rx="1.5" /><path d="M10.5 5h-5l2.5 3-2.5 3h5" /></>,
  mermaid: <><rect x="1.5" y="6" width="4" height="4" rx="1" /><rect x="10.5" y="2.5" width="4" height="4" rx="1" /><rect x="10.5" y="9.5" width="4" height="4" rx="1" /><path d="M5.5 8h2.5M8 4.5v7M8 4.5h2.5M8 11.5h2.5" /></>,
  cite: <path d="M4 2.5h7.5v11L7.75 11 4 13.5z" />,
  hr: <path d="M2 8h12" />,
  back: <path d="M10 3.5 5.5 8l4.5 4.5" />,
  close: <path d="m4 4 8 8M12 4l-8 8" />,
  up: <path d="m4.5 10 3.5-3.5 3.5 3.5" />,
  cmd: <path d="m4 5 3 3-3 3M8.5 11H12" />,
  go: <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" />,
};

export function Icon({ name, size = 16 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  );
}
