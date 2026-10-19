import { useState } from 'react';
import type { MapNode, MapRegion } from '../../lib/api.js';
import { useNeuralStore } from '../../store/neuralStore.js';
import { Icon } from '../../shell/icons.js';
import { TYPE_NAME, TypeMark } from '../memory/MemoryRow.js';
import { useMapStore } from './mapStore.js';
import { regionName } from './lenses.js';

/** A region lists this many of its memories, most important first. */
const MEMBERS_SHOWN = 120;
const TYPES: MapNode['type'][] = ['semantic', 'episodic', 'procedural'];

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

/**
 * The sheet's Regions mode, the list twin of the map's place names: every
 * region as a button (size, the share that is reflections, contradictions,
 * what is new this week). An open region shows its make-up, can be renamed on
 * this device, and lists its memories.
 */
export default function RegionsPanel({ onRegion }: { onRegion: (id: string | null) => void }) {
  const model = useMapStore((s) => s.model);
  const regionId = useMapStore((s) => s.regionId);
  const names = useMapStore((s) => s.names);
  const status = useMapStore((s) => s.status);
  if (!model) {
    return (
      <div className="mp-note">
        <p>{status === 'error' ? 'The regions appear once the map is charted.' : 'The regions appear once the map is charted. It is being charted now.'}</p>
      </div>
    );
  }
  const region = regionId ? model.regions.find((r) => r.id === regionId) : undefined;
  if (region) return <RegionDetail region={region} name={regionName(region, names)} renamed={Boolean(names[region.id])} onBack={() => onRegion(null)} />;
  const top = model.regions[0]?.count ?? 1;
  return (
    <>
      {model.regions.map((r) => (
        <button key={r.id} type="button" className="mp-region" onClick={() => onRegion(r.id)}>
          <span className="mp-region-h">
            <span className="mp-region-n">{regionName(r, names)}</span>
            <b>{r.count.toLocaleString('en-US')}</b>
          </span>
          <span className="mp-region-bar" style={{ width: `${(100 * r.count) / top}%` }} aria-hidden="true">
            <i style={{ flexGrow: Math.max(0, 1 - r.reflectionShare) }} />
            {r.reflectionShare > 0 && <i className="hollow" style={{ flexGrow: r.reflectionShare }} />}
          </span>
          <span className="mm-row-m">
            <span>{r.reflectionShare > 0 ? `${Math.round(r.reflectionShare * 100)}% reflections` : 'No reflections'}</span>
            <span>{plural(r.contradictions, 'contradiction', 'contradictions')}</span>
            <span>{r.newThisWeek > 0 ? `${r.newThisWeek} new this week` : 'Quiet this week'}</span>
          </span>
        </button>
      ))}
    </>
  );
}

function RegionDetail({ region, name, renamed, onBack }: { region: MapRegion; name: string; renamed: boolean; onBack: () => void }) {
  const model = useMapStore((s) => s.model)!;
  const rename = useMapStore((s) => s.rename);
  const openId = useNeuralStore((s) => s.selectedNeuronId);
  const selectNeuron = useNeuralStore((s) => s.selectNeuron);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const members = model.nodes.filter((n) => n.regionId === region.id);
  const byType = TYPES.map((t) => [t, members.filter((n) => n.type === t).length] as const);
  const reflections = members.filter((n) => n.isReflection).length;
  const shown = [...members].sort((a, b) => b.importance - a.importance || b.createdAt.localeCompare(a.createdAt)).slice(0, MEMBERS_SHOWN);

  const save = () => {
    rename(region.id, draft);
    setEditing(false);
  };

  return (
    <div className="mp-rd">
      <div className="mp-rd-h">
        <button type="button" className="mm-quiet mp-back" onClick={onBack}>
          <Icon name="back" size={16} />
          All regions
        </button>
        {editing ? (
          <form
            className="mp-rename"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <label htmlFor="mp-rename-in">Name on this device</label>
            <input
              id="mp-rename-in"
              value={draft}
              maxLength={60}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setEditing(false);
                }
              }}
            />
            <span>
              <button type="submit" className="at-btn">
                Save name
              </button>
              <button type="button" className="at-btn sec" onClick={() => setEditing(false)}>
                Cancel
              </button>
              {renamed && (
                <button
                  type="button"
                  className="mm-quiet"
                  onClick={() => {
                    rename(region.id, '');
                    setEditing(false);
                  }}
                >
                  Use “{region.name}”
                </button>
              )}
            </span>
          </form>
        ) : (
          <div className="mp-rd-title">
            <h3>{name}</h3>
            <button
              type="button"
              className="mm-quiet"
              onClick={() => {
                setDraft(name);
                setEditing(true);
              }}
              aria-label={`Rename ${name}`}
            >
              <Icon name="edit" size={15} />
              Rename
            </button>
          </div>
        )}
        <p>
          {plural(region.count, 'memory', 'memories')}, {plural(reflections, 'reflection', 'reflections')}, {plural(region.contradictions, 'contradiction', 'contradictions')}
        </p>
      </div>
      <div className="mp-rd-types">
        {byType.map(([type, n]) => (
          <div key={type} className="mp-meter">
            <span>
              <TypeMark type={type} size={11} />
              {TYPE_NAME[type]}
            </span>
            <span className="mp-meter-bar" aria-hidden="true">
              <i data-type={type} style={{ width: `${members.length ? (100 * n) / members.length : 0}%` }} />
            </span>
            <b>{n}</b>
          </div>
        ))}
      </div>
      {shown.map((node) => (
        <button
          key={node.id}
          type="button"
          className="mm-row"
          data-id={node.id}
          aria-current={node.id === openId || undefined}
          onClick={() => selectNeuron(node.id)}
        >
          <TypeMark type={node.type} hollow={node.isReflection} />
          <span className="mm-row-main">
            <span className="mm-row-t">{node.label}</span>
            <span className="mm-row-m">
              <span className="at-sr">{TYPE_NAME[node.type]}.</span>
              {node.source && <span>{node.source}</span>}
              <span>importance {Math.round(node.importance * 100)}%</span>
            </span>
          </span>
        </button>
      ))}
      {members.length > shown.length && (
        <p className="mp-more">
          The {shown.length} most important of {members.length.toLocaleString('en-US')}. Search finds the rest.
        </p>
      )}
    </div>
  );
}
