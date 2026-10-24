/**
 * Avatar illustré de Max (mode ami). Quand `speaking` est vrai, la bouche
 * s'anime. L'échelle au rythme de la voix est gérée par le parent.
 */
export function MaxAvatar({
  size = 150,
  speaking = false,
  label = "Max",
}: {
  size?: number;
  speaking?: boolean;
  label?: string;
}) {
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox="0 0 150 150"
      className={speaking ? "avatar-speaking" : undefined}
    >
      <circle cx="75" cy="75" r="75" fill="var(--avatar-bg)" />
      <path d="M30 150c0-30 20-45 45-45s45 15 45 45z" fill="var(--accent)" />
      <rect x="66" y="92" width="18" height="16" rx="6" fill="#5a3a22" />
      <circle cx="75" cy="68" r="32" fill="#7a4b2a" />
      <path
        d="M43 62c0-20 14-32 32-32s32 12 32 32c-6-10-14-14-32-14s-26 4-32 14z"
        fill="#1c1410"
      />
      <path
        d="M50 78c4 14 12 22 25 22s21-8 25-22c-4 6-12 9-25 9s-21-3-25-9z"
        fill="#1c1410"
      />
      <circle cx="63" cy="68" r="3.5" fill="#1c1410" />
      <circle cx="87" cy="68" r="3.5" fill="#1c1410" />
      <path
        className="avatar-mouth-closed"
        d="M66 81c3 4 15 4 18 0"
        stroke="#f3f4fa"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <ellipse className="avatar-mouth-open" cx="75" cy="82" rx="7" ry="4" fill="#f3f4fa" />
      <path
        d="M38 70c-4-18 8-38 37-38s41 20 37 38"
        stroke="var(--speaking)"
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      />
      <rect x="30" y="64" width="12" height="20" rx="6" fill="var(--speaking)" />
      <rect x="108" y="64" width="12" height="20" rx="6" fill="var(--speaking)" />
    </svg>
  );
}
