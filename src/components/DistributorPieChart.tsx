import React, { useMemo, useState } from 'react';
import * as d3 from 'd3';
import { Download, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { InventorySchema, StockState, InvLogEntry } from '../types';

interface DistributorPieChartProps {
  inventory: InventorySchema;
  stock: StockState;
  invLogs?: InvLogEntry[];
}

interface Piece {
  distributor: string;
  value: number;
  percentage: number;
  color: string;
  arcPath: string | null;
  centroid: [number, number];
  offsetX: number;
  offsetY: number;
  previousValue: number;
  change: number;
  changePercent: number;
}

export const DistributorPieChart: React.FC<DistributorPieChartProps> = ({ inventory, stock, invLogs }) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [metric, setMetric] = useState<'value' | 'count'>('value');
  const [showTrends, setShowTrends] = useState<boolean>(true);

  // Compute total inventory value or item count per distributor plus trends
  const chartData = useMemo(() => {
    const dataMap: { [distributor: string]: number } = {};
    const previousTotals: { [distributor: string]: number } = {};
    let grandTotal = 0;

    Object.keys(inventory).forEach(distributor => {
      let total = 0;
      const items = inventory[distributor] || [];
      items.forEach(item => {
        const q = stock[item.n] || 0;
        if (metric === 'value') {
          const c = item.c || 0;
          total += q * c;
        } else {
          total += q;
        }
      });
      if (total > 0) {
        dataMap[distributor] = total;
        grandTotal += total;
      }

      // Compute previous snapshot total from inventory logs
      const doneLogs = (invLogs || []).filter(l => l.i === distributor && l.a === 'DONE');
      let prevTotal = 0;

      if (doneLogs.length > 0) {
        // Locate target historical snapshot
        const targetLog = doneLogs[1] || doneLogs[0];
        const targetTimeStr = targetLog.t;
        const targetTime = new Date(targetTimeStr).getTime();

        items.forEach(item => {
          const itemLogs = (invLogs || []).filter(l => l.i === item.n && l.f !== undefined && new Date(l.t).getTime() <= targetTime);
          let prevQty = 0;
          if (itemLogs.length > 0) {
            const sortedLogs = [...itemLogs].sort((a, b) => new Date(b.t).getTime() - new Date(a.t).getTime());
            prevQty = sortedLogs[0].f!;
          } else {
            prevQty = 0;
          }

          if (metric === 'value') {
            const c = item.c || 0;
            prevTotal += prevQty * c;
          } else {
            prevTotal += prevQty;
          }
        });
      } else {
        // Fallback: individual logs on item levels
        items.forEach(item => {
          const itemLogs = (invLogs || []).filter(l => l.i === item.n && l.f !== undefined);
          const sortedLogs = [...itemLogs].sort((a, b) => new Date(b.t).getTime() - new Date(a.t).getTime());
          let prevQty = stock[item.n] || 0;

          if (sortedLogs.length >= 2) {
            prevQty = sortedLogs[1].f!;
          } else if (sortedLogs.length === 1) {
            prevQty = 0;
          }

          if (metric === 'value') {
            const c = item.c || 0;
            prevTotal += prevQty * c;
          } else {
            prevTotal += prevQty;
          }
        });
      }
      previousTotals[distributor] = prevTotal;
    });

    const entries = Object.entries(dataMap).map(([distributor, value]) => {
      const prevVal = previousTotals[distributor] || 0;
      const change = value - prevVal;
      const changePercent = prevVal > 0 ? (change / prevVal) * 100 : (value > 0 ? 100 : 0);
      return {
        distributor,
        value,
        percentage: grandTotal > 0 ? (value / grandTotal) * 100 : 0,
        previousValue: prevVal,
        change,
        changePercent,
      };
    });

    // Sort descending
    return {
      entries: entries.sort((a, b) => b.value - a.value),
      grandTotal,
    };
  }, [inventory, stock, metric, invLogs]);

  const { entries, grandTotal } = chartData;

  // Colors: Using a beautiful high-contrast custom palette matching the app's aesthetic
  const colors = useMemo(() => [
    '#f97316', // Orange
    '#a855f7', // Purple
    '#3b82f6', // Blue
    '#10b981', // Emerald
    '#eab308', // Yellow
    '#06b6d4', // Cyan
    '#ec4899', // Pink
    '#a1a1aa', // Zinc/Gray
  ], []);

  const d3Data = useMemo(() => {
    if (entries.length === 0) return [];

    // Setup pie layout generator with correct type inference
    const pieGenerator = d3.pie<typeof entries[0]>()
      .value(d => d.value)
      .sort(null); // Keep original sorted order (descending)

    const arcs = pieGenerator(entries);

    // Setup arc generator (Donut chart style)
    const arcGenerator = d3.arc<d3.PieArcDatum<typeof entries[0]>>()
      .innerRadius(75)
      .outerRadius(110)
      .padAngle(0.03)
      .cornerRadius(6);

    const arcHoverGenerator = d3.arc<d3.PieArcDatum<typeof entries[0]>>()
      .innerRadius(72)
      .outerRadius(118)
      .padAngle(0.02)
      .cornerRadius(8);

    return arcs.map((arc, index) => {
      const isHovered = hoveredIndex === index;
      const path = isHovered ? arcHoverGenerator(arc) : arcGenerator(arc);
      const centroid = arcGenerator.centroid(arc);
      
      const [cx, cy] = centroid;
      const len = Math.sqrt(cx * cx + cy * cy);
      const offsetX = len > 0 ? (cx / len) * 8 : 0;
      const offsetY = len > 0 ? (cy / len) * 8 : 0;
      
      return {
        distributor: arc.data.distributor,
        value: arc.data.value,
        percentage: grandTotal > 0 ? (arc.data.value / grandTotal) * 100 : 0,
        color: colors[index % colors.length],
        arcPath: path,
        centroid,
        offsetX,
        offsetY,
        previousValue: arc.data.previousValue,
        change: arc.data.change,
        changePercent: arc.data.changePercent,
      } as Piece;
    });
  }, [entries, grandTotal, colors, hoveredIndex]);

  if (grandTotal === 0 || entries.length === 0) {
    return (
      <div className="bg-[#181818] border border-[#333] rounded-3xl p-6 text-center text-gray-500 py-12">
        <p className="text-[10px] font-black uppercase tracking-widest text-orange-500 mb-2">Asset Distribution</p>
        <p className="text-xs">
          {metric === 'value' 
            ? 'No inventory value recorded. Ensure stock items have cost values set.'
            : 'No stock item quantities recorded.'}
        </p>
      </div>
    );
  }

  const activePiece = hoveredIndex !== null ? d3Data[hoveredIndex] : null;

  const handleDownloadReport = () => {
    // 1. Create a native HTML5 Canvas
    const canvas = document.createElement('canvas');
    canvas.width = 850;
    canvas.height = 500;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set high-quality scaling / anti-aliasing
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Background color: beautiful deep matching charcoal black
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Card boundary outline to make it look beautifully framed
    ctx.strokeStyle = '#222222';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

    // Decorative Orange Accent on Left Margin
    ctx.fillStyle = '#f97316';
    ctx.fillRect(40, 45, 4, 35);

    // Header Content
    ctx.fillStyle = '#f97316';
    ctx.font = 'italic 900 16px sans-serif';
    ctx.fillText('SMOKE EATERS PRO', 52, 60);

    ctx.fillStyle = '#888888';
    ctx.font = '700 9px sans-serif';
    ctx.fillText(
      metric === 'value'
        ? 'INVENTORY ASSET ALLOCATION BY DISTRIBUTOR'
        : 'INVENTORY STOCK VOLUME BY DISTRIBUTOR',
      52,
      75
    );

    // Header Total (Right side)
    const formattedTotal = metric === 'value'
      ? `$${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `${grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} units`;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#888888';
    ctx.font = '900 8px sans-serif';
    ctx.fillText(
      metric === 'value' ? 'TOTAL ASSET VALUE' : 'TOTAL ITEM COUNT',
      810,
      56
    );
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'italic 900 20px sans-serif';
    ctx.fillText(formattedTotal, 810, 78);
    ctx.textAlign = 'left'; // Reset alignment

    // Draw horizontal dividing line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, 105);
    ctx.lineTo(810, 105);
    ctx.stroke();

    // DONUT CHART SETUP (Left col center: X=240, Y=300)
    const chartCenterX = 240;
    const chartCenterY = 300;
    const outerRadius = 125;
    const innerRadius = 82;

    // Draw slices
    let cumulativeAngle = -Math.PI / 2; // Start top
    
    // Cache the slices angles for drawing gaps later
    const sliceAngles: number[] = [cumulativeAngle];

    d3Data.forEach((piece) => {
      const sliceAngle = (piece.value / grandTotal) * 2 * Math.PI;
      const endAngle = cumulativeAngle + sliceAngle;
      
      ctx.fillStyle = piece.color;
      ctx.beginPath();
      ctx.moveTo(chartCenterX, chartCenterY);
      ctx.arc(chartCenterX, chartCenterY, outerRadius, cumulativeAngle, endAngle);
      ctx.closePath();
      ctx.fill();

      cumulativeAngle = endAngle;
      sliceAngles.push(cumulativeAngle);
    });

    // Draw slice outline gaps with background color to separate them elegantly
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 5;
    sliceAngles.forEach((angle) => {
      ctx.beginPath();
      ctx.moveTo(chartCenterX, chartCenterY);
      ctx.lineTo(
        chartCenterX + (outerRadius + 2) * Math.cos(angle),
        chartCenterY + (outerRadius + 2) * Math.sin(angle)
      );
      ctx.stroke();
    });

    // Draw Center Hole cutout
    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.arc(chartCenterX, chartCenterY, innerRadius, 0, 2 * Math.PI);
    ctx.closePath();
    ctx.fill();

    // Center Text (inside Donut)
    ctx.textAlign = 'center';
    
    ctx.fillStyle = '#888888';
    ctx.font = '900 8px sans-serif';
    ctx.fillText('DISTRIBUTORS', chartCenterX, chartCenterY - 18);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'italic 900 24px sans-serif';
    ctx.fillText(`${entries.length}`, chartCenterX, chartCenterY + 8);

    ctx.fillStyle = '#666666';
    ctx.font = '700 8px sans-serif';
    ctx.fillText('ACTIVE PARTNERS', chartCenterX, chartCenterY + 28);
    ctx.textAlign = 'left'; // Reset

    // LEGEND RENDERING (Right column starting at X=440)
    let legendY = 145;
    const legendCount = d3Data.length;
    const legendAvailableHeight = 310; // From 145 to 455 px
    const legendRowHeight = Math.min(35, legendAvailableHeight / Math.max(1, legendCount));

    d3Data.forEach((piece) => {
      // Color Dot
      ctx.fillStyle = piece.color;
      ctx.beginPath();
      ctx.arc(440, legendY + 5, 6, 0, 2 * Math.PI);
      ctx.closePath();
      ctx.fill();

      // Distributor Name
      ctx.fillStyle = '#eeeeee';
      ctx.font = '900 11px sans-serif';
      // Truncate distributor name if too long
      const textLimit = 30;
      const displayName = piece.distributor.length > textLimit ? piece.distributor.substring(0, textLimit) + '...' : piece.distributor;
      ctx.fillText(displayName.toUpperCase(), 458, legendY + 9);

      // Value & Weight (Right side alignment)
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 11px sans-serif';
      const pieceValStr = metric === 'value'
        ? `$${piece.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : `${piece.value.toLocaleString(undefined, { maximumFractionDigits: 0 })} units`;
      ctx.fillText(pieceValStr, 810, legendY + 9);

      // Trend Indicator (Drawn at X=715, right-aligned)
      if (showTrends) {
        if (Math.abs(piece.change) > 0.001) {
          ctx.font = '800 8.5px sans-serif';
          if (piece.change > 0) {
            ctx.fillStyle = '#10b981'; // Emerald
            const trendStr = piece.changePercent >= 100 ? '▲ NEW' : `▲ +${piece.changePercent.toFixed(0)}%`;
            ctx.fillText(trendStr, 715, legendY + 9);
          } else {
            ctx.fillStyle = '#ef4444'; // Red
            ctx.fillText(`▼ -${Math.abs(piece.changePercent).toFixed(0)}%`, 715, legendY + 9);
          }
        } else {
          ctx.font = '800 8.5px sans-serif';
          ctx.fillStyle = '#666666';
          ctx.fillText('— 0%', 715, legendY + 9);
        }
      }

      // Percentage label smaller below it
      ctx.textAlign = 'right';
      ctx.fillStyle = piece.color;
      ctx.font = '700 8.5px sans-serif';
      ctx.fillText(`${piece.percentage.toFixed(1)}% SHARE`, 810, legendY + 21);
      ctx.textAlign = 'left'; // Reset

      // Horizontal subtle line below item
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(440, legendY + 26);
      ctx.lineTo(810, legendY + 26);
      ctx.stroke();

      legendY += legendRowHeight;
    });

    // FOOTER (Date and Confidentiality watermarks)
    const localTimeString = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    
    ctx.fillStyle = '#444444';
    ctx.font = '700 8px sans-serif';
    ctx.fillText(`GENERATED: ${localTimeString}`, 40, 465);

    ctx.textAlign = 'right';
    ctx.fillText('CONFIDENTIAL • FOR SMOKE EATERS MANAGEMENT PRESENTATION ONLY', 810, 465);
    ctx.textAlign = 'left';

    // TRIGGER DOWNLOAD
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      const metricSlug = metric === 'value' ? 'assets' : 'units';
      link.download = `smoke-eaters-distributor-${metricSlug}-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      console.error('Error generating pie chart image report direct-download: ', e);
    }
  };

  return (
    <div id="distributor-asset-chart" className="bg-[#181818] border border-[#333] rounded-3xl p-6 flex flex-col justify-between gap-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-xs font-black uppercase tracking-[0.2em] italic text-orange-500">Asset Distribution</span>
          <span className="text-[9px] font-bold text-gray-500 uppercase tracking-tighter mt-0.5">
            {metric === 'value' ? 'Value Spread by Distributor' : 'Item Stock Volume by Distributor'}
          </span>
        </div>
        
        {/* Toggle + Download + Total */}
        <div className="flex flex-wrap items-center gap-4 sm:gap-6 self-start lg:self-auto w-full lg:w-auto justify-between lg:justify-end">
          {/* Segmented Metric Switch */}
          <div className="flex bg-black/40 p-1 rounded-xl border border-white/5">
            <button
              onClick={() => setMetric('value')}
              className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                metric === 'value' 
                  ? 'bg-orange-500 text-white shadow-md' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              $ Value
            </button>
            <button
              onClick={() => setMetric('count')}
              className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                metric === 'count' 
                  ? 'bg-orange-500 text-white shadow-md' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Unit Count
            </button>
          </div>

          {/* Show/Hide Trends Switch */}
          <div className="flex bg-black/40 p-1 rounded-xl border border-white/5 items-center select-none">
            <button
              onClick={() => setShowTrends(prev => !prev)}
              className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 border ${
                showTrends 
                  ? 'bg-orange-500/10 text-orange-400 border-orange-500/20 shadow-sm' 
                  : 'text-gray-500 hover:text-gray-300 border-transparent'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${showTrends ? 'bg-orange-500 scale-110 shadow-[0_0_8px_#f97316]' : 'bg-gray-600'}`} />
              Trends: {showTrends ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={handleDownloadReport}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 active:bg-white/15 border border-white/10 hover:border-white/20 rounded-xl text-[9px] font-bold uppercase tracking-wider text-gray-300 hover:text-white transition-all cursor-pointer shadow-md shrink-0"
            >
              <Download className="w-3.5 h-3.5 text-orange-500" />
              Download Slide
            </button>
            <div className="text-right">
              <span className="text-[8px] font-black text-gray-400 uppercase leading-none block">
                {metric === 'value' ? 'Total Assets' : 'Total Items'}
              </span>
              <p className="text-sm font-black italic text-white mt-0.5">
                {metric === 'value'
                  ? `$${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : `${grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} units`}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Chart and Legend Area */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 items-center">
        {/* SVG Wrapper */}
        <div className="sm:col-span-5 flex justify-center relative">
          <svg
            width="240"
            height="240"
            viewBox="0 0 240 240"
            className="overflow-visible"
          >
            <g transform="translate(120, 120)">
              {d3Data.map((piece, index) => (
                <path
                  key={piece.distributor}
                  d={piece.arcPath || ''}
                  fill={piece.color}
                  className="transition-all duration-300 cursor-pointer"
                  style={{
                    transform: hoveredIndex === index 
                      ? `translate(${piece.offsetX}px, ${piece.offsetY}px)` 
                      : 'translate(0px, 0px)',
                    filter: hoveredIndex === index ? 'drop-shadow(0px 8px 24px rgba(0,0,0,0.65))' : 'none',
                    opacity: hoveredIndex !== null && hoveredIndex !== index ? 0.4 : 1,
                    transition: 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease, filter 0.3s ease',
                  }}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                />
              ))}
            </g>
          </svg>

          {/* Center Info Text overlay inside the Donut hole */}
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none w-[110px] sm:w-[120px]">
            {activePiece ? (
              <div className="animate-fade-in">
                <p className="text-[8px] font-black text-gray-500 uppercase tracking-wider truncate px-1">
                  {activePiece.distributor}
                </p>
                <p className="text-[13px] font-black text-white italic leading-none mt-1">
                  {metric === 'value'
                    ? `$${activePiece.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                    : `${activePiece.value.toLocaleString(undefined, { maximumFractionDigits: 0 })} units`}
                </p>
                <p className="text-[9px] font-black text-orange-500 mt-1">
                  {activePiece.percentage.toFixed(1)}%
                </p>
              </div>
            ) : (
              <div>
                <p className="text-[8px] font-black text-gray-500 uppercase tracking-widest">
                  Distributors
                </p>
                <p className="text-[13px] font-black text-white italic mt-1">
                  {entries.length}
                </p>
                <p className="text-[8px] font-bold text-gray-400 uppercase tracking-tight mt-1">
                  Active Partners
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Legend */}
        <div className="sm:col-span-7 space-y-2 max-h-[190px] overflow-y-auto pr-1 custom-scrollbar">
          {d3Data.map((piece, index) => {
            const isHovered = hoveredIndex === index;
            return (
              <div
                key={piece.distributor}
                className={`flex items-center justify-between p-2 rounded-xl transition-all border ${
                  isHovered 
                    ? 'bg-white/5 border-white/10' 
                    : 'bg-transparent border-transparent'
                }`}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                <div className={`flex items-center gap-2 truncate transition-all duration-300 ${showTrends ? 'max-w-[50%]' : 'max-w-[70%]'}`}>
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: piece.color }}
                  />
                  <span className="text-[10px] font-bold text-gray-200 uppercase truncate">
                    {piece.distributor}
                  </span>
                </div>
                <div className="text-right shrink-0 flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-[10px] font-black text-white font-mono">
                      {metric === 'value'
                        ? `$${piece.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : `${piece.value.toLocaleString(undefined, { maximumFractionDigits: 0 })} units`}
                    </p>
                    <p className="text-[8px] font-semibold text-gray-500 leading-none mt-0.5">
                      {piece.percentage.toFixed(1)}%
                    </p>
                  </div>
                  {/* Trend Indicator Pill */}
                  {showTrends && (
                    <div className="w-14 flex justify-end shrink-0 select-none">
                      {piece.change > 0.001 ? (
                        <span className="flex items-center gap-0.5 text-[8px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/15 px-1.5 py-1 rounded-md leading-none h-6 w-full justify-center" title={`Value increased by ${piece.changePercent.toFixed(1)}% compared to the previous snapshot`}>
                          <TrendingUp className="w-2.5 h-2.5" />
                          {piece.changePercent >= 100 ? 'NEW' : `+${piece.changePercent.toFixed(0)}%`}
                        </span>
                      ) : piece.change < -0.001 ? (
                        <span className="flex items-center gap-0.5 text-[8px] font-black text-rose-400 bg-rose-500/10 border border-rose-500/15 px-1.5 py-1 rounded-md leading-none h-6 w-full justify-center" title={`Value decreased by ${Math.abs(piece.changePercent).toFixed(1)}% compared to the previous snapshot`}>
                          <TrendingDown className="w-2.5 h-2.5" />
                          {`-${Math.abs(piece.changePercent).toFixed(0)}%`}
                        </span>
                      ) : (
                        <span className="flex items-center gap-0.5 text-[8px] font-black text-gray-400 bg-white/5 border border-white/5 px-1.5 py-1 rounded-md leading-none h-6 w-full justify-center" title="Stable compared to previous snapshot">
                          <Minus className="w-2.5 h-2.5" />
                          0%
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
