import React from 'react';

interface WaveformProps {
  data: number[];
  width: number;
  height: number;
}

const Waveform: React.FC<WaveformProps> = ({ data, width, height }) => {
  if (!data || data.length === 0) {
    return null;
  }

  const path = data
    .map((value, index) => {
      const x = (index / (data.length - 1)) * width;
      const y = (1 - value) * (height / 2);
      const y2 = height - y;
      return `M${x.toFixed(2)},${y.toFixed(2)} L${x.toFixed(2)},${y2.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} className="absolute inset-0">
      <path d={path} stroke="rgba(167, 139, 250, 0.6)" strokeWidth="1" />
    </svg>
  );
};

export default Waveform;