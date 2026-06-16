module.exports = async (req, res) => {
  res.status(200).json({
    teams: [
      { id: 'team-001', name: 'Open Studio Core', seats: 8 },
      { id: 'team-002', name: 'Open Studio Team', seats: 5 },
    ],
  });
};
