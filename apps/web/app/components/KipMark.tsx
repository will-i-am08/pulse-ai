type Props = {
  size?: number;
  /** White bubble is for dark surfaces; black bubble is for light surfaces. */
  variant?: 'black' | 'white';
};

export function KipMark({ size = 28, variant = 'black' }: Props) {
  const bubble = variant === 'white' ? '#ffffff' : '#111111';
  const ink = variant === 'white' ? '#111111' : '#ffffff';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        fill={bubble}
        d="M18.5 7h27A12.5 12.5 0 0 1 58 19.5v17A12.5 12.5 0 0 1 45.5 49H27.8L16 58.2V49h-1.5A12.5 12.5 0 0 1 2 36.5v-17A12.5 12.5 0 0 1 14.5 7h4Z"
      />
      <path
        fill={ink}
        d="M21 17.2h7.4v10.05L40.7 17.2h8.1L35.7 31.1 49.6 46.8h-8.3L28.4 33.35V46.8H21V17.2Z"
      />
    </svg>
  );
}
