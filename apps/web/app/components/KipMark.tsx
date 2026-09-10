import Image from 'next/image';

type Props = {
  size?: number;
};

export function KipMark({ size = 28 }: Props) {
  return (
    <Image
      src="/brand/kip-logo.png"
      alt=""
      width={size}
      height={size}
      priority
      unoptimized
    />
  );
}
