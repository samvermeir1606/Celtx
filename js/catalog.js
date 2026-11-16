/* Scriptdesk — Master Catalog: categories, per-category forms, links between items.
   Field sets follow the old Celtx desktop forms (Character, Actor, Location,
   Wardrobe/Prop) with a few additions that help writers and actors. */
(function () {
  'use strict';
  const SD = window.SD;

  // breakdown: can be tagged in a scene.  group: where it sits in the catalog list.
  SD.CATEGORIES = [
    { id: 'character', label: 'Characters', one: 'Character', color: '#e5484d', group: 'Story', breakdown: true },
    { id: 'location', label: 'Locations', one: 'Location', color: '#0090ff', group: 'Story', breakdown: true },
    { id: 'actor', label: 'Actors', one: 'Actor', color: '#d6409f', group: 'People', breakdown: false },
    { id: 'crew', label: 'Crew', one: 'Crew member', color: '#8b8d98', group: 'People', breakdown: false },
    { id: 'extras', label: 'Extras', one: 'Extra', color: '#ad7f58', group: 'People', breakdown: true },
    { id: 'stunts', label: 'Stunts', one: 'Stunt', color: '#dc3e42', group: 'People', breakdown: true },
    { id: 'prop', label: 'Props', one: 'Prop', color: '#8e4ec6', group: 'Production', breakdown: true },
    { id: 'wardrobe', label: 'Wardrobe', one: 'Wardrobe', color: '#e93d82', group: 'Production', breakdown: true },
    { id: 'makeup', label: 'Makeup', one: 'Makeup', color: '#f76b15', group: 'Production', breakdown: true },
    { id: 'hair', label: 'Hair', one: 'Hair', color: '#ffa057', group: 'Production', breakdown: true },
    { id: 'set', label: 'Sets', one: 'Set', color: '#3e63dd', group: 'Production', breakdown: true },
    { id: 'setdressing', label: 'Set Dressing', one: 'Set Dressing', color: '#978365', group: 'Production', breakdown: true },
    { id: 'vehicle', label: 'Vehicles', one: 'Vehicle', color: '#12a594', group: 'Production', breakdown: true },
    { id: 'animal', label: 'Animals', one: 'Animal', color: '#46a758', group: 'Production', breakdown: true },
    { id: 'weapon', label: 'Weapons', one: 'Weapon', color: '#6e6e6e', group: 'Production', breakdown: true },
    { id: 'equipment', label: 'Special Equipment', one: 'Equipment', color: '#5b5bd6', group: 'Production', breakdown: true },
    { id: 'sfx', label: 'Special Effects', one: 'Special Effect', color: '#ffc53d', group: 'Effects & Sound', breakdown: true },
    { id: 'vfx', label: 'Visual Effects', one: 'Visual Effect', color: '#0d74ce', group: 'Effects & Sound', breakdown: true },
    { id: 'sound', label: 'Sound', one: 'Sound', color: '#3a5bc7', group: 'Effects & Sound', breakdown: true },
    { id: 'music', label: 'Music', one: 'Music', color: '#6e56cf', group: 'Effects & Sound', breakdown: true },
    { id: 'other', label: 'Other', one: 'Other', color: '#8b8d98', group: 'Other', breakdown: true },
  ];
  SD.categoryById = (id) => SD.CATEGORIES.find((c) => c.id === id) || SD.CATEGORIES[SD.CATEGORIES.length - 1];

  // ---------- reusable field groups ----------
  const contact = (title = 'Contact information') => ({
    title, fields: [
      { key: 'contactName', label: 'Name' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Phone' },
      { key: 'cell', label: 'Mobile' },
      { key: 'address', label: 'Address', type: 'textarea', wide: true },
      { key: 'website', label: 'Website / link', type: 'url', wide: true },
      { key: 'contactComments', label: 'Comments', type: 'textarea', wide: true },
    ],
  });
  const procurement = {
    title: 'Procurement', fields: [
      { key: 'procure', label: 'Procurement', type: 'select', options: ['Rent', 'Buy', 'Build', 'Borrow', 'Already own'] },
      { key: 'cost', label: 'Cost' },
      { key: 'dateNeeded', label: 'Date needed' },
      { key: 'dateReturn', label: 'Return date' },
      { key: 'status', label: 'Status', type: 'select', options: ['Idea', 'Sourcing', 'Confirmed', 'On set', 'Returned'] },
    ],
  };
  const itemDetails = (linkLabel, inverse) => ({
    title: 'Details', fields: [
      { key: 'usedBy', label: linkLabel, type: 'link', target: 'character', multi: true, inverse, wide: true },
      { key: 'quantity', label: 'Quantity' },
      { key: 'size', label: 'Size' },
      { key: 'color', label: 'Colour' },
      { key: 'era', label: 'Era / period' },
      { key: 'continuity', label: 'Continuity notes', type: 'textarea', wide: true, help: 'Damage, dirt, changes between scenes…' },
    ],
  });
  const production = (linkLabel, inverse) => [itemDetails(linkLabel, inverse), procurement, contact('Supplier / contact')];
  const generic = [{ title: 'Details', fields: [{ key: 'quantity', label: 'Quantity' }, { key: 'notes', label: 'Notes', type: 'textarea', wide: true }] }];

  SD.CATALOG_FORMS = {
    character: [
      {
        title: 'Character', fields: [
          { key: 'fullName', label: 'Full name' },
          { key: 'playedBy', label: 'Played by', type: 'link', target: 'actor', inverse: 'Plays', help: 'Link an Actor from the catalog.' },
          { key: 'function', label: 'Principal function', type: 'select', options: ['Protagonist', 'Antagonist', 'Best friend', 'Love interest', 'Confidant(e)', 'Partner', 'Catalyst', 'Mentor', 'Comic relief', 'Supporting', 'Other'] },
          { key: 'occupation', label: 'Occupation' },
        ],
      },
      {
        title: 'Physical description', fields: [
          { key: 'age', label: 'Age' },
          { key: 'gender', label: 'Gender' },
          { key: 'height', label: 'Height' },
          { key: 'weight', label: 'Weight' },
          { key: 'build', label: 'Build' },
          { key: 'hair', label: 'Hair' },
          { key: 'eyes', label: 'Eyes' },
          { key: 'ethnicity', label: 'Ethnicity / origin' },
          { key: 'distFeatures', label: 'Distinguishing features', type: 'textarea', wide: true },
          { key: 'look', label: 'Detailed physical description / style', type: 'textarea', wide: true },
        ],
      },
      {
        title: 'Personality', fields: [
          { key: 'traits', label: 'Key character traits', wide: true },
          { key: 'personality', label: 'Personality', type: 'textarea', wide: true },
          { key: 'likes', label: 'Likes', type: 'textarea' },
          { key: 'dislikes', label: 'Dislikes', type: 'textarea' },
          { key: 'habits', label: 'Habits / vices / mannerisms', type: 'textarea', wide: true },
          { key: 'voice', label: 'Voice & way of speaking', type: 'textarea', wide: true, help: 'Accent, rhythm, favourite words — useful for the actor.' },
        ],
      },
      {
        title: 'Motivation', fields: [
          { key: 'goal', label: 'What is the goal of this character?', type: 'textarea', wide: true },
          { key: 'plan', label: "What is the character's plan to achieve the goal?", type: 'textarea', wide: true },
          { key: 'fear', label: 'Fear / flaw / what stands in the way', type: 'textarea', wide: true },
          { key: 'arc', label: 'Arc — how do they change by the end?', type: 'textarea', wide: true },
        ],
      },
      {
        title: 'Background', fields: [
          { key: 'background', label: 'Character background', type: 'textarea', wide: true },
          { key: 'family', label: 'Family background', type: 'textarea', wide: true },
          { key: 'education', label: 'Education', type: 'textarea', wide: true },
          { key: 'relationships', label: 'Relationships with other characters', type: 'textarea', wide: true },
        ],
      },
    ],
    actor: [
      {
        title: 'Roles', fields: [
          { key: 'consideredFor', label: 'Considered for', type: 'link', target: 'character', multi: true, inverse: 'Actors considered', wide: true },
          { key: 'agent', label: 'Agent / agency' },
          { key: 'union', label: 'Union / membership' },
        ],
      },
      { title: 'Availability', fields: [{ key: 'startDate', label: 'Available from' }, { key: 'endDate', label: 'Available until' }, { key: 'availabilityNotes', label: 'Notes', type: 'textarea', wide: true }] },
      contact(),
      {
        title: 'Physical description', fields: [
          { key: 'height', label: 'Height' }, { key: 'weight', label: 'Weight' }, { key: 'eyes', label: 'Eyes' },
          { key: 'hair', label: 'Hair' }, { key: 'dob', label: 'Date of birth' }, { key: 'gender', label: 'Gender' },
        ],
      },
      {
        title: 'Wardrobe sizes', fields: [
          { key: 'shirt', label: 'Shirt' }, { key: 'pants', label: 'Pants' }, { key: 'dress', label: 'Dress' },
          { key: 'jacket', label: 'Jacket' }, { key: 'hat', label: 'Hat' }, { key: 'shoes', label: 'Shoes' },
        ],
      },
    ],
    crew: [
      { title: 'Role', fields: [{ key: 'department', label: 'Department' }, { key: 'position', label: 'Position' }, { key: 'rate', label: 'Rate' }] },
      { title: 'Availability', fields: [{ key: 'startDate', label: 'Available from' }, { key: 'endDate', label: 'Available until' }] },
      contact(),
    ],
    location: [
      {
        title: 'Location', fields: [
          { key: 'address', label: 'Address', type: 'textarea', wide: true, map: true },
          { key: 'scouting', label: 'Scouting status', type: 'select', options: ['Idea', 'To scout', 'Scouted', 'Selected', 'Confirmed', 'Rejected'] },
          { key: 'standsIn', label: 'Real place it stands in for', help: 'e.g. a café that plays the "Kitchen".' },
        ],
      },
      contact(),
      {
        title: 'Facility information', fields: [
          { key: 'datesAvailable', label: 'Dates available' },
          { key: 'squareFootage', label: 'Square footage' },
          { key: 'rentalCost', label: 'Rental cost' },
          { key: 'elevator', label: 'Elevator', type: 'select', options: ['Yes', 'No'] },
          { key: 'power', label: 'Power capabilities' },
          { key: 'lightSources', label: 'Light sources' },
          { key: 'noise', label: 'Noise issues' },
          { key: 'washrooms', label: 'Washroom locations' },
          { key: 'parking', label: 'Parking information', type: 'textarea', wide: true },
          { key: 'facilityComments', label: 'Comments', type: 'textarea', wide: true },
        ],
      },
    ],
    wardrobe: production('Worn by', 'Wardrobe'),
    prop: production('Used by', 'Props'),
    makeup: production('Used by', 'Makeup'),
    hair: production('Used by', 'Hair'),
    weapon: production('Used by', 'Weapons'),
    vehicle: production('Driven / used by', 'Vehicles'),
    animal: [{ title: 'Animal', fields: [{ key: 'species', label: 'Species / breed' }, { key: 'handler', label: 'Handler' }, { key: 'usedBy', label: 'Owned by / with', type: 'link', target: 'character', multi: true, inverse: 'Animals', wide: true }, { key: 'notes', label: 'Care & safety notes', type: 'textarea', wide: true }] }, contact('Handler / supplier')],
    set: [{ title: 'Set', fields: [{ key: 'stage', label: 'Stage / studio' }, { key: 'buildStatus', label: 'Build status', type: 'select', options: ['Design', 'Building', 'Ready', 'Struck'] }, { key: 'notes', label: 'Notes', type: 'textarea', wide: true }] }, procurement],
    setdressing: production('Belongs to', 'Set dressing'),
    equipment: [itemDetails('Used by', 'Equipment'), procurement, contact('Supplier / contact')],
    stunts: [{ title: 'Stunt', fields: [{ key: 'performer', label: 'Performed by', type: 'link', target: 'actor', inverse: 'Stunts' }, { key: 'double', label: 'Doubling for', type: 'link', target: 'character', inverse: 'Stunts' }, { key: 'coordinator', label: 'Coordinator' }, { key: 'safety', label: 'Safety notes', type: 'textarea', wide: true }] }],
    extras: [{ title: 'Extras', fields: [{ key: 'quantity', label: 'How many' }, { key: 'look', label: 'Look / wardrobe', type: 'textarea', wide: true }, { key: 'notes', label: 'Notes', type: 'textarea', wide: true }] }],
    sfx: generic, vfx: generic, other: generic,
    sound: [{ title: 'Sound', fields: [{ key: 'source', label: 'Source / file' }, { key: 'rights', label: 'Rights / licence' }, { key: 'notes', label: 'Notes', type: 'textarea', wide: true }] }],
    music: [{ title: 'Music', fields: [{ key: 'composer', label: 'Composer / artist' }, { key: 'source', label: 'Source / file' }, { key: 'rights', label: 'Rights / licence' }, { key: 'cue', label: 'Cue notes', type: 'textarea', wide: true }] }],
  };

  SD.formFor = (category) => SD.CATALOG_FORMS[category] || generic;

  SD.newCatalogItem = (category, name = '') => ({
    id: SD.uid(), category, name, description: '', tags: '', fields: {}, links: {}, media: [], custom: [],
  });

  SD.normalizeCatalogItem = (c) => {
    c.id = c.id || SD.uid();
    if (c.category === 'makeup-hair') c.category = 'makeup';
    if (!SD.CATEGORIES.some((k) => k.id === c.category)) c.category = 'other';
    c.name = c.name || '';
    c.description = c.description || '';
    c.tags = c.tags || '';
    c.fields = c.fields && typeof c.fields === 'object' ? c.fields : {};
    c.links = c.links && typeof c.links === 'object' ? c.links : {};
    c.media = Array.isArray(c.media) ? c.media : [];
    c.custom = Array.isArray(c.custom) ? c.custom : [];
    return c;
  };

  // All link fields that point at items of `category`: [{sourceCategory, field}]
  SD.inverseLinksTo = (category) => {
    const out = [];
    for (const [src, sections] of Object.entries(SD.CATALOG_FORMS)) {
      for (const s of sections) for (const f of s.fields) if (f.type === 'link' && f.target === category) out.push({ sourceCategory: src, field: f });
    }
    return out;
  };

  SD.linkIds = (item, key) => {
    const v = item.links[key];
    return Array.isArray(v) ? v : v ? [v] : [];
  };

  // Remove dangling links after an item is deleted.
  SD.unlinkEverywhere = (project, id) => {
    for (const c of project.catalog) {
      for (const k of Object.keys(c.links)) {
        const v = c.links[k];
        if (Array.isArray(v)) c.links[k] = v.filter((x) => x !== id);
        else if (v === id) delete c.links[k];
      }
    }
    for (const d of project.documents) {
      if (d.elements) for (const e of d.elements) if (e.items) e.items = e.items.filter((x) => x !== id);
      if (d.rows) for (const r of d.rows) if (r.charId === id) r.charId = null;
    }
  };

  SD.findCatalogItem = (project, category, name) => {
    const n = String(name || '').trim().toUpperCase();
    return project.catalog.find((c) => c.category === category && c.name.trim().toUpperCase() === n) || null;
  };

  // Resize an image file into a compact JPEG data URL so it can live inside the project file.
  SD.imageToDataUrl = async (blob, max = 900) => {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), hgt = Math.max(1, Math.round(bmp.height * scale));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = hgt;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, hgt);
    ctx.drawImage(bmp, 0, 0, w, hgt);
    bmp.close && bmp.close();
    return cv.toDataURL('image/jpeg', 0.85);
  };
})();
