import { encode } from 'uqr';

/** 二维码在本地生成：otpauth URI 里有 TOTP 种子，绝不能发给第三方服务。 */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { data, size } = encode(text, { ecc: 'M', border: 2 });
  let d = '';
  data.forEach((row, y) =>
    row.forEach((on, x) => {
      if (on) d += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
