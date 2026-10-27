/**
 * Properties editor with a vertical tab strip, like Blender's: Ausgabe, Szene, Welt, Objekt,
 * Objektdaten (Kamera/Licht) and Material. Every field runs a command, so it is undoable
 * and reachable by agents with the same names.
 */
import React, { useState } from 'react';
import { Box, Clapperboard, Copy, Globe, Lightbulb, Monitor, Paintbrush, Video } from 'lucide-react';
import type { SetDesignCameraObject, SetDesignLight, SetDesignState } from '../../types';
import type { SetDesignUiState } from '../../setdesign/commands.ts';
import { describeObject } from '../../setdesign/commands.ts';
import { describeCamera, horizontalFovDeg, LENS_PRESETS_MM, SENSOR_PRESETS } from '../../setdesign/cameraMath.ts';
import { findSceneObject, getActiveCamera, type SceneObjectRef } from '../../setdesign/sceneModel.ts';
import { kelvinToHex } from '../../setdesign/sceneBuilder.ts';
import { setDesignBus } from '../../setdesign/bus.ts';
import { NumberField, ObjectIcon, Panel, Prop, runCommand } from './ui.tsx';

type Tab = 'output' | 'scene' | 'world' | 'object' | 'data' | 'material';

export const OUTPUT_PRESETS = [
  { label: '16:9 · 1920 × 1080', width: 1920, height: 1080 },
  { label: '16:9 · 3840 × 2160 (UHD)', width: 3840, height: 2160 },
  { label: '2,39:1 · 2048 × 858', width: 2048, height: 858 },
  { label: '1,85:1 · 1998 × 1080', width: 1998, height: 1080 },
  { label: '4:3 · 1440 × 1080', width: 1440, height: 1080 },
  { label: '1:1 · 1080 × 1080', width: 1080, height: 1080 },
  { label: '4:5 · 1080 × 1350', width: 1080, height: 1350 },
  { label: '9:16 · 1080 × 1920', width: 1080, height: 1920 },
];

const edit = (label: string) => ({
  onBegin: () => { if (!setDesignBus.inInteraction()) setDesignBus.beginInteraction(label); },
  onEnd: (commit: boolean) => setDesignBus.endInteraction(commit),
});

const copy = (text: string) => { void navigator.clipboard?.writeText(text).catch(() => undefined); };

type Props = { scene: SetDesignState; ui: SetDesignUiState; onError: (message: string) => void; preferredTab?: Tab | null };

const PropertiesEditor: React.FC<Props> = ({ scene, ui, onError, preferredTab }) => {
  const ref = ui.activeId ? findSceneObject(scene, ui.activeId) : null;
  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: 'output', label: 'Ausgabe', icon: <Monitor size={15} /> },
    { id: 'scene', label: 'Szene', icon: <Clapperboard size={15} /> },
    { id: 'world', label: 'Welt', icon: <Globe size={15} /> },
    ...(ref ? [{ id: 'object' as Tab, label: 'Objekt', icon: <Box size={15} /> }] : []),
    ...(ref && ref.kind !== 'asset' ? [{ id: 'data' as Tab, label: ref.kind === 'camera' ? 'Kameradaten' : 'Lichtdaten', icon: ref.kind === 'camera' ? <Video size={15} /> : <Lightbulb size={15} /> }] : []),
    ...(ref && ref.kind === 'asset' ? [{ id: 'material' as Tab, label: 'Material', icon: <Paintbrush size={15} /> }] : []),
  ];
  const [chosen, setChosen] = useState<Tab>('object');
  const wanted = preferredTab && tabs.some((t) => t.id === preferredTab) ? preferredTab : chosen;
  const tab = tabs.some((t) => t.id === wanted) ? wanted : ref ? (ref.kind === 'asset' ? 'object' : 'data') : 'output';

  return (
    <div className="sdx-props" data-automation-id="setdesign-properties">
      <div className="sdx-props__tabs">
        {tabs.map((t) => (
          <button key={t.id} type="button" title={t.label} className={tab === t.id ? 'is-on' : ''} onClick={() => setChosen(t.id)} data-automation-id={`setdesign-props-tab-${t.id}`}>{t.icon}</button>
        ))}
      </div>
      <div className="sdx-props__body">
        {tab === 'output' && <OutputTab scene={scene} onError={onError} />}
        {tab === 'scene' && <SceneTab scene={scene} ui={ui} onError={onError} />}
        {tab === 'world' && <WorldTab scene={scene} onError={onError} />}
        {tab === 'object' && ref && <ObjectTab scene={scene} objectRef={ref} onError={onError} />}
        {tab === 'data' && ref?.kind === 'camera' && <CameraTab scene={scene} camera={ref.object} onError={onError} />}
        {tab === 'data' && ref?.kind === 'light' && <LightTab light={ref.object} onError={onError} />}
        {tab === 'material' && ref?.kind === 'asset' && <MaterialTab objectRef={ref} onError={onError} />}
      </div>
    </div>
  );
};

const Crumb: React.FC<{ type: string; name: string }> = ({ type, name }) => (
  <div className="sdx-props__crumb"><ObjectIcon type={type} /> <span>{name}</span></div>
);

const OutputTab: React.FC<{ scene: SetDesignState; onError: (m: string) => void }> = ({ scene, onError }) => {
  const output = scene.output || { width: 1920, height: 1080 };
  return (
    <>
      <Panel title="Format" automationId="setdesign-props-output">
        <Prop label="Voreinstellung">
          <select
            className="sdx-select"
            style={{ width: '100%' }}
            value={OUTPUT_PRESETS.find((p) => p.width === output.width && p.height === output.height)?.label || ''}
            onChange={(event) => {
              const preset = OUTPUT_PRESETS.find((p) => p.label === event.target.value);
              if (preset) runCommand('scene.output', { width: preset.width, height: preset.height }, onError);
            }}
            data-automation-id="setdesign-output-preset"
          >
            <option value="">Eigene Größe</option>
            {OUTPUT_PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
          </select>
        </Prop>
        <Prop label="Auflösung" stack>
          <NumberField label="X" position="first" value={output.width} digits={0} step={10} unit="px" min={16} max={8192} {...edit('Auflösung')} onChange={(v) => runCommand('scene.output', { width: Math.round(v), height: output.height }, onError)} automationId="setdesign-output-width" />
          <NumberField label="Y" position="last" value={output.height} digits={0} step={10} unit="px" min={16} max={8192} {...edit('Auflösung')} onChange={(v) => runCommand('scene.output', { width: output.width, height: Math.round(v) }, onError)} automationId="setdesign-output-height" />
        </Prop>
        <div className="sdx-note">Seitenverhältnis {(output.width / output.height).toFixed(2).replace('.', ',')}:1 – bestimmt den Kamerarahmen und die Größe der Referenzframes.</div>
      </Panel>
    </>
  );
};

const SceneTab: React.FC<{ scene: SetDesignState; ui: SetDesignUiState; onError: (m: string) => void }> = ({ scene, ui, onError }) => (
  <>
    <Panel title="Szene" automationId="setdesign-props-scene">
      <Prop label="Kamera">
        <select className="sdx-select" style={{ width: '100%' }} value={scene.activeCameraId || ''} onChange={(event) => runCommand('camera.set_active', { object: event.target.value }, onError)} data-automation-id="setdesign-scene-camera">
          {(scene.cameras || []).map((camera) => <option key={camera.id} value={camera.id}>{camera.name}</option>)}
        </select>
      </Prop>
      <Prop label="Einheiten"><span className="sdx-note">Meter, Z oben (wie Blender)</span></Prop>
    </Panel>
    <Panel title="Ansicht">
      <label className="sdx-check"><input type="checkbox" checked={ui.lockCameraToView} onChange={(event) => runCommand('view.options', { lockCameraToView: event.target.checked }, onError)} /> Kamera an Ansicht sperren</label>
      <label className="sdx-check"><input type="checkbox" checked={ui.emulateNumpad} onChange={(event) => runCommand('view.options', { emulateNumpad: event.target.checked }, onError)} /> Ziffernreihe als Numpad</label>
      <label className="sdx-check"><input type="checkbox" checked={ui.snap} onChange={(event) => runCommand('view.options', { snap: event.target.checked }, onError)} /> Einrasten ({String(scene.grid?.snap ?? 0.5).replace('.', ',')} m, 5°)</label>
    </Panel>
  </>
);

const WorldTab: React.FC<{ scene: SetDesignState; onError: (m: string) => void }> = ({ scene, onError }) => {
  const world = scene.world || { color: '#3d3d40', strength: 0.6 };
  return (
    <Panel title="Welt" automationId="setdesign-props-world">
      <Prop label="Farbe"><input type="color" value={world.color} onChange={(event) => runCommand('scene.world', { color: event.target.value }, onError)} style={{ width: '100%', height: 22 }} /></Prop>
      <Prop label="Stärke"><NumberField value={world.strength} digits={2} step={0.05} min={0} max={5} {...edit('Welt')} onChange={(v) => runCommand('scene.world', { strength: v }, onError)} automationId="setdesign-world-strength" /></Prop>
      <div className="sdx-note">Hintergrund und Umgebungslicht in den Shading-Modi „Gerendert“, Clay und Tiefe.</div>
      <Prop label="HDRI">
        <input className="sdx-input" style={{ width: '100%' }} placeholder="https://…/studio.hdr" defaultValue={world.hdriUrl || ''} key={world.hdriUrl || 'none'} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }} onBlur={(event) => { const value = event.target.value.trim(); if (value !== (world.hdriUrl || '')) runCommand('scene.hdri', value ? { url: value } : { clear: true }, onError); }} data-automation-id="setdesign-world-hdri" />
      </Prop>
      {world.hdriUrl && (
        <>
          <label className="sdx-check"><input type="checkbox" checked={!!world.hdriBackground} onChange={(event) => runCommand('scene.hdri', { background: event.target.checked }, onError)} /> HDRI als Hintergrund</label>
          <Prop label="HDRI-Stärke"><NumberField value={world.hdriStrength ?? 1} digits={2} step={0.05} min={0} max={10} {...edit('HDRI')} onChange={(v) => runCommand('scene.hdri', { strength: v }, onError)} /></Prop>
        </>
      )}
    </Panel>
  );
};

const ObjectTab: React.FC<{ scene: SetDesignState; objectRef: SceneObjectRef; onError: (m: string) => void }> = ({ scene, objectRef, onError }) => {
  const d = describeObject(scene, objectRef) as ReturnType<typeof describeObject> & { scale?: { x: number; y: number; z: number } };
  const id = objectRef.object.id;
  const locked = 'locked' in objectRef.object && !!objectRef.object.locked;
  const axis = (key: 'location' | 'rotation' | 'scale', label: string, unit: string, step: number, digits: number) => (
    <Prop label={label} stack>
      {(['x', 'y', 'z'] as const).map((a, index) => (
        <NumberField
          key={a}
          label={a.toUpperCase()}
          position={index === 0 ? 'first' : index === 2 ? 'last' : 'mid'}
          value={(d[key] as { x: number; y: number; z: number })[a]}
          unit={unit}
          step={step}
          digits={digits}
          disabled={locked}
          {...edit(label)}
          onChange={(v) => runCommand('object.transform', { object: id, [key]: { ...(d[key] as object), [a]: v } }, onError)}
          automationId={`setdesign-${key}-${a}`}
        />
      ))}
    </Prop>
  );
  return (
    <>
      <Crumb type={String(d.type)} name={d.name} />
      <Panel title="Transformation" automationId="setdesign-props-transform">
        {axis('location', 'Position', 'm', 0.1, 3)}
        {axis('rotation', 'Drehung', '°', 5, 1)}
        {d.scale && axis('scale', 'Maßstab', '', 0.1, 3)}
      </Panel>
      <Panel title="Objekt">
        <Prop label="Name"><input className="sdx-input" style={{ width: '100%' }} defaultValue={d.name} key={d.name} onBlur={(event) => { if (event.target.value.trim() && event.target.value !== d.name) runCommand('object.update', { object: id, name: event.target.value }, onError); }} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }} data-automation-id="setdesign-object-name" /></Prop>
        <label className="sdx-check"><input type="checkbox" checked={!objectRef.object.hidden} onChange={(event) => runCommand('object.update', { object: id, hidden: !event.target.checked }, onError)} /> Sichtbar</label>
        {objectRef.kind !== 'light' && <label className="sdx-check"><input type="checkbox" checked={locked} onChange={(event) => runCommand('object.update', { object: id, locked: event.target.checked }, onError)} /> Gesperrt</label>}
        {objectRef.kind === 'asset' && objectRef.object.attribution && <div className="sdx-note">{objectRef.object.attribution.author} · {objectRef.object.attribution.license}</div>}
      </Panel>
    </>
  );
};

const CameraTab: React.FC<{ scene: SetDesignState; camera: SetDesignCameraObject; onError: (m: string) => void }> = ({ scene, camera, onError }) => {
  const output = scene.output || { width: 1920, height: 1080 };
  const aspect = output.width / output.height;
  const setup = describeCamera(camera, aspect);
  const isActive = getActiveCamera(scene)?.id === camera.id;
  const update = (patch: Record<string, unknown>) => runCommand('object.update', { object: camera.id, ...patch }, onError);
  const sensor = SENSOR_PRESETS.find((p) => Math.abs(p.widthMm - camera.sensorWidthMm) < 0.05);
  return (
    <>
      <Crumb type="camera" name={camera.name} />
      {!isActive && <button type="button" className="sdx-btn sdx-btn--primary" style={{ width: '100%', marginBottom: 4 }} onClick={() => runCommand('camera.set_active', { object: camera.id }, onError)} data-automation-id="setdesign-camera-make-active">Als aktive Kamera setzen</button>}
      <Panel title="Objektiv" automationId="setdesign-props-lens">
        <Prop label="Brennweite"><NumberField value={camera.lensMm} unit="mm" digits={1} step={1} min={1} max={2000} {...edit('Brennweite')} onChange={(v) => update({ lensMm: v })} automationId="setdesign-camera-lens" /></Prop>
        <div className="sdx-chips">
          {LENS_PRESETS_MM.map((mm) => <button key={mm} type="button" className={`sdx-chip${Math.abs(camera.lensMm - mm) < 0.05 ? ' is-on' : ''}`} onClick={() => update({ lensMm: mm })}>{mm}</button>)}
        </div>
        <div className="sdx-note">Bildwinkel {horizontalFovDeg(camera, aspect).toFixed(1).replace('.', ',')}° horizontal</div>
        <Prop label="Shift" stack>
          <NumberField label="X" position="first" value={camera.shiftX || 0} digits={3} step={0.01} min={-2} max={2} {...edit('Shift')} onChange={(v) => update({ shiftX: v })} automationId="setdesign-camera-shift-x" />
          <NumberField label="Y" position="last" value={camera.shiftY || 0} digits={3} step={0.01} min={-2} max={2} {...edit('Shift')} onChange={(v) => update({ shiftY: v })} automationId="setdesign-camera-shift-y" />
        </Prop>
        <Prop label="Clip" stack>
          <NumberField label="Anfang" position="first" value={camera.clipStart ?? 0.1} unit="m" digits={2} step={0.05} min={0.001} {...edit('Clip')} onChange={(v) => update({ clipStart: v })} />
          <NumberField label="Ende" position="last" value={camera.clipEnd ?? 1000} unit="m" digits={0} step={10} min={1} {...edit('Clip')} onChange={(v) => update({ clipEnd: v })} />
        </Prop>
      </Panel>
      <Panel title="Kamera (Sensor)" automationId="setdesign-props-sensor">
        <Prop label="Format">
          <select className="sdx-select" style={{ width: '100%' }} value={sensor?.id || ''} onChange={(event) => { if (event.target.value) update({ sensorPreset: event.target.value }); }} data-automation-id="setdesign-camera-sensor-preset">
            <option value="">Eigene Größe</option>
            {SENSOR_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Prop>
        <Prop label="Anpassung">
          <select className="sdx-select" style={{ width: '100%' }} value={camera.sensorFit || 'auto'} onChange={(event) => update({ sensorFit: event.target.value })}>
            <option value="auto">Automatisch</option>
            <option value="horizontal">Horizontal</option>
            <option value="vertical">Vertikal</option>
          </select>
        </Prop>
        <Prop label="Größe" stack>
          <NumberField label="Breite" position="first" value={camera.sensorWidthMm} unit="mm" digits={2} step={0.1} min={1} {...edit('Sensor')} onChange={(v) => update({ sensorWidthMm: v })} automationId="setdesign-camera-sensor-width" />
          <NumberField label="Höhe" position="last" value={camera.sensorHeightMm ?? camera.sensorWidthMm * (2 / 3)} unit="mm" digits={2} step={0.1} min={1} {...edit('Sensor')} onChange={(v) => update({ sensorHeightMm: v })} />
        </Prop>
      </Panel>
      <Panel title="Tiefenschärfe" defaultOpen={false}>
        <Prop label="Fokusdistanz"><NumberField value={camera.focusDistance ?? 0} unit="m" digits={2} step={0.1} min={0} {...edit('Fokus')} onChange={(v) => update({ focusDistance: v })} /></Prop>
        <Prop label="Blende"><NumberField value={camera.fStop ?? 2.8} digits={1} step={0.1} min={0.5} max={64} {...edit('Blende')} onChange={(v) => update({ fStop: v })} /></Prop>
        <div className="sdx-note">Wird als Angabe in Prompts und Shot-Notizen genutzt; die Vorschau rendert ohne Unschärfe.</div>
      </Panel>
      <Panel title="Einstellung als Text" automationId="setdesign-props-setup">
        <div className="sdx-prompt">{setup.de}</div>
        <div className="sdx-prompt" style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <span style={{ flex: 1 }}>{setup.en}</span>
          <button type="button" className="sdx-btn sdx-btn--icon" title="Englische Zeile für den Prompt kopieren" onClick={() => copy(setup.en)}><Copy size={12} /></button>
        </div>
      </Panel>
    </>
  );
};

const LIGHT_LABEL: Record<string, string> = { point: 'Punkt', sun: 'Sonne', spot: 'Spot', area: 'Fläche' };

const LightTab: React.FC<{ light: SetDesignLight; onError: (m: string) => void }> = ({ light, onError }) => {
  const type = light.type === 'directional' ? 'sun' : light.type;
  const update = (patch: Record<string, unknown>) => runCommand('object.update', { object: light.id, ...patch }, onError);
  if (type === 'ambient') {
    return (
      <>
        <Crumb type="ambient" name={light.name || 'Umgebungslicht'} />
        <Panel title="Umgebungslicht">
          <Prop label="Stärke"><NumberField value={light.intensity} digits={2} step={0.05} min={0} {...edit('Licht')} onChange={(v) => update({ intensity: v })} /></Prop>
          <div className="sdx-note">Altes Umgebungslicht aus früheren Projekten. Neue Sets nutzen die Welt-Stärke.</div>
        </Panel>
      </>
    );
  }
  const power = light.power ?? (type === 'sun' ? light.intensity : light.intensity * 4 * Math.PI);
  return (
    <>
      <Crumb type={type} name={light.name || 'Licht'} />
      <Panel title="Licht" automationId="setdesign-props-light">
        <div className="sdx-seg" style={{ width: '100%' }}>
          {(['point', 'sun', 'spot', 'area'] as const).map((t) => (
            <button key={t} type="button" style={{ flex: 1 }} className={type === t ? 'is-on' : ''} onClick={() => update({ lightType: t })} data-automation-id={`setdesign-light-type-${t}`}>{LIGHT_LABEL[t]}</button>
          ))}
        </div>
        <label className="sdx-check"><input type="checkbox" checked={!!light.useTemperature} onChange={(event) => update(event.target.checked ? { temperature: light.temperature || 5600 } : { color: light.color || '#ffffff' })} /> Farbtemperatur</label>
        {light.useTemperature ? (
          <Prop label="Temperatur">
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <div style={{ flex: 1 }}><NumberField value={light.temperature || 5600} unit="K" digits={0} step={100} min={1000} max={20000} {...edit('Farbtemperatur')} onChange={(v) => update({ temperature: v })} automationId="setdesign-light-temperature" /></div>
              <span style={{ width: 18, height: 18, borderRadius: 3, background: kelvinToHex(light.temperature || 5600), border: '1px solid #000' }} />
            </div>
          </Prop>
        ) : (
          <Prop label="Farbe"><input type="color" value={light.color || '#ffffff'} onChange={(event) => update({ color: event.target.value })} style={{ width: '100%', height: 22 }} data-automation-id="setdesign-light-color" /></Prop>
        )}
        {light.useTemperature && (
          <div className="sdx-chips">
            {[[1900, 'Kerze'], [2700, 'Glühlampe'], [3200, 'Kunstlicht'], [4300, 'Neon'], [5600, 'Tageslicht'], [6500, 'bedeckt'], [8000, 'Schatten']].map(([k, label]) => (
              <button key={k} type="button" className={`sdx-chip${light.temperature === k ? ' is-on' : ''}`} onClick={() => update({ temperature: k })} title={`${k} K`}>{label}</button>
            ))}
          </div>
        )}
        <Prop label={type === 'sun' ? 'Stärke' : 'Leistung'}><NumberField value={power} unit={type === 'sun' ? 'W/m²' : 'W'} digits={type === 'sun' ? 2 : 0} step={type === 'sun' ? 0.1 : 10} min={0} {...edit('Leistung')} onChange={(v) => update({ power: v })} automationId="setdesign-light-power" /></Prop>
        {type === 'spot' && (
          <>
            <Prop label="Kegel"><NumberField value={light.spotSize ?? 45} unit="°" digits={1} step={1} min={1} max={180} {...edit('Spot')} onChange={(v) => update({ spotSize: v })} automationId="setdesign-light-spot-size" /></Prop>
            <Prop label="Weichheit"><NumberField value={light.spotBlend ?? 0.15} digits={3} step={0.01} min={0} max={1} slider {...edit('Spot')} onChange={(v) => update({ spotBlend: v })} /></Prop>
          </>
        )}
        {type === 'area' && (
          <Prop label="Größe" stack>
            <NumberField label="X" position="first" value={light.size ?? 1} unit="m" digits={2} step={0.05} min={0.01} {...edit('Größe')} onChange={(v) => update({ size: v })} automationId="setdesign-light-size" />
            <NumberField label="Y" position="last" value={light.sizeY ?? light.size ?? 1} unit="m" digits={2} step={0.05} min={0.01} {...edit('Größe')} onChange={(v) => update({ sizeY: v })} />
          </Prop>
        )}
        <label className="sdx-check"><input type="checkbox" checked={light.castShadow !== false} disabled={type === 'area'} onChange={(event) => update({ castShadow: event.target.checked })} /> Schatten{type === 'area' ? ' (Flächenlichter ohne Schatten in der Vorschau)' : ''}</label>
        <div className="sdx-note">Leistung wie in Blender; die Vorschau rechnet sie angenähert um. Sichtbar in „Gerendert“ und in Referenzframes.</div>
      </Panel>
    </>
  );
};

const MaterialTab: React.FC<{ objectRef: Extract<SceneObjectRef, { kind: 'asset' }>; onError: (m: string) => void }> = ({ objectRef, onError }) => {
  const asset = objectRef.object;
  const material = asset.material || {};
  const update = (patch: Record<string, unknown>) => runCommand('object.update', { object: asset.id, ...patch }, onError);
  return (
    <>
      <Crumb type={asset.kind === 'model' ? 'model' : asset.primitive || 'box'} name={asset.name} />
      <Panel title="Oberfläche" automationId="setdesign-props-material">
        {asset.kind === 'model' && <div className="sdx-note">Importierte Modelle behalten ihre eigenen Materialien; diese Werte wirken im Solid-Shading und als Grundfarbe.</div>}
        <Prop label="Grundfarbe"><input type="color" value={material.color || '#b4b4b8'} onChange={(event) => update({ color: event.target.value })} style={{ width: '100%', height: 22 }} data-automation-id="setdesign-material-color" /></Prop>
        <Prop label="Rauheit"><NumberField value={material.roughness ?? 0.8} digits={3} step={0.01} min={0} max={1} slider {...edit('Material')} onChange={(v) => update({ roughness: v })} automationId="setdesign-material-roughness" /></Prop>
        <Prop label="Metallisch"><NumberField value={material.metalness ?? 0} digits={3} step={0.01} min={0} max={1} slider {...edit('Material')} onChange={(v) => update({ metalness: v })} /></Prop>
        <Prop label="Deckkraft"><NumberField value={material.opacity ?? 1} digits={3} step={0.01} min={0} max={1} slider {...edit('Material')} onChange={(v) => update({ opacity: v })} /></Prop>
      </Panel>
    </>
  );
};

export default PropertiesEditor;
