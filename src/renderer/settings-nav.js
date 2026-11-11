// Settings has many pages. The tab bar shows a few groups; a group with more
// than one page shows its pages in a second row. Every page keeps its own view
// id, so everything that opens "settings", "skills", "schedules"... still works.

export const SETTINGS_GROUPS = [
  { id: 'general', label: 'General', views: [['settings', 'General']] },
  { id: 'models', label: 'Models', views: [['models', 'Models'], ['connections', 'Connections']] },
  { id: 'agents', label: 'Agents', views: [['agents', 'Agents'], ['skills', 'Skills'], ['personality', 'Personality'], ['schedules', 'Schedules']] },
  { id: 'knowledge', label: 'Knowledge', views: [['memory', 'Memory'], ['docs', 'Documents'], ['people', 'People']] },
];

export const groupOf = (view) => SETTINGS_GROUPS.find((g) => g.views.some(([v]) => v === view)) || null;

// General has many fields, so it has tabs of its own in the second row (like the
// groups above). Each field in the page says which tab it belongs to (data-sec).
export const GENERAL_SECTIONS = [['look', 'Look'], ['desktop', 'Desktop'], ['orb', 'Orb'], ['privacy', 'Privacy'], ['chat', 'Chat'], ['voice', 'Voice and hands'], ['system', 'System']];
