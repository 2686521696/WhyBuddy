/**
 * EchartsChart — ECharts 薄包装（图表基建统一入口）。
 *
 * - 按需注册：echarts/core + Bar/Line/Pie + Grid/Tooltip/Dataset，不引全量包；
 * - 本组件只经 React.lazy 引入（见 AppRuntimeScreen）——echarts 独立成 chunk，
 *   不进主 bundle（GitHub Pages 演示站首屏不背这个包）；
 * - ResizeObserver 跟随容器尺寸；option 变更 setOption(true) 全量替换。
 */

import React from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, TooltipComponent, DatasetComponent, TitleComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  DatasetComponent,
  TitleComponent,
  CanvasRenderer,
]);

interface EchartsChartProps {
  option: Record<string, unknown>;
  height?: number;
  ariaLabel?: string;
}

export default function EchartsChart({ option, height = 200, ariaLabel }: EchartsChartProps) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const chartRef = React.useRef<echarts.ECharts | null>(null);

  React.useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    chartRef.current?.setOption(option as never, true);
  }, [option]);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={ariaLabel}
      style={{ width: "100%", height }}
      data-testid="echarts-chart"
    />
  );
}
