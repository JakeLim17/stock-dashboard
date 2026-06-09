// 시장 인디케이터·종목 카드 옆에 노출되는 미니 추세 차트.
// 의존성 없는 순수 SVG polyline — 가벼움 우선(lightweight-charts 같은 패키지 회피).
//
//   data      : 최근 일별 close 등 시계열 숫자. 길이 < 2 면 null.
//   width     : 기본 64
//   height    : 기본 16
//   up        : true면 var(--up), false면 var(--down). null/undefined면 muted.
//   className : 컨테이너 div 추가 클래스 (예: flex-shrink-0)

interface SparklineProps {
  data: number[] | null | undefined;
  width?: number;
  height?: number;
  up?: boolean | null;
  className?: string;
  // SVG strokeWidth — 좁은 컬럼이라 기본 1.2
  strokeWidth?: number;
}

export function Sparkline({
  data,
  width = 64,
  height = 16,
  up = null,
  className,
  strokeWidth = 1.2,
}: SparklineProps) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min;
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;
  // padding 1px — 위/아래 stroke가 잘리지 않게.
  const padY = strokeWidth;
  const usableH = Math.max(0, height - padY * 2);

  const points = data.map((v, i) => {
    const x = i * stepX;
    const norm = range > 0 ? (v - min) / range : 0.5;
    const y = padY + (1 - norm) * usableH;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const path = `M${points.join(" L")}`;

  const stroke =
    up == null
      ? "var(--muted-foreground, #999)"
      : up
        ? "var(--up)"
        : "var(--down)";

  return (
    <span
      className={`inline-block align-middle leading-none ${className ?? ""}`}
      aria-hidden
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        <path
          d={path}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
