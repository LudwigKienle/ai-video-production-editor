module.exports = async (req, res) => {
  res.status(200).json({
    projects: [
      { id: 'project-001', name: 'Midnight Atlas', status: 'draft', teamId: 'team-001' },
      { id: 'project-002', name: 'Echo Chamber', status: 'in-review', teamId: 'team-001' },
      { id: 'project-003', name: 'Open Studio Launch', status: 'approved', teamId: 'team-002' },
    ],
  });
};
