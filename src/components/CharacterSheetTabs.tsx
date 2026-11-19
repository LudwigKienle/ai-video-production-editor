import React from 'react';
import type { CreatureMaterial, CreatureWorkshop, ReferenceItem } from '../types';
import { fileToBase64 } from '../utils/helpers';
import { buildCreatureLocationNote } from '../utils/characterSheet';

export type CreatureStep = 'clay' | 'claySheet' | 'face' | 'material' | 'combine';
export type SheetModelOption = { id: string; label: string };

const card = 'bg-gray-900/60 border border-gray-800 rounded-xl p-4 space-y-3';
const label = 'text-[10px] uppercase tracking-wide text-gray-500';
const input = 'w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-xs text-gray-100 focus:outline-none focus:border-indigo-500';
const primary = 'px-3 py-1.5 rounded text-xs font-semibold bg-indigo-600/80 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed';
const secondary = 'px-3 py-1.5 rounded text-xs font-semibold bg-gray-800 text-gray-200 hover:bg-gray-700 disabled:opacity-40';

const newId = () => `mat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const readImageFile = async (file: File) => {
  const base64 = await fileToBase64(file);
  return base64.startsWith('data:') ? base64 : `data:${file.type || 'image/png'};base64,${base64}`;
};

const Thumb: React.FC<{ url?: string; alt: string; aspect: string; onView: (url: string, title?: string) => void; empty: string }> = ({ url, alt, aspect, onView, empty }) => (
  <div className={`${aspect} bg-gray-950 rounded-lg border border-gray-800 overflow-hidden`}>
    {url ? (
      <button type="button" className="w-full h-full" onClick={() => onView(url, alt)} title="Full view">
        <img src={url} alt={alt} className="w-full h-full object-cover" />
      </button>
    ) : (
      <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-500 px-2 text-center">{empty}</div>
    )}
  </div>
);

const UploadButton: React.FC<{ onImage: (dataUrl: string) => void; title?: string }> = ({ onImage, title = 'Upload' }) => (
  <label className={`${secondary} cursor-pointer`}>
    {title}
    <input
      type="file"
      accept="image/*"
      className="hidden"
      onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) onImage(await readImageFile(file));
      }}
    />
  </label>
);

/* ─── Reference sheet (humans) ─── */

export const ReferenceSheetTab: React.FC<{
  character: ReferenceItem;
  model: string;
  modelOptions: SheetModelOption[];
  onModelChange: (model: string) => void;
  onGenerate: () => void;
  onUpdate: (updates: Partial<ReferenceItem>) => void;
  onViewFull: (url: string, title?: string) => void;
}> = ({ character, model, modelOptions, onModelChange, onGenerate, onUpdate, onViewFull }) => {
  const versions = (character.characterSheetVersions || []).filter(Boolean);
  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="text-xs text-gray-300 leading-relaxed">
          One 16:9 sheet on grey: <strong>full-body front</strong> with the face hidden, <strong>full-body back</strong>, and a <strong>front close-up</strong>.
          The face appears only once, large and sharp, so storyboard and video models copy it instead of a small one; the full-body views carry outfit and proportions.
          When a sheet exists, storyboard frames use it as this character&apos;s reference.
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={model} onChange={(event) => onModelChange(event.target.value)} className="bg-gray-950 border border-gray-800 rounded px-2 py-1.5 text-xs text-gray-200">
            {modelOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <button type="button" className={primary} disabled={character.isGeneratingSheet} onClick={onGenerate}>
            {character.isGeneratingSheet ? 'Generating sheet…' : character.characterSheetUrl ? 'Regenerate sheet' : 'Generate sheet'}
          </button>
          <UploadButton title="Upload sheet" onImage={(url) => onUpdate({ characterSheetUrl: url, characterSheetVersions: [...versions, url] })} />
          {character.characterSheetUrl && (
            <button type="button" className={secondary} onClick={() => onUpdate({ characterSheetUrl: undefined })}>Don&apos;t use a sheet</button>
          )}
        </div>
        {!character.imageUrl && (
          <div className="text-[10px] text-amber-300/80">No base image yet: the sheet is generated from the description. With a base image it keeps that exact person.</div>
        )}
      </div>
      <Thumb url={character.characterSheetUrl} alt={`${character.name} sheet`} aspect="aspect-video" onView={onViewFull} empty="No sheet yet" />
      {versions.length > 1 && (
        <div className="space-y-2">
          <div className={label}>Versions</div>
          <div className="grid grid-cols-3 gap-2">
            {versions.map((url, index) => (
              <button
                key={`${url}-${index}`}
                type="button"
                onClick={() => onUpdate({ characterSheetUrl: url })}
                className={`aspect-video rounded-md overflow-hidden border ${url === character.characterSheetUrl ? 'border-indigo-400' : 'border-gray-700'}`}
                title="Use this version"
              >
                <img src={url} alt={`Sheet ${index + 1}`} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* ─── Creature workshop ─── */

export const CreatureWorkshopTab: React.FC<{
  character: ReferenceItem;
  clayModel: string;
  clayModelOptions: SheetModelOption[];
  onClayModelChange: (model: string) => void;
  hasHiggsfield: boolean;
  onRunStep: (step: CreatureStep, opts?: { materialId?: string }) => void;
  onUpdateCreature: (updates: Partial<CreatureWorkshop>) => void;
  onUseResult: (url: string, asSheet: boolean) => void;
  onViewFull: (url: string, title?: string) => void;
}> = ({ character, clayModel, clayModelOptions, onClayModelChange, hasHiggsfield, onRunStep, onUpdateCreature, onUseResult, onViewFull }) => {
  const creature = character.creature || {};
  const materials = creature.materials || [];
  const busy = character.creatureBusyStep || null;
  const isBusy = (step: string) => busy === step;
  const anyBusy = Boolean(busy);
  const updateMaterial = (id: string, updates: Partial<CreatureMaterial>) =>
    onUpdateCreature({ materials: materials.map((item) => (item.id === id ? { ...item, ...updates } : item)) });
  const shapeUrl = creature.claySheetUrl || creature.clayUrl;
  const swatchModel = hasHiggsfield ? 'Soul 2' : 'Seedream 5.5 (add a Higgsfield key for Soul 2)';

  return (
    <div className="space-y-4">
      <div className="text-xs text-gray-400 leading-relaxed">
        Creatures are built like in a creature shop: sculpt the shape in grey clay, borrow a real face, pick real materials, then photograph
        it all as a plain flash makeup test. Clay gives the right shape, real photos give real skin, and the plain photo keeps it from looking CG.
      </div>

      <div className={card}>
        <div className={label}>1 · Clay sculpt (shape only)</div>
        <textarea
          className={input}
          rows={2}
          placeholder="Concept, e.g. demon king, half bear half wolf, boar tusks, topknot, draped in his trophies"
          value={creature.concept ?? ''}
          onChange={(event) => onUpdateCreature({ concept: event.target.value })}
        />
        <input
          className={input}
          placeholder="Features to lock by name, e.g. heavy brow, boar tusks, topknot, braided beard, prayer beads"
          value={creature.shapeDetails ?? ''}
          onChange={(event) => onUpdateCreature({ shapeDetails: event.target.value })}
        />
        <div className="flex flex-wrap items-center gap-2">
          <select value={clayModel} onChange={(event) => onClayModelChange(event.target.value)} className="bg-gray-950 border border-gray-800 rounded px-2 py-1.5 text-xs text-gray-200">
            {clayModelOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <button type="button" className={primary} disabled={anyBusy} onClick={() => onRunStep('clay')}>{isBusy('clay') ? 'Sculpting…' : 'Sculpt clay bust'}</button>
          <button type="button" className={secondary} disabled={anyBusy} onClick={() => onRunStep('claySheet')}>{isBusy('claySheet') ? 'Sculpting…' : 'Clay turnaround (3 views)'}</button>
          <UploadButton title="Upload clay" onImage={(url) => onUpdateCreature({ clayUrl: url })} />
        </div>
        <div className="text-[10px] text-gray-500">Seedream 5.5 for complex anatomy and giants, Soul 2 when the face matters most. The turnaround (face close-up, front, back) is what video models need later.</div>
        <div className="grid grid-cols-3 gap-2">
          <Thumb url={creature.clayUrl} alt="Clay bust" aspect="aspect-[3/4]" onView={onViewFull} empty="Clay bust" />
          <div className="col-span-2"><Thumb url={creature.claySheetUrl} alt="Clay turnaround" aspect="aspect-video" onView={onViewFull} empty="Clay turnaround" /></div>
        </div>
      </div>

      <div className={card}>
        <div className={label}>2 · Real face</div>
        <input
          className={input}
          placeholder="Whose face to borrow, e.g. an American black bear, or a weathered old fisherman"
          value={creature.faceSource ?? ''}
          onChange={(event) => onUpdateCreature({ faceSource: event.target.value })}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={primary} disabled={anyBusy} onClick={() => onRunStep('face')}>{isBusy('face') ? 'Shooting…' : `Photograph face (${hasHiggsfield ? 'Soul 2' : 'Seedream 5.5'})`}</button>
          <UploadButton title="Upload a real photo" onImage={(url) => onUpdateCreature({ faceUrl: url })} />
          {creature.faceUrl && <button type="button" className={secondary} onClick={() => onUpdateCreature({ faceUrl: undefined })}>No face reference</button>}
        </div>
        <div className="w-40"><Thumb url={creature.faceUrl} alt="Face reference" aspect="aspect-square" onView={onViewFull} empty="Optional" /></div>
      </div>

      <div className={card}>
        <div className="flex items-center justify-between">
          <div className={label}>3 · Real materials · one per part ({swatchModel})</div>
          <button type="button" className={secondary} onClick={() => onUpdateCreature({ materials: [...materials, { id: newId(), part: '', material: '' }] })}>+ Material</button>
        </div>
        {materials.length === 0 && <div className="text-[10px] text-gray-500">E.g. part “shoulder skulls” → material “weathered cattle skull bone”; “armour plates” → “sea urchin shell”. Every bone, shell or metal part gets its own swatch so the model copies it instead of guessing.</div>}
        {materials.map((item) => (
          <div key={item.id} className="grid grid-cols-[64px_1fr_1fr_auto] gap-2 items-center">
            <Thumb url={item.url} alt={item.material || item.part} aspect="aspect-square" onView={onViewFull} empty="—" />
            <input className={input} placeholder="Part" value={item.part} onChange={(event) => updateMaterial(item.id, { part: event.target.value })} />
            <input className={input} placeholder="Real material" value={item.material} onChange={(event) => updateMaterial(item.id, { material: event.target.value })} />
            <div className="flex flex-col gap-1">
              <button type="button" className={secondary} disabled={anyBusy || !(item.material || item.part)} onClick={() => onRunStep('material', { materialId: item.id })}>{isBusy(`material:${item.id}`) ? '…' : 'Macro'}</button>
              <UploadButton title="Upload" onImage={(url) => updateMaterial(item.id, { url })} />
              <button type="button" className="text-[10px] text-gray-500 hover:text-red-300" onClick={() => onUpdateCreature({ materials: materials.filter((entry) => entry.id !== item.id) })}>Remove</button>
            </div>
          </div>
        ))}
      </div>

      <div className={card}>
        <div className={label}>4 · Combine into a makeup-test photo (Seedream 5.5)</div>
        <input className={input} placeholder="Body covering in words, e.g. grey-brown grizzly fur" value={creature.bodyCovering ?? ''} onChange={(event) => onUpdateCreature({ bodyCovering: event.target.value })} />
        <input className={input} placeholder="Pieces never sculpted, e.g. armour of trophy pelts, a boar skull on each shoulder" value={creature.extraParts ?? ''} onChange={(event) => onUpdateCreature({ extraParts: event.target.value })} />
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={creature.photoStyle || 'makeup-test'}
            onChange={(event) => onUpdateCreature({ photoStyle: event.target.value as CreatureWorkshop['photoStyle'] })}
            className="bg-gray-950 border border-gray-800 rounded px-2 py-1.5 text-xs text-gray-200"
          >
            <option value="makeup-test">Makeup test · flash on grey paper</option>
            <option value="phone-flash">Phone snapshot · flash in a dim room</option>
          </select>
          <button type="button" className={primary} disabled={anyBusy || !shapeUrl} onClick={() => onRunStep('combine')}>{isBusy('combine') ? 'Combining…' : 'Combine'}</button>
        </div>
        <div className="text-[10px] text-gray-500">
          Image 1 is the clay{creature.claySheetUrl ? ' turnaround' : ''}, then the face, then each material. The stranger the creature, the plainer the photo.
          {!shapeUrl && ' Sculpt or upload the clay first.'}
        </div>
        <Thumb url={creature.finalUrl} alt={`${character.name} creature`} aspect={creature.claySheetUrl ? 'aspect-video' : 'aspect-[3/4]'} onView={onViewFull} empty="Result" />
        {creature.finalUrl && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} onClick={() => onUseResult(creature.finalUrl!, false)}>Use as main reference</button>
            <button type="button" className={secondary} onClick={() => onUseResult(creature.finalUrl!, true)}>Use as reference sheet</button>
          </div>
        )}
      </div>

      <div className="text-[10px] text-gray-500">{buildCreatureLocationNote()} For video, draft at 480p first, then render the chosen take at 1080p or 4K (BytePlus).</div>
    </div>
  );
};
