/**
 * How a content source is drawn and named.
 *
 * Icons are per source type: Alfresco and Nuxeo have their own, and every other type gets a neutral one.
 * The type helpers return a *modifier* ('alfresco', 'nuxeo', 'generic') and each component composes its
 * own class prefix from it, so a component's CSS stays local while the decision of which types are styled
 * lives in one place.
 *
 * Names and colours are per source, so two repositories of one type are told apart:
 * {@link sourceDisplayLabel} names a source and {@link sourceColourClass} picks its palette slot.
 */

export type SourceModifier = 'alfresco' | 'nuxeo' | 'sharepoint' | 'generic';

/** Source types with dedicated styling. Everything else is 'generic'. */
const STYLED_TYPES: readonly string[] = ['alfresco', 'nuxeo', 'sharepoint'];

/** Icons per styled type, plus the neutral default. */
const ICONS: Record<string, string> = {
  alfresco: 'storage',
  nuxeo: 'folder_open',
  sharepoint: 'cloud'
};

const GENERIC_ICON = 'description';

/**
 * Display names for source types we know by name. Anything absent is de-slugged from the type itself,
 * which reads better than a `titlecase` of the raw value: 'sample-directory' becomes
 * 'Sample Directory' rather than 'Sample-directory'.
 */
const TYPE_LABELS: Record<string, string> = {
  alfresco: 'Alfresco',
  nuxeo: 'Nuxeo',
  filesystem: 'Filesystem',
  cmis: 'CMIS',
  sharepoint: 'SharePoint'
};

export function sourceModifier(sourceType?: string): SourceModifier {
  const type = normalizeType(sourceType);
  return STYLED_TYPES.includes(type) ? (type as SourceModifier) : 'generic';
}

/** Material icon name for a source type. */
export function sourceIcon(sourceType?: string): string {
  return ICONS[normalizeType(sourceType)] ?? GENERIC_ICON;
}

/** `<prefix>-alfresco` / `-nuxeo` / `-generic`, for composing a component's own class names. */
export function sourceClass(prefix: string, sourceType?: string): string {
  return `${prefix}-${sourceModifier(sourceType)}`;
}

/** Readable name for a source type, whether or not this build has heard of it. */
export function sourceTypeLabel(sourceType?: string): string {
  const type = normalizeType(sourceType);
  if (!type) return 'Unknown source';
  return TYPE_LABELS[type] ?? deslug(type);
}

/**
 * Splits a stored `cin_sourceId` value. The type is everything before the first colon; the id keeps any
 * further colons, since only the first separates the two.
 */
export function splitSourceKey(key: string): { sourceType: string; sourceId: string } {
  const idx = (key ?? '').indexOf(':');
  if (idx < 0) return { sourceType: normalizeType(key), sourceId: '' };
  return { sourceType: normalizeType(key.slice(0, idx)), sourceId: key.slice(idx + 1) };
}

/** The fields of a source the label and colour helpers read. `ContentSourceDescriptor` has this shape. */
export interface SourceRef {
  /** Qualified id, `<sourceType>:<id>`, or a bare type for the only source of a type with no id. */
  sourceId: string;
  sourceType?: string;
  displayName?: string;
}

/** How many colours the palette in `styles.scss` holds (`--source-1` to `--source-6`). */
export const SOURCE_COLOURS = 6;

/** Docker-style short ids start this long and grow only until they are unique within the type. */
const SHORT_ID_MIN = 4;

/**
 * Finds the entry for a `<sourceType>:<sourceId>` key. A bare type names the only source of that type,
 * and a bare entry stands for the only source of its type, whose id rag-service learns from the index.
 */
export function findSourceRef<T extends SourceRef>(key: string, sources: readonly T[]): T | undefined {
  const exact = sources.find((source) => source.sourceId === key);
  if (exact) return exact;
  const { sourceType, sourceId } = splitSourceKey(key);
  const ofType = sources.filter((source) => refType(source) === sourceType);
  if (ofType.length !== 1) return undefined;
  return !sourceId || !splitSourceKey(ofType[0].sourceId).sourceId ? ofType[0] : undefined;
}

/**
 * The one name for a source, used wherever a source is shown:
 * 1. its display name from `/api/rag/sources`, when one is configured;
 * 2. else the type label, when the type has a single source;
 * 3. else the type label and a short id: the first four characters of the id, extended only until no
 *    other source of the type shares them ("Alfresco (55d9)").
 */
export function sourceDisplayLabel(key: string | undefined, sources: readonly SourceRef[]): string {
  if (!key) return 'Unknown source';
  const { sourceType, sourceId } = splitSourceKey(key);
  const match = findSourceRef(key, sources);
  const name = match ? ownName(match) : '';
  if (name) return name;

  const label = sourceTypeLabel(sourceType);
  const ids = sources
    .filter((source) => refType(source) === sourceType)
    .map((source) => splitSourceKey(source.sourceId).sourceId)
    .filter(Boolean);
  if (sourceId && !match) ids.push(sourceId);
  const several = new Set(ids).size > 1;
  return several && sourceId ? `${label} (${shortSourceId(sourceId, ids)})` : label;
}

/** The shortest prefix of `id`, at least four characters, that no other id in `ids` starts with. */
export function shortSourceId(id: string, ids: readonly string[]): string {
  const others = ids.filter((other) => other !== id);
  for (let length = SHORT_ID_MIN; length < id.length; length++) {
    const prefix = id.slice(0, length);
    if (!others.some((other) => other.startsWith(prefix))) return prefix;
  }
  return id;
}

/**
 * The palette slot of a source, 1 to {@link SOURCE_COLOURS}, or 0 for a source the list does not hold.
 *
 * The slot is the source's position in `sources`, so the caller's order is the colour order. The source
 * catalogue lists Alfresco first and Nuxeo second, and slots 1 and 2 are the Alfresco green and the Nuxeo
 * teal, so one Alfresco and one Nuxeo keep the colours they always had.
 */
export function sourceColourIndex(key: string | undefined, sources: readonly SourceRef[]): number {
  if (!key) return 0;
  const match = findSourceRef(key, sources);
  return match ? (sources.indexOf(match) % SOURCE_COLOURS) + 1 : 0;
}

/** `source-c<n>`, the global class that sets `--src`, `--src-strong` and `--src-soft`, or '' when unknown. */
export function sourceColourClass(key: string | undefined, sources: readonly SourceRef[]): string {
  const index = sourceColourIndex(key, sources);
  return index ? `source-c${index}` : '';
}

/**
 * The configured display name, or '' when it is only a generated one: rag-service answers the type label,
 * or the type label and the full id, for a source without a name of its own.
 */
function ownName(source: SourceRef): string {
  const name = (source.displayName ?? '').trim();
  if (!name) return '';
  const type = refType(source);
  const id = splitSourceKey(source.sourceId).sourceId;
  const generated = [sourceTypeLabel(type), type]
    .flatMap((label) => [label, `${label} (${id})`])
    .map((label) => label.toLowerCase());
  return generated.includes(name.toLowerCase()) ? '' : name;
}

function refType(source: SourceRef): string {
  return normalizeType(source.sourceType) || splitSourceKey(source.sourceId).sourceType;
}

function normalizeType(value?: string): string {
  return (value ?? '').trim().toLowerCase();
}

function deslug(type: string): string {
  return type
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
