export const demoTeams = [
  { id: 'team-001', name: 'Open Studio Core', seats: 8 },
  { id: 'team-002', name: 'Open Studio Team', seats: 5 },
];

export const demoProjects = [
  { id: 'project-001', name: 'Midnight Atlas', status: 'draft', teamId: 'team-001' },
  { id: 'project-002', name: 'Echo Chamber', status: 'in-review', teamId: 'team-001' },
  { id: 'project-003', name: 'Open Studio Launch', status: 'approved', teamId: 'team-002' },
];

export const demoUsage = [
  { id: 'usage-001', team: 'Open Studio Core', type: 'storyboard_generate', count: 124 },
  { id: 'usage-002', team: 'Open Studio Team', type: 'video_generate', count: 62 },
];
