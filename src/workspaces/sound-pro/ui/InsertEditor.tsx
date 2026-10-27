/** Parameter editor for one insert (EQ bands with curve, dynamics, limiter, delay). */
import React, { useMemo } from 'react';
import { formatDb, type InsertSlot, type SoundMix } from '../model.ts';
import { eqCurvePath } from './widgets.tsx';
import type { InsertTarget, RunCommand } from './ChannelStrip.tsx';

const BAND_NAMES = ['HPF', 'Low', 'Mitte 1', 'Mitte 2', 'High', 'LPF'];

const findSlot = (mix: SoundMix, target: InsertTarget): InsertSlot | null => {
  if (!target) return null;
  const list = mix.buses.find((b) => b.id === target.target)?.inserts ?? mix.tracks[target.target]?.inserts ?? [];
  return list.find((s) => s.id === target.insertId) ?? null;
};

const Row: React.FC<{ label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void; id: string }> = ({ label, value, min, max, step, unit, onChange, id }) => (
  <label className="snd-insert__row">
    <span>{label}</span>
    <input type="range" min={min} max={max} step={step} value={value} data-automation-id={id} onChange={(e) => onChange(Number(e.target.value))} />
    <output>{Number.isInteger(step) ? value : value.toFixed(step < 0.1 ? 2 : 1)}{unit}</output>
  </label>
);

export const InsertEditor: React.FC<{ mix: SoundMix; target: InsertTarget; run: RunCommand; onClose: () => void; targetName: string }> = ({ mix, target, run, onClose, targetName }) => {
  const slot = findSlot(mix, target);
  const curve = useMemo(() => (slot && slot.kind === 'eq' ? eqCurvePath(slot.params.bands, 300, 110) : ''), [slot]);
  if (!slot || !target) return null;
  const set = (params: Record<string, unknown>) => run('mixer.setInsertParams', { target: target.target, insertId: slot.id, params });
  const id = `sound-insert-${slot.id}`;
  return (
    <div className="snd-panel snd-insert" data-automation-id={id}>
      <div className="snd-panel__head" style={{ margin: '-8px -8px 0' }}>
        <span>{targetName} · {slot.kind === 'eq' ? 'Equalizer' : slot.kind === 'compressor' ? 'Kompressor' : slot.kind === 'gate' ? 'Gate' : slot.kind === 'limiter' ? 'Limiter' : 'Delay'}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className={`snd-btn ${slot.bypass ? '' : 'snd-btn--on'}`} data-automation-id={`${id}-bypass`} onClick={() => run('mixer.bypassInsert', { target: target.target, insertId: slot.id })}>{slot.bypass ? 'Bypass' : 'Aktiv'}</button>
        <button type="button" className="snd-btn" data-automation-id={`${id}-remove`} onClick={() => { run('mixer.removeInsert', { target: target.target, insertId: slot.id }); onClose(); }}>Entfernen</button>
        <button type="button" className="snd-btn" data-automation-id={`${id}-close`} onClick={onClose}>×</button>
      </div>

      {slot.kind === 'eq' && (
        <>
          <svg className="snd-eqbig" viewBox="0 0 300 110" preserveAspectRatio="none">
            {[-12, 0, 12].map((db) => <line key={db} x1="0" x2="300" y1={55 - (db / 18) * 53} y2={55 - (db / 18) * 53} />)}
            {[100, 1000, 10000].map((f) => {
              const x = (Math.log(f / 20) / Math.log(1000)) * 300;
              return <g key={f}><line x1={x} x2={x} y1="0" y2="110" /><text x={x + 2} y="108">{f >= 1000 ? `${f / 1000}k` : f}</text></g>;
            })}
            <path d={curve} />
          </svg>
          <div className="snd-insert__bands">
            {slot.params.bands.map((band, i) => (
              <div key={i} className="snd-insert__band" data-automation-id={`${id}-band-${i}`}>
                <label style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                  <input type="checkbox" checked={band.enabled} onChange={(e) => run('mixer.setEqBand', { target: target.target, band: i, enabled: e.target.checked })} />
                  <b>{BAND_NAMES[i] ?? `B${i}`}</b>
                </label>
                <span>{band.freq >= 1000 ? `${(band.freq / 1000).toFixed(1)}k` : Math.round(band.freq)} Hz</span>
                <input type="range" min={0} max={1} step={0.001} value={Math.log(band.freq / 20) / Math.log(1000)} aria-label="Frequenz"
                  onChange={(e) => run('mixer.setEqBand', { target: target.target, band: i, freq: Math.round(20 * Math.pow(1000, Number(e.target.value))) })} />
                {band.type !== 'highpass' && band.type !== 'lowpass' && (
                  <>
                    <span>{formatDb(band.gainDb)} dB</span>
                    <input type="range" min={-18} max={18} step={0.5} value={band.gainDb} aria-label="Gain" onChange={(e) => run('mixer.setEqBand', { target: target.target, band: i, gainDb: Number(e.target.value) })} />
                  </>
                )}
                <span>Q {band.q.toFixed(2)}</span>
                <input type="range" min={0.2} max={10} step={0.05} value={band.q} aria-label="Güte" onChange={(e) => run('mixer.setEqBand', { target: target.target, band: i, q: Number(e.target.value) })} />
              </div>
            ))}
          </div>
        </>
      )}

      {slot.kind === 'compressor' && (
        <>
          <Row id={`${id}-threshold`} label="Threshold" value={slot.params.thresholdDb} min={-60} max={0} step={0.5} unit=" dB" onChange={(v) => set({ thresholdDb: v })} />
          <Row id={`${id}-ratio`} label="Ratio" value={slot.params.ratio} min={1} max={20} step={0.1} unit=":1" onChange={(v) => set({ ratio: v })} />
          <Row id={`${id}-attack`} label="Attack" value={slot.params.attackMs} min={0.1} max={200} step={0.1} unit=" ms" onChange={(v) => set({ attackMs: v })} />
          <Row id={`${id}-release`} label="Release" value={slot.params.releaseMs} min={5} max={2000} step={1} unit=" ms" onChange={(v) => set({ releaseMs: v })} />
          <Row id={`${id}-knee`} label="Knee" value={slot.params.kneeDb} min={0} max={24} step={0.5} unit=" dB" onChange={(v) => set({ kneeDb: v })} />
          <Row id={`${id}-makeup`} label="Make-up" value={slot.params.makeupDb} min={-12} max={24} step={0.5} unit=" dB" onChange={(v) => set({ makeupDb: v })} />
        </>
      )}
      {slot.kind === 'gate' && (
        <>
          <Row id={`${id}-threshold`} label="Threshold" value={slot.params.thresholdDb} min={-90} max={0} step={0.5} unit=" dB" onChange={(v) => set({ thresholdDb: v })} />
          <Row id={`${id}-range`} label="Range" value={slot.params.rangeDb} min={-90} max={0} step={0.5} unit=" dB" onChange={(v) => set({ rangeDb: v })} />
          <Row id={`${id}-attack`} label="Attack" value={slot.params.attackMs} min={0.1} max={100} step={0.1} unit=" ms" onChange={(v) => set({ attackMs: v })} />
          <Row id={`${id}-release`} label="Release" value={slot.params.releaseMs} min={5} max={2000} step={1} unit=" ms" onChange={(v) => set({ releaseMs: v })} />
        </>
      )}
      {slot.kind === 'limiter' && (
        <>
          <Row id={`${id}-ceiling`} label="Ceiling" value={slot.params.ceilingDb} min={-12} max={0} step={0.1} unit=" dB" onChange={(v) => set({ ceilingDb: v })} />
          <Row id={`${id}-release`} label="Release" value={slot.params.releaseMs} min={1} max={1000} step={1} unit=" ms" onChange={(v) => set({ releaseMs: v })} />
        </>
      )}
      {slot.kind === 'delay' && (
        <>
          <Row id={`${id}-time`} label="Zeit" value={slot.params.timeMs} min={1} max={2000} step={1} unit=" ms" onChange={(v) => set({ timeMs: v })} />
          <Row id={`${id}-feedback`} label="Feedback" value={slot.params.feedback} min={0} max={0.95} step={0.01} unit="" onChange={(v) => set({ feedback: v })} />
          <Row id={`${id}-mix`} label="Mix" value={slot.params.mix} min={0} max={1} step={0.01} unit="" onChange={(v) => set({ mix: v })} />
        </>
      )}
    </div>
  );
};
