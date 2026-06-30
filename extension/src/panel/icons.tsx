/**
 * Inline SVG icons. 14×14 viewBox, 1.5 stroke, currentColor, no fills.
 * Designed to sit at 11–12 px next to chip text and inherit the chip's color.
 */

type IconProps = { className?: string; size?: number };

const baseProps = {
  width: 12,
  height: 12,
  viewBox: '0 0 14 14',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function svgProps(p: IconProps) {
  return p.size
    ? { ...baseProps, width: p.size, height: p.size, className: p.className }
    : { ...baseProps, className: p.className };
}

export function CodeIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <polyline points="4.5 4.5 1.5 7 4.5 9.5" />
      <polyline points="9.5 4.5 12.5 7 9.5 9.5" />
      <line x1="8" y1="3" x2="6" y2="11" />
    </svg>
  );
}

export function ListIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <line x1="5" y1="4" x2="12" y2="4" />
      <line x1="5" y1="7" x2="12" y2="7" />
      <line x1="5" y1="10" x2="12" y2="10" />
      <circle cx="2.5" cy="4" r="0.6" />
      <circle cx="2.5" cy="7" r="0.6" />
      <circle cx="2.5" cy="10" r="0.6" />
    </svg>
  );
}

export function TableIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <rect x="1.5" y="2.5" width="11" height="9" rx="1" />
      <line x1="1.5" y1="5.5" x2="12.5" y2="5.5" />
      <line x1="1.5" y1="8.5" x2="12.5" y2="8.5" />
      <line x1="7" y1="2.5" x2="7" y2="11.5" />
    </svg>
  );
}

export function ImageIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <rect x="1.5" y="2.5" width="11" height="9" rx="1" />
      <circle cx="5" cy="5.5" r="1" />
      <polyline points="1.5 10 5 7 8 9 12.5 5" />
    </svg>
  );
}

export function AttachmentIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M11 3.5l-5.5 5.5a2 2 0 0 0 2.8 2.8L13 6.1a3.2 3.2 0 0 0-4.6-4.6L2.6 7.3a4.5 4.5 0 0 0 6.4 6.4" />
    </svg>
  );
}

export function LinkIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M5.5 8.5L8.5 5.5" />
      <path d="M7 4l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1" />
      <path d="M7 10l-1 1a2.5 2.5 0 0 1-3.5-3.5l1-1" />
    </svg>
  );
}

export function FileIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M8 1.5H3.75A1.25 1.25 0 0 0 2.5 2.75v8.5a1.25 1.25 0 0 0 1.25 1.25h6.5a1.25 1.25 0 0 0 1.25-1.25V5z" />
      <polyline points="8 1.5 8 5 11.5 5" />
    </svg>
  );
}

export function ChevronRightIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <polyline points="5 3 9 7 5 11" />
    </svg>
  );
}

/** Person glyph — marks a question (human) node. */
export function UserIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <circle cx="7" cy="4.5" r="2.2" />
      <path d="M2.6 12c0-2.5 2-4 4.4-4s4.4 1.5 4.4 4" />
    </svg>
  );
}

/** Simplified Claude sunburst — marks an answer (assistant) node. */
export function ClaudeIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <line x1="7" y1="1.5" x2="7" y2="12.5" />
      <line x1="1.5" y1="7" x2="12.5" y2="7" />
      <line x1="3.1" y1="3.1" x2="10.9" y2="10.9" />
      <line x1="10.9" y1="3.1" x2="3.1" y2="10.9" />
    </svg>
  );
}

/** Simplified ChatGPT knot — marks an answer (assistant) node on ChatGPT. */
export function ChatGptIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M7 2.2a2.3 2.3 0 0 1 4 1.6v4.4a2.3 2.3 0 0 1-3.45 2" />
      <path d="M7 11.8a2.3 2.3 0 0 1-4-1.6V5.8a2.3 2.3 0 0 1 3.45-2" />
      <path d="M2.9 5.1a2.3 2.3 0 0 1 1.15-3.05l3.8-2.2" transform="translate(0 2.2)" />
      <line x1="7" y1="4.4" x2="7" y2="9.6" />
    </svg>
  );
}

/** Circular-arrow glyph — marks a regenerated (same-question) branch. */
export function RegenIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M11.5 5.5A4.5 4.5 0 1 0 12 8" />
      <polyline points="11.5 2.5 11.5 5.5 8.5 5.5" />
    </svg>
  );
}

/** Diagonal-expand glyph — opens a node's full-content preview. */
export function ExpandIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <polyline points="8.5 2.5 11.5 2.5 11.5 5.5" />
      <polyline points="5.5 11.5 2.5 11.5 2.5 8.5" />
      <line x1="11.5" y1="2.5" x2="7.5" y2="6.5" />
      <line x1="2.5" y1="11.5" x2="6.5" y2="7.5" />
    </svg>
  );
}

/** Rounded-rectangle window glyph — opens a node's full-content in a floating window. */
export function WindowIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <rect x="1.5" y="2.5" width="11" height="9" rx="2" />
      <line x1="1.5" y1="5" x2="12.5" y2="5" />
    </svg>
  );
}

/** Pencil glyph — edits a question node's text in place. */
export function EditIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M2.5 11.5v-2l7-7 2 2-7 7z" />
      <line x1="8.5" y1="3.5" x2="10.5" y2="5.5" />
    </svg>
  );
}

/** Speech-bubble-with-plus glyph — asks a follow-up off an answer node. */
export function FollowUpIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M2 3.5h10v6H7l-2.5 2.5V9.5H2z" />
      <line x1="7" y1="5" x2="7" y2="8" />
      <line x1="5.5" y1="6.5" x2="8.5" y2="6.5" />
    </svg>
  );
}

/** Paper-plane glyph — submits an inline editor (edit / follow-up). */
export function SendIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M12 2.5L2 6.5l4 1.5 1.5 4z" />
      <line x1="12" y1="2.5" x2="6" y2="8" />
    </svg>
  );
}

/** Corner-brackets-out glyph — enters full-screen mode (graph fills the viewport). */
export function FullscreenIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <polyline points="5.5 2.5 2.5 2.5 2.5 5.5" />
      <polyline points="8.5 2.5 11.5 2.5 11.5 5.5" />
      <polyline points="11.5 8.5 11.5 11.5 8.5 11.5" />
      <polyline points="2.5 8.5 2.5 11.5 5.5 11.5" />
    </svg>
  );
}

/** Corner-brackets-in glyph — exits full-screen back to the side panel. */
export function ExitFullscreenIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <polyline points="2.5 5.5 5.5 5.5 5.5 2.5" />
      <polyline points="11.5 5.5 8.5 5.5 8.5 2.5" />
      <polyline points="11.5 8.5 8.5 8.5 8.5 11.5" />
      <polyline points="2.5 8.5 5.5 8.5 5.5 11.5" />
    </svg>
  );
}

/** Plus glyph — zoom in (lower-left canvas control). */
export function PlusIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <line x1="7" y1="3" x2="7" y2="11" />
      <line x1="3" y1="7" x2="11" y2="7" />
    </svg>
  );
}

/** Minus glyph — zoom out (lower-left canvas control). */
export function MinusIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <line x1="3" y1="7" x2="11" y2="7" />
    </svg>
  );
}

/** Magnifier glyph — toggles the conversation search bar. */
export function SearchIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <circle cx="6" cy="6" r="3.6" />
      <line x1="8.7" y1="8.7" x2="12" y2="12" />
    </svg>
  );
}

/** Crosshair/target glyph — recenters the canvas on the most recent message. */
export function CenterIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <circle cx="7" cy="7" r="2.6" />
      <line x1="7" y1="1.5" x2="7" y2="3.2" />
      <line x1="7" y1="10.8" x2="7" y2="12.5" />
      <line x1="1.5" y1="7" x2="3.2" y2="7" />
      <line x1="10.8" y1="7" x2="12.5" y2="7" />
    </svg>
  );
}
