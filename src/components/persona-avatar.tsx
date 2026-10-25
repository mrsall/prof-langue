import type { AvatarStyle } from "@/config/personalities";

/**
 * Avatar illustré, décliné par personnalité (coiffure, barbe, accessoire,
 * couleurs). Quand `speaking` est vrai, la bouche s'anime (CSS).
 */
export function PersonaAvatar({
  style,
  size = 150,
  speaking = false,
  label,
}: {
  style: AvatarStyle;
  size?: number;
  speaking?: boolean;
  label: string;
}) {
  const { shirt, skin, hair, beard, accessory, accent } = style;
  const hairColor = "#1c1410";
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox="0 0 150 150" className={speaking ? "avatar-speaking" : undefined}>
      <circle cx="75" cy="75" r="75" fill="var(--avatar-bg)" />
      {/* buste */}
      <path d="M30 150c0-30 20-45 45-45s45 15 45 45z" fill={shirt} />
      {accessory === "tie" && <path d="M75 105l-6 10 6 30 6-30z" fill={accent} />}
      {accessory === "scarf" && <path d="M48 112c10-8 44-8 54 0l-4 10c-12-6-34-6-46 0z" fill={accent} />}
      {/* cou */}
      <rect x="66" y="92" width="18" height="16" rx="6" fill={darken(skin)} />
      {/* cheveux longs derrière la tête */}
      {hair === "long" && <path d="M40 70c0-28 15-42 35-42s35 14 35 42v40H40z" fill={hairColor} />}
      {/* tête */}
      <circle cx="75" cy="68" r="32" fill={skin} />
      {/* cheveux */}
      {hair === "short" && <path d="M43 62c0-20 14-32 32-32s32 12 32 32c-6-10-14-14-32-14s-26 4-32 14z" fill={hairColor} />}
      {hair === "curly" && (
        <g fill={hairColor}>
          <circle cx="50" cy="52" r="10" />
          <circle cx="62" cy="42" r="11" />
          <circle cx="76" cy="38" r="12" />
          <circle cx="90" cy="42" r="11" />
          <circle cx="101" cy="53" r="10" />
        </g>
      )}
      {hair === "long" && <path d="M43 66c0-22 14-34 32-34s32 12 32 34c-4-12-12-18-32-18s-28 6-32 18z" fill={hairColor} />}
      {hair === "bald" && <path d="M48 56c6-10 16-14 27-14s21 4 27 14c-8-4-17-6-27-6s-19 2-27 6z" fill={darken(skin)} opacity="0.35" />}
      {/* barbe */}
      {beard && <path d="M50 78c4 14 12 22 25 22s21-8 25-22c-4 6-12 9-25 9s-21-3-25-9z" fill={hairColor} />}
      {/* yeux */}
      <circle cx="63" cy="68" r="3.5" fill={hairColor} />
      <circle cx="87" cy="68" r="3.5" fill={hairColor} />
      {accessory === "glasses" && (
        <g fill="none" stroke={accent} strokeWidth="2.5">
          <circle cx="63" cy="68" r="8" />
          <circle cx="87" cy="68" r="8" />
          <path d="M71 68h8M55 66l-6-2M95 66l6-2" />
        </g>
      )}
      {/* bouche */}
      <path className="avatar-mouth-closed" d="M66 81c3 4 15 4 18 0" stroke="#f3f4fa" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <ellipse className="avatar-mouth-open" cx="75" cy="82" rx="7" ry="4" fill="#f3f4fa" />
      {/* casque */}
      {accessory === "headphones" && (
        <g>
          <path d="M38 70c-4-18 8-38 37-38s41 20 37 38" stroke={accent} strokeWidth="6" strokeLinecap="round" fill="none" />
          <rect x="30" y="64" width="12" height="20" rx="6" fill={accent} />
          <rect x="108" y="64" width="12" height="20" rx="6" fill={accent} />
        </g>
      )}
    </svg>
  );
}

function darken(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, ((n >> 16) & 255) - 30);
  const g = Math.max(0, ((n >> 8) & 255) - 30);
  const b = Math.max(0, (n & 255) - 30);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
