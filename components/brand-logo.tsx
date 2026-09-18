import Image from "next/image";

type BrandLogoProps = {
  size?: number;
  className?: string;
  priority?: boolean;
  decorative?: boolean;
};

export function BrandLogo({
  size = 40,
  className = "",
  priority = false,
  decorative = false,
}: BrandLogoProps) {
  return (
    <Image
      className={`brand-logo ${className}`.trim()}
      src="/brand/mohanagorik-icon-512.png"
      width={size}
      height={size}
      alt={decorative ? "" : "MohaNagorik"}
      aria-hidden={decorative || undefined}
      priority={priority}
    />
  );
}
