/**
 * Channel strip used by all views. Sections depend on the view:
 *  - fairlight: EQ curve + dynamics, bus assign, pan, fader, meter
 *  - protools:  inserts A–E, sends A–E, I/O, automation mode, pan, fader
 *  - studio:    role, pan, fader, meter (no inserts)
 */
import React from 'react';
import type { TimelineTrack } from '../../../types';
import { formatDb, MAX_INSERTS, MAX_SENDS, MIN_DB, STEM_LABELS, trackMixOf, type AutomationMode, type BusMix, type InsertSlot, type SoundMix, type StemRole } from '../model.ts';
import type { MeterReading } from '../useSoundPlayback.ts';
import { EqMini, Fader, Meter, PanControl } from './widgets.tsx';

export type RunCommand = (id: string, params?: Record<string, unknown>) => unknown;
export type InsertTarget = { target: string; insertId: string } | null;

const INSERT_LABEL: Record<InsertSlot['kind'], string> = { eq: 'EQ', compressor: 'Comp', gate: 'Gate', limiter: 'Limit', delay: 'Delay' };
const SLOT_LETTERS = ['A', 'B', 'C', 'D', 'E'];
const AUTOMATION_LABEL: Record<AutomationMode, string> = { off: 'Aus', read: 'Read', touch: 'Touch', latch: 'Latch', write: 'Write' };

type Variant = 'fairlight' | 'protools' | 'studio';

const InsertSlots: React.FC<{ target: string; inserts: InsertSlot[]; run: RunCommand; onEdit: (t: InsertTarget) => void; editing: InsertTarget; idPrefix: string }> = ({ target, inserts, run, onEdit, editing, idPrefix }) => (
  <div className="snd-strip__section">
    <span className="snd-strip__label">Inserts</span>
    {Array.from({ length: MAX_INSERTS }, (_, i) => {
      const slot = inserts[i];
      if (!slot) {
        return (
          <select
            key={i}
            className="snd-strip__slot snd-strip__slot--empty"
            data-automation-id={`${idPrefix}-insert-add-${SLOT_LETTERS[i]}`}
            value=""
            aria-label={`Insert ${SLOT_LETTERS[i]} hinzufügen`}
            onChange={(e) => {
              const result = run('mixer.addInsert', { target, kind: e.target.value, index: i }) as { insertId?: string } | null;
              if (result && typeof result === 'object' && result.insertId) onEdit({ target, insertId: result.insertId });
            }}
          >
            <option value="">{SLOT_LETTERS[i]} ·</option>
            <option value="eq">EQ</option>
            <option value="compressor">Kompressor</option>
            <option value="gate">Gate</option>
            <option value="limiter">Limiter</option>
            <option value="delay">Delay</option>
          </select>
        );
      }
      const active = editing?.insertId === slot.id;
      return (
        <div
          key={slot.id}
          className={`snd-strip__slot ${slot.bypass ? 'snd-strip__slot--bypass' : ''} ${active ? 'snd-strip__slot--active' : ''}`}
          data-automation-id={`${idPrefix}-insert-${SLOT_LETTERS[i]}`}
          title="Klick: bearbeiten · ⌘-Klick: Bypass · ⌥-Klick: entfernen"
          onClick={(e) => {
            if (e.altKey) run('mixer.removeInsert', { target, insertId: slot.id });
            else if (e.metaKey || e.ctrlKey) run('mixer.bypassInsert', { target, insertId: slot.id });
            else onEdit(active ? null : { target, insertId: slot.id });
          }}
        >
          <b>{SLOT_LETTERS[i]}</b> {INSERT_LABEL[slot.kind]}
        </div>
      );
    })}
  </div>
);

export const TrackStrip: React.FC<{
  track: TimelineTrack;
  mix: SoundMix;
  meter?: MeterReading;
  variant: Variant;
  selected: boolean;
  run: RunCommand;
  editing: InsertTarget;
  onEdit: (t: InsertTarget) => void;
}> = ({ track, mix, meter, variant, selected, run, editing, onEdit }) => {
  const t = trackMixOf(mix, track.id);
  const id = `sound-strip-${track.id}`;
  const eq = t.inserts.find((x) => x.kind === 'eq');
  const comp = t.inserts.find((x) => x.kind === 'compressor');
  const outputs = mix.buses.filter((b) => b.kind !== 'aux' || b.id === t.outputBusId);
  const auxes = mix.buses.filter((b) => b.kind !== 'main');
  const roleColor = t.role ? `var(--snd-role-${t.role})` : undefined;
  return (
    <div className={`snd-strip ${selected ? 'snd-strip--selected' : ''}`} data-automation-id={id}>
      <div className="snd-strip__name" style={roleColor ? { boxShadow: `inset 0 -2px 0 ${roleColor}` } : undefined} onClick={() => run('select.track', { trackId: track.id })} title={track.name ?? track.id}>
        {track.name ?? track.id}
      </div>

      {variant === 'fairlight' && (
        <>
          <div className="snd-strip__section">
            <span className="snd-strip__label">EQ</span>
            <EqMini
              bands={eq && eq.kind === 'eq' ? eq.params.bands : null}
              id={`${id}-eq`}
              onClick={() => {
                if (eq) onEdit(editing?.insertId === eq.id ? null : { target: track.id, insertId: eq.id });
                else {
                  const r = run('mixer.addInsert', { target: track.id, kind: 'eq', index: 0 }) as { insertId?: string } | null;
                  if (r && typeof r === 'object' && r.insertId) onEdit({ target: track.id, insertId: r.insertId });
                }
              }}
            />
          </div>
          <div className="snd-strip__section">
            <span className="snd-strip__label">Dynamik</span>
            <button
              type="button"
              className={`snd-strip__slot ${comp ? '' : 'snd-strip__slot--empty'} ${comp && comp.bypass ? 'snd-strip__slot--bypass' : ''}`}
              data-automation-id={`${id}-dynamics`}
              onClick={() => {
                if (comp) onEdit(editing?.insertId === comp.id ? null : { target: track.id, insertId: comp.id });
                else {
                  const r = run('mixer.addInsert', { target: track.id, kind: 'compressor' }) as { insertId?: string } | null;
                  if (r && typeof r === 'object' && r.insertId) onEdit({ target: track.id, insertId: r.insertId });
                }
              }}
            >
              {comp && comp.kind === 'compressor' ? `${comp.params.ratio}:1 @ ${comp.params.thresholdDb}` : 'Kompressor +'}
            </button>
            <div className="snd-strip__gr">{meter && meter.reductionDb < -0.2 ? `GR ${meter.reductionDb.toFixed(1)}` : ''}</div>
          </div>
        </>
      )}

      {variant === 'protools' && (
        <>
          <InsertSlots target={track.id} inserts={t.inserts} run={run} onEdit={onEdit} editing={editing} idPrefix={id} />
          <div className="snd-strip__section">
            <span className="snd-strip__label">Sends</span>
            {Array.from({ length: MAX_SENDS }, (_, i) => {
              const send = t.sends[i];
              if (!send) {
                return (
                  <select key={i} className="snd-strip__slot snd-strip__slot--empty" value="" data-automation-id={`${id}-send-add-${SLOT_LETTERS[i]}`} aria-label={`Send ${SLOT_LETTERS[i]}`} onChange={(e) => run('mixer.setSend', { trackId: track.id, busId: e.target.value, levelDb: -10 })}>
                    <option value="">{SLOT_LETTERS[i]} ·</option>
                    {auxes.filter((b) => !t.sends.some((s) => s.busId === b.id)).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                );
              }
              const bus = mix.buses.find((b) => b.id === send.busId);
              return (
                <div key={send.busId} className={`snd-strip__slot ${send.enabled ? '' : 'snd-strip__slot--bypass'}`} data-automation-id={`${id}-send-${SLOT_LETTERS[i]}`}
                  title="Rad: Pegel · Klick: an/aus · ⌥-Klick: entfernen · ⇧-Klick: pre/post"
                  onClick={(e) => {
                    if (e.altKey) run('mixer.removeSend', { trackId: track.id, busId: send.busId });
                    else if (e.shiftKey) run('mixer.setSend', { trackId: track.id, busId: send.busId, preFader: !send.preFader });
                    else run('mixer.setSend', { trackId: track.id, busId: send.busId, enabled: !send.enabled });
                  }}
                  onWheel={(e) => run('mixer.setSend', { trackId: track.id, busId: send.busId, levelDb: Math.max(-60, Math.min(12, send.levelDb + (e.deltaY < 0 ? 1 : -1))) })}
                >
                  <b>{SLOT_LETTERS[i]}</b> {bus?.name ?? send.busId} {formatDb(send.levelDb, 0)}{send.preFader ? ' pre' : ''}
                </div>
              );
            })}
          </div>
          <div className="snd-strip__section">
            <span className="snd-strip__label">Auto</span>
            <select className="snd-select" data-automation-id={`${id}-automation-mode`} value={t.automationMode} onChange={(e) => run('automation.setMode', { trackId: track.id, mode: e.target.value })}>
              {(Object.keys(AUTOMATION_LABEL) as AutomationMode[]).map((m) => <option key={m} value={m}>{AUTOMATION_LABEL[m]}</option>)}
            </select>
          </div>
        </>
      )}

      {variant === 'studio' && (
        <div className="snd-strip__section">
          <span className="snd-strip__label">Rolle</span>
          <select className="snd-select" data-automation-id={`${id}-role`} value={t.role ?? 'none'} onChange={(e) => run('mixer.setRole', { trackId: track.id, role: e.target.value })}>
            <option value="none">–</option>
            {(Object.keys(STEM_LABELS) as StemRole[]).map((r) => <option key={r} value={r}>{STEM_LABELS[r]}</option>)}
          </select>
        </div>
      )}

      {variant !== 'studio' && (
        <div className="snd-strip__section">
          <span className="snd-strip__label">{variant === 'protools' ? 'Out' : 'Bus'}</span>
          <select className="snd-select" data-automation-id={`${id}-output`} value={t.outputBusId} onChange={(e) => run('mixer.setOutputBus', { trackId: track.id, busId: e.target.value })}>
            {outputs.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      )}

      <PanControl pan={t.pan} id={`${id}-pan`} onChange={(pan) => run('mixer.setPan', { trackId: track.id, pan })} />
      <div className="snd-strip__toggles">
        {variant !== 'studio' && <button type="button" className="snd-tog snd-tog--r" aria-pressed={t.recordArm} data-automation-id={`${id}-arm`} title="Aufnahmebereit" onClick={() => run('mixer.toggleRecordArm', { trackId: track.id })}>R</button>}
        <button type="button" className="snd-tog snd-tog--s" aria-pressed={Boolean(track.isSolo)} data-automation-id={`${id}-solo`} title="Solo" onClick={() => run('mixer.toggleSolo', { trackId: track.id })}>S</button>
        <button type="button" className="snd-tog snd-tog--m" aria-pressed={track.isMuted} data-automation-id={`${id}-mute`} title="Stumm" onClick={() => run('mixer.toggleMute', { trackId: track.id })}>M</button>
        {variant === 'fairlight' && <button type="button" className="snd-tog snd-tog--p" aria-pressed={t.phaseInvert} data-automation-id={`${id}-phase`} title="Phase drehen" onClick={() => run('mixer.togglePhase', { trackId: track.id })}>Ø</button>}
      </div>
      <div className="snd-strip__faderzone">
        <Fader db={t.gainDb} id={`${id}-fader`} onChange={(db) => run('mixer.setFader', { trackId: track.id, db })} />
        <Meter reading={meter} id={`${id}-meter`} />
      </div>
      <div className="snd-strip__db">{formatDb(t.gainDb)}</div>
    </div>
  );
};

export const BusStrip: React.FC<{ bus: BusMix; mix: SoundMix; meter?: MeterReading; variant: Variant; run: RunCommand; editing: InsertTarget; onEdit: (t: InsertTarget) => void }> = ({ bus, mix, meter, variant, run, editing, onEdit }) => {
  const id = `sound-bus-${bus.id}`;
  return (
    <div className="snd-strip snd-strip--bus" data-automation-id={id}>
      <div className="snd-strip__name" title={bus.name}>{bus.name}</div>
      <div className="snd-hint" style={{ textAlign: 'center', fontSize: 9 }}>{bus.kind === 'main' ? 'Main' : bus.kind === 'sub' ? 'Submix' : 'Aux'}</div>
      {variant === 'protools' && <InsertSlots target={bus.id} inserts={bus.inserts} run={run} onEdit={onEdit} editing={editing} idPrefix={id} />}
      {variant === 'fairlight' && bus.inserts.length > 0 && (
        <div className="snd-strip__section">
          {bus.inserts.map((slot) => (
            <div key={slot.id} className={`snd-strip__slot ${slot.bypass ? 'snd-strip__slot--bypass' : ''}`} onClick={() => onEdit({ target: bus.id, insertId: slot.id })}>{INSERT_LABEL[slot.kind]}</div>
          ))}
        </div>
      )}
      {bus.kind !== 'main' && variant !== 'studio' && (
        <select className="snd-select" data-automation-id={`${id}-output`} value={bus.outputBusId ?? ''} onChange={(e) => run('bus.set', { busId: bus.id, outputBusId: e.target.value })}>
          {mix.buses.filter((b) => b.id !== bus.id && b.kind === 'main').map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      )}
      <PanControl pan={bus.pan} id={`${id}-pan`} onChange={(pan) => run('bus.set', { busId: bus.id, pan })} />
      <div className="snd-strip__toggles">
        {bus.kind !== 'main' && <button type="button" className="snd-tog snd-tog--s" aria-pressed={bus.solo} data-automation-id={`${id}-solo`} onClick={() => run('bus.set', { busId: bus.id, solo: !bus.solo })}>S</button>}
        <button type="button" className="snd-tog snd-tog--m" aria-pressed={bus.mute} data-automation-id={`${id}-mute`} onClick={() => run('bus.set', { busId: bus.id, mute: !bus.mute })}>M</button>
      </div>
      <div className="snd-strip__faderzone">
        <Fader db={bus.gainDb} id={`${id}-fader`} onChange={(db) => run('bus.set', { busId: bus.id, gainDb: db })} />
        <Meter reading={meter} id={`${id}-meter`} />
      </div>
      <div className="snd-strip__db">{bus.gainDb <= MIN_DB ? '−∞' : formatDb(bus.gainDb)}</div>
    </div>
  );
};

export const MasterStrip: React.FC<{ mix: SoundMix; meter?: MeterReading; run: RunCommand }> = ({ mix, meter, run }) => (
  <div className="snd-strip snd-strip--master" data-automation-id="sound-master">
    <div className="snd-strip__name">Master</div>
    <button type="button" className={`snd-strip__slot ${mix.master.limiter.enabled ? 'snd-strip__slot--active' : 'snd-strip__slot--bypass'}`} data-automation-id="sound-master-limiter" onClick={() => run('master.set', { limiterEnabled: !mix.master.limiter.enabled })}>
      Limiter {formatDb(mix.master.limiter.ceilingDb)}
    </button>
    <div className="snd-strip__gr">{meter && meter.reductionDb < -0.2 ? `GR ${meter.reductionDb.toFixed(1)}` : ''}</div>
    <div className="snd-strip__faderzone">
      <Fader db={mix.master.gainDb} id="sound-master-fader" onChange={(db) => run('master.set', { gainDb: db })} />
      <Meter reading={meter} id="sound-master-meter" />
    </div>
    <div className="snd-strip__db">{formatDb(mix.master.gainDb)}</div>
  </div>
);
