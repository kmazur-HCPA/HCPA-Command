const paths: Record<string, string> = {
  up: "m6 14 6-6 6 6",
  down: "m6 10 6 6 6-6",
  calendar: "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z",
  home: "m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
  task: "M9 11l2 2 4-4M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9M13 3h8v4",
  project:
    "M3 7V5a2 2 0 0 1 2-2h5l3 4h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z",
  journal:
    "M12 5C8 2 4 3 2 4v16c4-2 7-1 10 1 3-2 6-3 10-1V4c-4-2-7-1-10 1Zm0 0v16",
  learning: "m2 9 10-6 10 6-10 6Zm4 3v6c4 3 8 3 12 0v-6m4-3v9",
  library: "M5 3h9l5 5v13H5Zm9 0v6h5M8 13h8m-8 4h6",
  lab: "m12 3 2 6 6 3-6 2-2 7-2-7-7-2 7-3Zm7-1v4m-2-2h4",
  person: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2",
  initiative: "M4 4h6v6H4Zm10 10h6v6h-6ZM7 10v7h7M14 4h6v6h-6Z",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM10 2h4l1 3 3 1 3 3-2 3 1 3-3 4-3-1-2 4H9l-1-3-3-1-3-3 2-3-1-3 3-4 3 1Z",
  search: "M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15ZM16 16l5 5",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  plus: "M12 5v14M5 12h14",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l4 2",
  bell: "M18 8a6 6 0 0 0-12 0c0 6-3 6-3 9h18c0-3-3-3-3-9M9 21h6",
  focus: "M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5m-5 0 9-9m-5 0h5v5",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-6v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1",
  moon: "M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z",
  more: "M5 5h4v4H5Zm10 0h4v4h-4ZM5 15h4v4H5Zm10 0h4v4h-4Z",
  check: "m5 12 4 4L19 6",
  close: "m6 6 12 12M6 18 18 6",
  flag: "M5 21V3h13l-2 4 2 4H5",
  chevron: "m9 5 7 7-7 7",
};
export function Icon({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) {
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.project} />
    </svg>
  );
}
export function Mark() {
  return (
    <svg className="command-mark" viewBox="0 0 512 512" aria-hidden="true">
      <path d="M279 112h72L233 400h-72z" fill="#ff963f" />
    </svg>
  );
}
