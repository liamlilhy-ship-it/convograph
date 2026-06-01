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

export function ChevronRightIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <polyline points="5 3 9 7 5 11" />
    </svg>
  );
}
