import {
  shortSourceId,
  sourceClass,
  sourceColourClass,
  sourceColourIndex,
  sourceDisplayLabel,
  sourceIcon,
  sourceModifier,
  sourceTypeLabel,
  splitSourceKey
} from './source-presentation';

const BRANCH = { sourceId: 'alfresco:55d96fae-4d3a', sourceType: 'alfresco', displayName: 'Northgate Branch' };
const HEAD = { sourceId: 'alfresco:5ce58fd0-91b2', sourceType: 'alfresco', displayName: 'Northgate Head Office' };
const ALFRESCO = { sourceId: 'alfresco:acs', sourceType: 'alfresco', displayName: 'Alfresco' };
const NUXEO = { sourceId: 'nuxeo:prod', sourceType: 'nuxeo', displayName: 'Nuxeo' };

describe('source-presentation', () => {

  it('stylesAlfrescoAndNuxeoAndNothingElse', () => {
    expect(sourceModifier('alfresco')).toBe('alfresco');
    expect(sourceModifier('nuxeo')).toBe('nuxeo');

    // A third source must not borrow either repository's colour, which is what the two-way ternaries
    // it replaces did.
    expect(sourceModifier('cmis')).toBe('generic');
    expect(sourceModifier('sample-directory')).toBe('generic');
    expect(sourceModifier(undefined)).toBe('generic');
  });

  it('composesAClassNamePerPrefix', () => {
    expect(sourceClass('source-badge', 'alfresco')).toBe('source-badge-alfresco');
    expect(sourceClass('result', 'cmis')).toBe('result-generic');
  });

  it('picksAnIconWithANeutralDefault', () => {
    expect(sourceIcon('alfresco')).toBe('storage');
    expect(sourceIcon('nuxeo')).toBe('folder_open');
    expect(sourceIcon('cmis')).toBe('description');
  });

  it('labelsAKnownTypeByNameAndDeslugsAnUnknownOne', () => {
    expect(sourceTypeLabel('cmis')).toBe('CMIS');
    expect(sourceTypeLabel('sharepoint')).toBe('SharePoint');

    // 'Sample-directory' is what a titlecase pipe produces, and is the label issue #9 objects to.
    expect(sourceTypeLabel('sample-directory')).toBe('Sample Directory');
    expect(sourceTypeLabel('acme_vault')).toBe('Acme Vault');
    expect(sourceTypeLabel(undefined)).toBe('Unknown source');
  });

  it('isCaseAndWhitespaceInsensitiveAboutTheType', () => {
    expect(sourceModifier(' Alfresco ')).toBe('alfresco');
    expect(sourceTypeLabel('CMIS')).toBe('CMIS');
  });

  it('splitsASourceKeyOnTheFirstColonOnly', () => {
    expect(splitSourceKey('alfresco:abc-uuid')).toEqual({ sourceType: 'alfresco', sourceId: 'abc-uuid' });

    // A source id may itself contain a colon; only the first separates type from id.
    expect(splitSourceKey('cmis:http://host:8080/repo'))
      .toEqual({ sourceType: 'cmis', sourceId: 'http://host:8080/repo' });

    expect(splitSourceKey('filesystem')).toEqual({ sourceType: 'filesystem', sourceId: '' });
  });

  it('namesASourceByItsDisplayNameWhenOneIsConfigured', () => {
    expect(sourceDisplayLabel(BRANCH.sourceId, [BRANCH, HEAD])).toBe('Northgate Branch');
    expect(sourceDisplayLabel(HEAD.sourceId, [BRANCH, HEAD])).toBe('Northgate Head Office');
    expect(sourceDisplayLabel(undefined, [BRANCH])).toBe('Unknown source');
  });

  it('namesTheOnlySourceOfATypeByTheTypeLabel', () => {
    expect(sourceDisplayLabel(ALFRESCO.sourceId, [ALFRESCO, NUXEO])).toBe('Alfresco');
    expect(sourceDisplayLabel('cmis:docmgr', [ALFRESCO])).toBe('CMIS');
    // A bare type names the only source of that type.
    expect(sourceDisplayLabel('nuxeo', [ALFRESCO, NUXEO])).toBe('Nuxeo');
  });

  it('namesAnUnnamedSourceByAShortIdWhenItsTypeHasSeveral', () => {
    // rag-service fills an unnamed source's display name with the type and the full id.
    const a = { sourceId: 'alfresco:55d96fae-1', sourceType: 'alfresco', displayName: 'Alfresco (55d96fae-1)' };
    const b = { sourceId: 'alfresco:5ce58fd0-2', sourceType: 'alfresco', displayName: '' };

    expect(sourceDisplayLabel(a.sourceId, [a, b])).toBe('Alfresco (55d9)');
    expect(sourceDisplayLabel(b.sourceId, [a, b])).toBe('Alfresco (5ce5)');
    // A key the list does not hold still counts as one more source of its type.
    expect(sourceDisplayLabel('cmis:archive', [{ sourceId: 'cmis:docmgr' }])).toBe('CMIS (arch)');
  });

  it('startsAShortIdAtFourCharactersAndExtendsItOnlyOnAClash', () => {
    expect(shortSourceId('55d96fae', ['55d96fae', '5ce58fd0'])).toBe('55d9');
    expect(shortSourceId('55d96fae', ['55d96fae', '55d9b0c1'])).toBe('55d96');
    expect(shortSourceId('55d96fae', ['55d96fae', '55d96fa0'])).toBe('55d96fae');
    expect(shortSourceId('ab', ['ab', 'cd'])).toBe('ab');
  });

  it('coloursASourceByItsPlaceInTheList', () => {
    // One Alfresco and one Nuxeo keep the green and teal slots they always had.
    expect(sourceColourIndex(ALFRESCO.sourceId, [ALFRESCO, NUXEO])).toBe(1);
    expect(sourceColourIndex(NUXEO.sourceId, [ALFRESCO, NUXEO])).toBe(2);
    expect(sourceColourIndex('alfresco', [ALFRESCO, NUXEO])).toBe(1);

    // The slot follows the list, so it is the same on every screen that reads it.
    expect(sourceColourClass(HEAD.sourceId, [BRANCH, HEAD, NUXEO])).toBe('source-c2');
    expect(sourceColourClass(NUXEO.sourceId, [BRANCH, HEAD, NUXEO])).toBe('source-c3');
    // A type with several sources names none of them, and an unknown source gets no slot.
    expect(sourceColourClass('alfresco', [BRANCH, HEAD])).toBe('');
    expect(sourceColourIndex('cmis:docmgr', [BRANCH])).toBe(0);
  });

  it('wrapsTheColourSlotAfterTheSixInThePalette', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ sourceId: `cmis:r${i}` }));
    expect(sourceColourIndex('cmis:r6', many)).toBe(1);
  });
});
